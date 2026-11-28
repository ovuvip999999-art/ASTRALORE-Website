"""Graceful polling loop for an already verified ASTRA GenerationWorker."""
from __future__ import annotations

from typing import Any

from worker_client import WorkerClientError


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
            if processed == 0:
                stop_event.wait(float(idle_seconds))
        except WorkerClientError:
            stop_event.wait(backoff)
            backoff = min(float(max_backoff_seconds), backoff * 2)
