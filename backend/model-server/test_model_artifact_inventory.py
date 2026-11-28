import json
import tempfile
import unittest
from pathlib import Path

from model_artifact_inventory import (
    InventoryError,
    build_inventory_manifest,
    write_manifest_exclusive,
)
from runtime_manifest import load_manifest_json

REVISION = "a" * 40


class ModelArtifactInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "model"
        self.root.mkdir()
        (self.root / "model.safetensors").write_bytes(b"safe-model-fixture")
        nested = self.root / "text_encoder"
        nested.mkdir()
        (nested / "config.json").write_text('{"fixture":true}', encoding="utf-8")

    def build(self, **overrides):
        values = {
            "model_root": self.root,
            "model_id": "example/model",
            "revision": REVISION,
            "modality": "image",
            "runtime": "diffusers",
            "license_id": "example-license",
            "min_vram_mb": 16000,
            "max_width": 1024,
            "max_height": 1024,
            "max_pixels": 1_000_000,
        }
        values.update(overrides)
        return build_inventory_manifest(**values)

    def test_creates_sorted_checksum_manifest_and_never_attests_license_review(self):
        payload = self.build()
        entry = payload["models"][0]
        self.assertEqual(
            [item["path"] for item in entry["files"]],
            ["model.safetensors", "text_encoder/config.json"],
        )
        self.assertFalse(entry["license_reviewed_by_owner"])
        self.assertFalse(entry["allow_remote_code"])
        self.assertEqual(len(load_manifest_json(json.dumps(payload))), 1)

    def test_rejects_mutable_model_revision(self):
        with self.assertRaisesRegex(InventoryError, "MODEL_REVISION_MUST_BE_IMMUTABLE"):
            self.build(revision="main")

    def test_rejects_symlinked_model_files(self):
        target = self.root / "model.safetensors"
        link = self.root / "linked.safetensors"
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("Symlinks are unavailable on this test host")
        with self.assertRaisesRegex(InventoryError, "MODEL_SYMLINK_FORBIDDEN"):
            self.build()

    def test_rejects_empty_model_directory(self):
        empty = Path(self.temp.name) / "empty"
        empty.mkdir()
        with self.assertRaisesRegex(InventoryError, "MODEL_DIRECTORY_EMPTY"):
            self.build(model_root=empty)

    def test_rejects_wan_runtime_for_image_modality(self):
        with self.assertRaisesRegex(InventoryError, "MODEL_RUNTIME_INVALID"):
            self.build(runtime="wan-video")

    def test_output_must_be_outside_model_root_and_must_not_overwrite(self):
        payload = self.build()
        inside = self.root / "manifest.json"
        with self.assertRaisesRegex(InventoryError, "MANIFEST_OUTPUT_MUST_BE_OUTSIDE_MODEL_ROOT"):
            write_manifest_exclusive(payload, inside, model_root=self.root)

        output = Path(self.temp.name) / "manifest.json"
        write_manifest_exclusive(payload, output, model_root=self.root)
        self.assertEqual(json.loads(output.read_text(encoding="utf-8")), payload)
        with self.assertRaisesRegex(InventoryError, "MANIFEST_OUTPUT_ALREADY_EXISTS"):
            write_manifest_exclusive(payload, output, model_root=self.root)


if __name__ == "__main__":
    unittest.main()
