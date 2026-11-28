import unittest

from model_registry import ModelRegistryError, load_catalog_json, route_model, validate_catalog


def model(**overrides):
    value = {
        "model_id": "astra-image-test-v1",
        "revision": "sha256:abc123",
        "provider": "local",
        "modalities": ["image"],
        "aspect_ratios": ["1:1", "16:9"],
        "max_width": 1024,
        "max_height": 1024,
        "max_pixels": 1048576,
        "min_vram_mb": 8000,
        "enabled": True,
    }
    value.update(overrides)
    return value


class ModelRegistryTests(unittest.TestCase):
    def test_explicit_compatible_model_is_selected(self):
        result = route_model(
            [model()], model_id="astra-image-test-v1", modality="image",
            aspect_ratio="1:1", width=1024, height=1024,
        )
        self.assertEqual(result["model_id"], "astra-image-test-v1")
        self.assertEqual(result["routing_policy"], "explicit-model-no-fallback")
        self.assertTrue(result["runtime_preflight_required"])

    def test_no_implicit_fallback_for_unknown_or_disabled_model(self):
        with self.assertRaises(ModelRegistryError):
            route_model([model()], model_id="other-model", modality="image",
                        aspect_ratio="1:1", width=512, height=512)
        with self.assertRaises(ModelRegistryError):
            route_model([model(enabled=False)], model_id="astra-image-test-v1",
                        modality="image", aspect_ratio="1:1", width=512, height=512)

    def test_modality_ratio_and_dimensions_are_enforced(self):
        with self.assertRaises(ModelRegistryError):
            route_model([model()], model_id="astra-image-test-v1", modality="video",
                        aspect_ratio="1:1", width=512, height=512)
        with self.assertRaises(ModelRegistryError):
            route_model([model()], model_id="astra-image-test-v1", modality="image",
                        aspect_ratio="9:16", width=512, height=512)
        with self.assertRaises(ModelRegistryError):
            route_model([model()], model_id="astra-image-test-v1", modality="image",
                        aspect_ratio="1:1", width=2048, height=2048)

    def test_dimension_ratio_mismatch_is_rejected(self):
        with self.assertRaises(ModelRegistryError):
            route_model([model()], model_id="astra-image-test-v1", modality="image",
                        aspect_ratio="16:9", width=512, height=512)

    def test_catalog_rejects_unknown_fields_duplicates_and_bad_values(self):
        with self.assertRaises(ModelRegistryError):
            validate_catalog([model(extra="no")])
        with self.assertRaises(ModelRegistryError):
            validate_catalog([model(), model()])
        with self.assertRaises(ModelRegistryError):
            validate_catalog([model(max_pixels=True)])

    def test_catalog_json_is_validated(self):
        import json
        catalog = load_catalog_json(json.dumps([model()]))
        self.assertEqual(catalog[0]["provider"], "local")
        with self.assertRaises(ModelRegistryError):
            load_catalog_json("not-json")

    def test_malformed_request_types_fail_cleanly(self):
        with self.assertRaises(ModelRegistryError):
            route_model([model()], model_id="astra-image-test-v1", modality=["image"],
                        aspect_ratio="1:1", width=512, height=512)
        with self.assertRaises(ModelRegistryError):
            route_model([model()], model_id="astra-image-test-v1", modality="image",
                        aspect_ratio={"ratio": "1:1"}, width=512, height=512)


if __name__ == "__main__":
    unittest.main()
