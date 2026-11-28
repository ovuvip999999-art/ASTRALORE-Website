import unittest

from creative_brief import BriefValidationError, compile_brief, normalize_brief


class CreativeBriefTests(unittest.TestCase):
    def test_preserves_original_prompt_and_adds_only_supplied_fields(self):
        result = compile_brief({
            "prompt": "A lighthouse during a storm",
            "modality": "image",
            "lighting": "cold moonlight",
            "subjects": ["weathered lighthouse"],
        })
        self.assertTrue(result["compiled_prompt"].startswith("A lighthouse during a storm\n"))
        self.assertIn("Lighting: cold moonlight", result["compiled_prompt"])
        self.assertIn("Subjects: weathered lighthouse", result["compiled_prompt"])
        self.assertNotIn("cinematic", result["compiled_prompt"].lower())
        self.assertEqual(result["brief"]["modality"], "image")

    def test_defaults_are_deterministic(self):
        brief = normalize_brief({"prompt": "A red paper boat"})
        self.assertEqual(brief["modality"], "image")
        self.assertEqual(brief["aspect_ratio"], "16:9")
        self.assertEqual(compile_brief({"prompt": "A red paper boat"})["brief_sha256"],
                         compile_brief({"prompt": "A red paper boat"})["brief_sha256"])

    def test_video_motion_is_supported(self):
        result = compile_brief({
            "prompt": "A train crossing a bridge",
            "modality": "video",
            "motion": "slow lateral tracking shot",
        })
        self.assertIn("Motion: slow lateral tracking shot", result["compiled_prompt"])

    def test_motion_is_rejected_for_image(self):
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "A train", "motion": "moving fast"})

    def test_unknown_fields_are_rejected(self):
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "A train", "secret_override": True})

    def test_prompt_is_required_and_bounded(self):
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "  "})
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "x" * 2001})

    def test_lists_are_bounded_and_deduplicated(self):
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "A city", "subjects": ["person", "PERSON"]})
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "A city", "subjects": ["x"] * 9})

    def test_non_string_modality_and_ratio_rejected_cleanly(self):
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "A city", "modality": ["image"]})
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "A city", "aspect_ratio": {"wide": True}})

    def test_invalid_modality_and_ratio_rejected(self):
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "A city", "modality": "audio"})
        with self.assertRaises(BriefValidationError):
            normalize_brief({"prompt": "A city", "aspect_ratio": "4:3"})

    def test_whitespace_normalized(self):
        brief = normalize_brief({"prompt": "  A   quiet\nnebula  ", "style": "  painterly   concept art "})
        self.assertEqual(brief["prompt"], "A quiet nebula")
        self.assertEqual(brief["style"], "painterly concept art")


if __name__ == "__main__":
    unittest.main()
