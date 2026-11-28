import unittest

from quality_eval import BenchmarkError, IMAGE_WEIGHTS, VIDEO_WEIGHTS, summarize, validate_runs


def make_run(sample_id="img-01", modality="image", blind="model-a"):
    return {
        "sample_id": sample_id,
        "blind_model_id": blind,
        "modality": modality,
        "prompt_id": "prompt-01",
        "prompt": "A cinematic mountain observatory at sunrise",
        "model_revision": "revision-sha",
        "runtime_version": "runtime-1",
        "seed": 1234,
        "width": 1024,
        "height": 1024,
        "generation_seconds": 12.5,
        "peak_vram_mb": 9000,
        "output_sha256": "a" * 64,
    }


def make_rating(sample_id, modality="image", reviewer="reviewer-1", score=4):
    criteria = IMAGE_WEIGHTS if modality == "image" else VIDEO_WEIGHTS
    return {
        "sample_id": sample_id,
        "reviewer_alias": reviewer,
        "scores": {criterion: score for criterion in criteria},
    }


class QualityEvaluationTests(unittest.TestCase):
    def test_image_scores_are_weighted_and_reported(self):
        runs = [make_run()]
        ratings = [make_rating("img-01", reviewer="r1"), make_rating("img-01", reviewer="r2", score=5)]
        result = summarize(runs, ratings)
        item = result["results"][0]
        self.assertEqual(item["weighted_quality_score_5"], 4.5)
        self.assertEqual(item["rated_samples"], 1)
        self.assertEqual(item["ratings"], 2)

    def test_video_uses_video_specific_criteria(self):
        runs = [make_run("vid-01", "video")]
        ratings = [make_rating("vid-01", "video")]
        item = summarize(runs, ratings)["results"][0]
        self.assertEqual(item["weighted_quality_score_5"], 4.0)
        self.assertIn("temporal_coherence", item["criterion_means"])
        self.assertIn("motion_quality", item["criterion_means"])

    def test_duplicate_sample_ids_are_rejected(self):
        with self.assertRaises(BenchmarkError):
            validate_runs([make_run(), make_run()])

    def test_invalid_hash_is_rejected(self):
        run = make_run()
        run["output_sha256"] = "not-a-hash"
        with self.assertRaises(BenchmarkError):
            validate_runs([run])

    def test_unknown_sample_rating_is_rejected(self):
        with self.assertRaises(BenchmarkError):
            summarize([make_run()], [make_rating("missing")])

    def test_duplicate_reviewer_rating_is_rejected(self):
        with self.assertRaises(BenchmarkError):
            summarize([make_run()], [make_rating("img-01"), make_rating("img-01")])

    def test_wrong_rubric_for_modality_is_rejected(self):
        run = make_run()
        rating = make_rating("img-01")
        rating["scores"]["temporal_coherence"] = 4
        with self.assertRaises(BenchmarkError):
            summarize([run], [rating])


if __name__ == "__main__":
    unittest.main()
