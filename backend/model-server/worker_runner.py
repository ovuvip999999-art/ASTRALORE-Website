"""Bounded ASTRA worker orchestration; no model adapter is installed by default.

A worker cannot claim jobs unless an exact (model_id, model_revision) adapter
has been explicitly supplied by a separately reviewed inference runtime.
"""
from __future__ import annotations

import tempfile
import threading
from pathlib import Path
from typing import Any, Protocol

from asset_store import AssetStoreError, SupabasePrivateAssetStore
from media_validation import MediaValidationError, inspect_media_file
from safety_gate import SafetyGate, SafetyGateError
from worker_client import PrivateWorkerClient, WorkerClientError, WorkerLeaseLost

from runtime_errors import GenerationError


class GenerationAdapter(Protocol):
    def generate(
        self,
        job: dict[str, Any],
        *,
        output_dir: Path,
        cancel_event: threading.Event,
    ) -> str | Path:
        """Generate one output file inside output_dir; observe cancel_event."""
        ...


class GenerationWorker:
    def __init__(
        self,
        *,
        client: PrivateWorkerClient,
        asset_store: SupabasePrivateAssetStore,
        adapters: dict[tuple[str, str], GenerationAdapter],
        safety_gate: SafetyGate | None = None,
        worker_id: str,
        output_root: str | Path,
        batch_size: int = 1,
        lease_seconds: int = 120,
        heartbeat_interval: float = 20.0,
    ) -> None:
        if not isinstance(worker_id, str) or not 1 <= len(worker_id.strip()) <= 100:
            raise ValueError("worker_id must contain 1–100 characters.")
        if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 4:
            raise ValueError("batch_size must be between 1 and 4.")
        if isinstance(lease_seconds, bool) or not isinstance(lease_seconds, int) or not 30 <= lease_seconds <= 600:
            raise ValueError("lease_seconds must be between 30 and 600.")
        if not isinstance(heartbeat_interval, (int, float)) or not 1 <= heartbeat_interval <= lease_seconds / 3:
            raise ValueError("heartbeat_interval must be between 1 second and one-third of the lease.")
        if not isinstance(adapters, dict):
            raise ValueError("adapters must be an explicit model/revision mapping.")
        for key, adapter in adapters.items():
            if (
                not isinstance(key, tuple) or len(key) != 2
                or not all(isinstance(part, str) and part.strip() for part in key)
                or not callable(getattr(adapter, "generate", None))
            ):
                raise ValueError("Each adapter must be keyed by exact model ID and revision.")
        root_input = Path(output_root)
        if root_input.is_symlink():
            raise ValueError("Worker output root cannot be a symbolic link.")
        root_input.mkdir(parents=True, exist_ok=True)
        root = root_input.resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Worker output root must be a directory.")

        self.client = client
        self.asset_store = asset_store
        self.adapters = dict(adapters)
        self.safety_gate = safety_gate
        self.worker_id = worker_id.strip()
        self.output_root = root
        self.batch_size = batch_size
        self.lease_seconds = lease_seconds
        self.heartbeat_interval = float(heartbeat_interval)

    def run_once(self) -> int:
        # Crucial fail-closed rule: do not even claim jobs until at least one
        # explicitly registered, exact-revision inference adapter exists.
        if not self.adapters or self.safety_gate is None:
            return 0
        jobs = self.client.claim(
            worker_id=self.worker_id,
            batch_size=self.batch_size,
            lease_seconds=self.lease_seconds,
        )
        processed = 0
        for job in jobs:
            self._process_job(job)
            processed += 1
        return processed

    def _heartbeat_loop(
        self,
        job_id: str,
        lease_token: str,
        stop_event: threading.Event,
        cancel_event: threading.Event,
        lease_lost_event: threading.Event,
    ) -> None:
        while not stop_event.wait(self.heartbeat_interval):
            try:
                result = self.client.heartbeat(
                    job_id=job_id,
                    lease_token=lease_token,
                    lease_seconds=self.lease_seconds,
                )
            except WorkerClientError:
                lease_lost_event.set()
                cancel_event.set()
                return
            if result.get("cancel_requested"):
                cancel_event.set()
                return

    def _record_failure(self, job_id: str, lease_token: str, code: str, retryable: bool) -> None:
        try:
            self.client.fail(
                job_id=job_id,
                lease_token=lease_token,
                error_code=code,
                retryable=retryable,
            )
        except WorkerLeaseLost:
            return

    def _process_job(self, job: dict[str, Any]) -> None:
        job_id = job.get("id")
        lease_token = job.get("lease_token")
        request = job.get("request")
        if not isinstance(request, dict):
            self._record_failure(job_id, lease_token, "INVALID_JOB_REQUEST", False)
            return

        model_id = job.get("model_id")
        model_revision = request.get("model_revision")
        adapter = self.adapters.get((model_id, model_revision))
        if adapter is None:
            self._record_failure(job_id, lease_token, "MODEL_RUNTIME_UNAVAILABLE", False)
            return

        if job.get("cancel_requested") is True:
            self._record_failure(job_id, lease_token, "CANCELLED_BY_USER", False)
            return

        prompt = request.get("compiled_prompt") or request.get("prompt")
        try:
            self.safety_gate.check_prompt(prompt, job.get("modality"))
        except SafetyGateError as exc:
            self._record_failure(job_id, lease_token, exc.error_code, exc.retryable)
            return

        cancel_event = threading.Event()
        stop_event = threading.Event()
        lease_lost_event = threading.Event()
        heartbeat = threading.Thread(
            target=self._heartbeat_loop,
            args=(job_id, lease_token, stop_event, cancel_event, lease_lost_event),
            name=f"astra-heartbeat-{job_id}",
            daemon=True,
        )

        with tempfile.TemporaryDirectory(
            prefix=f"astra-{job_id}-",
            dir=str(self.output_root),
        ) as temp_dir:
            output_dir = Path(temp_dir).resolve(strict=True)
            uploaded_path: str | None = None
            heartbeat.start()
            try:
                output_path = adapter.generate(
                    job,
                    output_dir=output_dir,
                    cancel_event=cancel_event,
                )
                if lease_lost_event.is_set():
                    return
                if cancel_event.is_set():
                    self._record_failure(job_id, lease_token, "CANCELLED_BY_USER", False)
                    return

                modality = job.get("modality")
                asset = inspect_media_file(
                    output_path,
                    work_dir=output_dir,
                    modality=modality,
                )
                width = request.get("width")
                height = request.get("height")
                if (
                    type(width) is not int or type(height) is not int
                    or asset["width"] != width or asset["height"] != height
                ):
                    raise GenerationError("OUTPUT_DIMENSION_MISMATCH", retryable=False)
                if modality == "video":
                    duration_seconds = request.get("duration_seconds", 5)
                    if type(duration_seconds) is not int or not 1 <= duration_seconds <= 120:
                        raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
                    duration_ms = asset.get("duration_ms")
                    if type(duration_ms) is not int or abs(duration_ms - duration_seconds * 1000) > 250:
                        raise GenerationError("OUTPUT_DURATION_MISMATCH", retryable=False)

                self.safety_gate.check_output(output_path, modality)
                uploaded = self.asset_store.upload_validated_file(
                    output_path,
                    work_dir=output_dir,
                    user_id=job.get("user_id"),
                    job_id=job_id,
                    validated_asset=asset,
                )
                uploaded_path = uploaded["storage_path"]

                if cancel_event.is_set() or lease_lost_event.is_set():
                    self.asset_store.delete_object(uploaded_path)
                    if not lease_lost_event.is_set():
                        self._record_failure(job_id, lease_token, "CANCELLED_BY_USER", False)
                    return

                try:
                    self.client.complete(
                        job_id=job_id,
                        lease_token=lease_token,
                        output_asset=uploaded,
                    )
                except WorkerLeaseLost:
                    # A 409 proves this lease cannot complete the job; remove the
                    # just-uploaded object. Other network errors are ambiguous and
                    # deliberately do not delete, since the DB may have committed.
                    self.asset_store.delete_object(uploaded_path)
                    return
            except SafetyGateError as exc:
                if not lease_lost_event.is_set():
                    self._record_failure(job_id, lease_token, exc.error_code, exc.retryable)
            except GenerationError as exc:
                if not lease_lost_event.is_set():
                    self._record_failure(job_id, lease_token, exc.error_code, exc.retryable)
            except MediaValidationError:
                if not lease_lost_event.is_set():
                    self._record_failure(job_id, lease_token, "OUTPUT_VALIDATION_FAILED", False)
            except AssetStoreError:
                if not lease_lost_event.is_set():
                    self._record_failure(job_id, lease_token, "PRIVATE_STORAGE_FAILED", True)
            except Exception:
                if not lease_lost_event.is_set():
                    self._record_failure(job_id, lease_token, "INFERENCE_FAILED", False)
            finally:
                stop_event.set()
                heartbeat.join(timeout=max(1.0, self.heartbeat_interval + 1.0))
