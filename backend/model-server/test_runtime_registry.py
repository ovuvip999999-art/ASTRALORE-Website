import unittest

from runtime_registry import RuntimeRegistryError, build_adapter_registry

MODEL = {
    "model_id": "astra/test-image",
    "revision": "a" * 40,
    "runtime": "diffusers",
    "files": [{"path": "weights.bin", "resolved_path": "/private/models/weights.bin"}],
}


class FakeAdapter:
    def __init__(self, model_id, revision):
        self.model_id = model_id
        self.revision = revision

    def generate(self, job, *, output_dir, cancel_event):
        return output_dir / "result.png"


class RuntimeRegistryTests(unittest.TestCase):
    def test_no_trusted_factory_means_model_is_not_available(self):
        self.assertEqual(build_adapter_registry([MODEL], factories={}), {})

    def test_code_owned_factory_registers_exact_model_revision(self):
        registry = build_adapter_registry(
            [MODEL],
            factories={"diffusers": lambda model: FakeAdapter(model["model_id"], model["revision"])},
        )
        self.assertEqual(list(registry), [(MODEL["model_id"], MODEL["revision"])])

    def test_factory_cannot_substitute_another_model_or_revision(self):
        with self.assertRaises(RuntimeRegistryError):
            build_adapter_registry(
                [MODEL],
                factories={"diffusers": lambda model: FakeAdapter(model["model_id"], "b" * 40)},
            )

    def test_factory_cannot_return_an_object_without_generate(self):
        with self.assertRaises(RuntimeRegistryError):
            build_adapter_registry([MODEL], factories={"diffusers": lambda model: object()})

    def test_manifest_cannot_register_unverified_artifact_paths(self):
        invalid = dict(MODEL)
        invalid["files"] = [{"path": "weights.bin"}]
        with self.assertRaises(RuntimeRegistryError):
            build_adapter_registry([invalid], factories={"diffusers": lambda model: FakeAdapter(MODEL["model_id"], MODEL["revision"])})

    def test_duplicate_model_revision_is_rejected(self):
        with self.assertRaises(RuntimeRegistryError):
            build_adapter_registry([MODEL, MODEL], factories={})


if __name__ == "__main__":
    unittest.main()
