import unittest

from job_lifecycle import JobStateError, transition_job, validate_job, validate_output_asset

OWNER = "11111111-1111-4111-8111-111111111111"
JOB = "22222222-2222-4222-8222-222222222222"
ASSET = "33333333-3333-4333-8333-333333333333"
T0 = "2026-11-28T10:00:00+00:00"
T1 = "2026-11-28T10:01:00+00:00"
T2 = "2026-11-28T10:02:00+00:00"


def queued_job(modality="image"):
    return {
        "job_id": JOB,
        "owner_id": OWNER,
        "modality": modality,
        "model_id": "astra-image-test-v1",
        "status": "queued",
        "created_at": T0,
        "updated_at": T0,
        "output_asset": None,
        "error_code": None,
    }


def image_asset():
    return {
        "asset_id": ASSET,
        "sha256": "a" * 64,
        "mime_type": "image/png",
        "size_bytes": 1024,
        "width": 512,
        "height": 512,
    }


class JobLifecycleTests(unittest.TestCase):
    def test_queued_to_running_to_succeeded(self):
        running = transition_job(queued_job(), "running", updated_at=T1)
        done = transition_job(running, "succeeded", updated_at=T2, output_asset=image_asset())
        self.assertEqual(done["status"], "succeeded")
        self.assertEqual(done["output_asset"]["asset_id"], ASSET)

    def test_queued_can_be_cancelled(self):
        result = transition_job(queued_job(), "cancelled", updated_at=T1)
        self.assertEqual(result["status"], "cancelled")

    def test_running_can_fail_with_safe_error_code(self):
        running = transition_job(queued_job(), "running", updated_at=T1)
        failed = transition_job(running, "failed", updated_at=T2, error_code="MODEL_TIMEOUT")
        self.assertEqual(failed["error_code"], "MODEL_TIMEOUT")

    def test_illegal_and_terminal_transitions_are_rejected(self):
        with self.assertRaises(JobStateError):
            transition_job(queued_job(), "succeeded", updated_at=T1, output_asset=image_asset())
        cancelled = transition_job(queued_job(), "cancelled", updated_at=T1)
        with self.assertRaises(JobStateError):
            transition_job(cancelled, "running", updated_at=T2)

    def test_duplicate_transition_is_idempotent(self):
        running = transition_job(queued_job(), "running", updated_at=T1)
        self.assertEqual(transition_job(running, "running", updated_at=T0), running)

    def test_timestamp_cannot_move_backwards(self):
        running = transition_job(queued_job(), "running", updated_at=T1)
        with self.assertRaises(JobStateError):
            transition_job(running, "failed", updated_at=T0, error_code="MODEL_FAILED")

    def test_success_requires_valid_modality_matched_output(self):
        with self.assertRaises(JobStateError):
            transition_job(queued_job(), "succeeded", updated_at=T1)
        video_job = queued_job("video")
        running = transition_job(video_job, "running", updated_at=T1)
        with self.assertRaises(JobStateError):
            transition_job(running, "succeeded", updated_at=T2, output_asset=image_asset())

    def test_video_requires_bounded_duration(self):
        video = {
            "asset_id": ASSET, "sha256": "b" * 64, "mime_type": "video/mp4",
            "size_bytes": 1000, "width": 640, "height": 360, "duration_ms": 5000,
        }
        self.assertEqual(validate_output_asset(video, "video")["duration_ms"], 5000)
        with self.assertRaises(JobStateError):
            validate_output_asset({**video, "duration_ms": 999999}, "video")

    def test_unknown_fields_and_unsafe_error_codes_are_rejected(self):
        with self.assertRaises(JobStateError):
            validate_job({**queued_job(), "public_url": "https://example.invalid"})
        running = transition_job(queued_job(), "running", updated_at=T1)
        with self.assertRaises(JobStateError):
            transition_job(running, "failed", updated_at=T2, error_code="internal path leaked")

    def test_timezone_is_required(self):
        with self.assertRaises(JobStateError):
            validate_job({**queued_job(), "created_at": "2026-11-28T10:00:00"})


if __name__ == "__main__":
    unittest.main()
