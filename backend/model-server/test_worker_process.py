import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from worker_client import WorkerClientError
from worker_bootstrap import WorkerStartupError
from worker_process import _read_manifest, build_worker_from_env, run_worker_loop


class FakeStopEvent:
    def __init__(self, stop_after_waits=1):
        self.stopped = False
        self.stop_after_waits = stop_after_waits
        self.waits = []

    def is_set(self):
        return self.stopped

    def wait(self, seconds):
        self.waits.append(seconds)
        if len(self.waits) >= self.stop_after_waits:
            self.stopped = True
        return self.stopped


class FakeWorker:
    def __init__(self, results):
        self.results = list(results)
        self.calls = 0

    def run_once(self):
        self.calls += 1
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class WorkerProcessTests(unittest.TestCase):
    def test_idle_worker_polls_and_stops_gracefully(self):
        worker = FakeWorker([0])
        stop = FakeStopEvent(stop_after_waits=1)
        run_worker_loop(worker, stop, idle_seconds=2)
        self.assertEqual(worker.calls, 1)
        self.assertEqual(stop.waits, [2.0])

    def test_network_failures_use_bounded_exponential_backoff(self):
        worker = FakeWorker([
            WorkerClientError("temporary"),
            WorkerClientError("temporary"),
            0,
        ])
        stop = FakeStopEvent(stop_after_waits=3)
        run_worker_loop(worker, stop, idle_seconds=2, max_backoff_seconds=5)
        self.assertEqual(stop.waits, [2.0, 4.0, 2.0])
        self.assertEqual(worker.calls, 3)

    def test_already_stopped_worker_does_not_claim_jobs(self):
        worker = FakeWorker([0])
        stop = FakeStopEvent()
        stop.stopped = True
        run_worker_loop(worker, stop)
        self.assertEqual(worker.calls, 0)
        self.assertEqual(stop.waits, [])

    def test_startup_requires_all_worker_configuration(self):
        with self.assertRaises(WorkerStartupError):
            build_worker_from_env({})

    def test_manifest_reader_rejects_symlinks_and_oversized_files(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as other:
            target = Path(other) / "manifest.json"
            target.write_text('{"models":[]}', encoding="utf-8")
            link = Path(root) / "manifest.json"
            try:
                link.symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("Symlinks unavailable on this test host.")
            with self.assertRaises(WorkerStartupError):
                _read_manifest(str(link))
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "manifest.json"
            path.write_text("x" * 1_000_001, encoding="utf-8")
            with self.assertRaises(WorkerStartupError):
                _read_manifest(str(path))

    def test_worker_startup_checks_moderation_readiness_before_worker_build(self):
        with tempfile.TemporaryDirectory() as root:
            model_root = Path(root) / "models"
            model_root.mkdir()
            manifest_path = Path(root) / "manifest.json"
            manifest_path.write_text(json.dumps({"models": []}), encoding="utf-8")
            env = {
                "ASTRA_MODEL_ROOT": str(model_root),
                "ASTRA_RUNTIME_MANIFEST_PATH": str(manifest_path),
                "ASTRA_RUNTIME_IMAGE": "registry.example/astra/runtime@sha256:" + "a" * 64,
                "ASTRA_GPU_DEVICE": "0",
                "ASTRA_WORKER_API_URL": "https://worker.example",
                "ASTRA_WORKER_TOKEN": "w" * 40,
                "SUPABASE_URL": "https://project.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "s" * 40,
                "ASTRA_MODERATION_URL": "https://moderation.example",
                "ASTRA_MODERATION_TOKEN": "m" * 40,
                "ASTRA_WORKER_ID": "test-worker",
                "ASTRA_WORKER_OUTPUT_ROOT": str(Path(root) / "output"),
            }
            moderation = Mock()
            sentinel = object()
            with patch("worker_process.DockerSandboxExecutor"), \
                 patch("worker_process.PrivateWorkerClient"), \
                 patch("worker_process.SupabasePrivateAssetStore"), \
                 patch("worker_process.moderation_provider_from_env", return_value=moderation), \
                 patch("worker_process.build_generation_worker", return_value=sentinel) as build:
                result = build_worker_from_env(env)
            self.assertIs(result, sentinel)
            moderation.check_ready.assert_called_once_with()
            build.assert_called_once()

    def test_unexpected_worker_errors_use_bounded_backoff_without_leaking_details(self):
        worker = FakeWorker([RuntimeError("sensitive backend response"), 0])
        stop = FakeStopEvent(stop_after_waits=2)
        with patch("builtins.print") as output:
            run_worker_loop(worker, stop, idle_seconds=2, max_backoff_seconds=5)
        self.assertEqual(worker.calls, 2)
        self.assertEqual(stop.waits, [2.0, 2.0])
        output.assert_called_once_with("ASTRA_WORKER_LOOP_ERROR", flush=True)

    def test_invalid_worker_result_and_invalid_bounds_are_rejected(self):
        worker = FakeWorker([True])
        with self.assertRaises(RuntimeError):
            run_worker_loop(worker, FakeStopEvent(), idle_seconds=1)
        with self.assertRaises(ValueError):
            run_worker_loop(FakeWorker([0]), FakeStopEvent(), idle_seconds=0)
        with self.assertRaises(ValueError):
            run_worker_loop(FakeWorker([0]), FakeStopEvent(), idle_seconds=2, max_backoff_seconds=1)


if __name__ == "__main__":
    unittest.main()
