"""Environment-driven ASTRA worker process and graceful polling loop.

This process is separate from the API server. Startup validates private
services, model files, moderation readiness, Docker image digest and GPU
availability before it can claim a generation job.
"""
from __future__ import annotations

import os
import signal
import threading
from pathlib import Path
from typing import Any

from asset_store import AssetStoreConfig, SupabasePrivateAssetStore
from moderation_http import moderation_provider_from_env
from sandbox_executor import DockerSandboxExecutor
from sandbox_policy import SandboxConfig, SandboxLimits
from worker_bootstrap import WorkerStartupError, build_generation_worker
from worker_client import PrivateWorkerClient, WorkerClientConfig, WorkerClientError
from worker_runner import GenerationWorker

MAX_MANIFEST_BYTES = 1_000_000


def _required(env: dict[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise WorkerStartupError("ASTRA worker configuration is incomplete.")
    return value


def _bounded_int(env: dict[str, str], key: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(env.get(key, str(default)))
    except (TypeError, ValueError):
        raise WorkerStartupError("ASTRA worker resource configuration is invalid.") from None
    if not minimum <= value <= maximum:
        raise WorkerStartupError("ASTRA worker resource configuration is invalid.")
    return value


def _read_manifest(path_value: str) -> str:
    path = Path(path_value)
    if path.is_symlink():
        raise WorkerStartupError("ASTRA model manifest must be a regular administrator-controlled file.")
    try:
        resolved = path.resolve(strict=True)
        if not resolved.is_file() or resolved.stat().st_size > MAX_MANIFEST_BYTES:
            raise WorkerStartupError("ASTRA model manifest is unavailable or too large.")
        raw = resolved.read_text(encoding="utf-8")
    except WorkerStartupError:
        raise
    except (OSError, UnicodeDecodeError, RuntimeError):
        raise WorkerStartupError("ASTRA model manifest is unavailable or invalid.") from None
    if not raw.strip() or len(raw.encode("utf-8")) > MAX_MANIFEST_BYTES:
        raise WorkerStartupError("ASTRA model manifest is unavailable or too large.")
    return raw


def build_worker_from_env(environ: dict[str, str] | None = None) -> GenerationWorker:
    env = dict(os.environ if environ is None else environ)
    try:
        model_root = Path(_required(env, "ASTRA_MODEL_ROOT"))
        manifest = _read_manifest(_required(env, "ASTRA_RUNTIME_MANIFEST_PATH"))
        limits = SandboxLimits(
            memory_bytes=_bounded_int(env, "ASTRA_SANDBOX_MEMORY_BYTES", 16 * 1024**3, 4 * 1024**3, 128 * 1024**3),
            cpu_count=float(env.get("ASTRA_SANDBOX_CPU_COUNT", "4")),
            pids=_bounded_int(env, "ASTRA_SANDBOX_PIDS", 128, 32, 1024),
            timeout_seconds=_bounded_int(env, "ASTRA_SANDBOX_TIMEOUT_SECONDS", 1800, 30, 3600),
            output_bytes=_bounded_int(env, "ASTRA_SANDBOX_OUTPUT_BYTES", 512 * 1024**2, 1, 512 * 1024**2),
            shm_bytes=_bounded_int(env, "ASTRA_SANDBOX_SHM_BYTES", 2 * 1024**3, 64 * 1024**2, 8 * 1024**3),
        )
        sandbox = DockerSandboxExecutor(config=SandboxConfig(
            image=_required(env, "ASTRA_RUNTIME_IMAGE"),
            model_directory=model_root,
            gpu_device=_required(env, "ASTRA_GPU_DEVICE"),
            limits=limits,
            docker_executable=env.get("ASTRA_DOCKER_EXECUTABLE", "docker"),
        ))
        client = PrivateWorkerClient(WorkerClientConfig.from_env(env))
        asset_store = SupabasePrivateAssetStore(AssetStoreConfig.from_env(env))
        moderation = moderation_provider_from_env(env)
        moderation.check_ready()
        return build_generation_worker(
            manifest_json=manifest,
            model_root=model_root,
            sandbox_executor=sandbox,
            moderation_provider=moderation,
            client=client,
            asset_store=asset_store,
            worker_id=_required(env, "ASTRA_WORKER_ID"),
            output_root=_required(env, "ASTRA_WORKER_OUTPUT_ROOT"),
            batch_size=_bounded_int(env, "ASTRA_WORKER_BATCH_SIZE", 1, 1, 4),
            lease_seconds=_bounded_int(env, "ASTRA_WORKER_LEASE_SECONDS", 120, 30, 600),
            heartbeat_interval=float(env.get("ASTRA_WORKER_HEARTBEAT_SECONDS", "20")),
        )
    except WorkerStartupError:
        raise
    except Exception:
        raise WorkerStartupError("ASTRA worker configuration failed validation.") from None


def run_worker_loop(
    worker: Any,
    stop_event: Any,
    *,
    idle_seconds: float = 2.0,
    max_backoff_seconds: float = 30.0,
) -> None:
    if worker is None or stop_event is None:
        raise ValueError("Worker and stop event are required.")
    if not isinstance(idle_seconds, (int, float)) or isinstance(idle_seconds, bool) or not 0.1 <= idle_seconds <= 60:
        raise ValueError("idle_seconds must be between 0.1 and 60.")
    if not isinstance(max_backoff_seconds, (int, float)) or isinstance(max_backoff_seconds, bool) or not idle_seconds <= max_backoff_seconds <= 300:
        raise ValueError("max_backoff_seconds must be between idle_seconds and 300.")

    backoff = float(idle_seconds)
    while not stop_event.is_set():
        try:
            processed = worker.run_once()
            if type(processed) is not int or processed < 0:
                raise RuntimeError("ASTRA worker returned an invalid processed-job count.")
            backoff = float(idle_seconds)
            stop_event.wait(float(idle_seconds) if processed == 0 else 0.1)
        except WorkerClientError:
            stop_event.wait(backoff)
            backoff = min(float(max_backoff_seconds), backoff * 2)


def main() -> int:
    stop_event = threading.Event()

    def request_stop(_signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    try:
        worker = build_worker_from_env()
    except WorkerStartupError:
        print("ASTRA_WORKER_STARTUP_BLOCKED", flush=True)
        return 1
    print("ASTRA_WORKER_READY", flush=True)
    run_worker_loop(worker, stop_event)
    print("ASTRA_WORKER_STOPPED", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
