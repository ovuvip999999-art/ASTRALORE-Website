import unittest

from worker_client import WorkerClientError
from worker_process import run_worker_loop


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
