import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from runtime_manifest import (
    RuntimeManifestError,
    load_manifest_json,
    verify_model_artifacts,
)

MODEL_ID = "astra/test-image"
REVISION = "a" * 40


class RuntimeManifestTests(unittest.TestCase):
    def make_manifest(self, path="weights/model.bin", *, allow_remote_code=False):
        return {
            "models": [{
                "model_id": MODEL_ID,
                "revision": REVISION,
                "modality": "image",
                "files": [{
                    "path": path,
                    "sha256": "0" * 64,
                    "size_bytes": 4,
                }],
                "max_vram_mb": 12000,
                "max_width": 1024,
                "max_height": 1024,
                "max_pixels": 1048576,
                "runtime": "diffusers",
                "allow_remote_code": allow_remote_code,
            }]
        }

    def test_manifest_requires_immutable_revision_and_exact_schema(self):
        payload = self.make_manifest()
        manifest = load_manifest_json(json.dumps(payload))
        self.assertEqual(manifest[0]["revision"], REVISION)
        payload["models"][0]["unexpected"] = True
        with self.assertRaises(RuntimeManifestError):
            load_manifest_json(json.dumps(payload))

        payload = self.make_manifest()
        payload["models"][0]["revision"] = "main"
        with self.assertRaises(RuntimeManifestError):
            load_manifest_json(json.dumps(payload))

    def test_manifest_forbids_remote_code_and_duplicate_model_revisions(self):
        with self.assertRaises(RuntimeManifestError):
            load_manifest_json(json.dumps(self.make_manifest(allow_remote_code=True)))
        payload = self.make_manifest()
        payload["models"].append(payload["models"][0])
        with self.assertRaises(RuntimeManifestError):
            load_manifest_json(json.dumps(payload))

    def test_manifest_rejects_path_traversal_and_duplicate_files(self):
        for path in ("../escape.bin", "/absolute.bin", "weights/../escape.bin", "weights//model.bin", "weights/./model.bin"):
            with self.subTest(path=path), self.assertRaises(RuntimeManifestError):
                load_manifest_json(json.dumps(self.make_manifest(path)))
        payload = self.make_manifest()
        payload["models"][0]["files"].append(dict(payload["models"][0]["files"][0]))
        with self.assertRaises(RuntimeManifestError):
            load_manifest_json(json.dumps(payload))

    def test_manifest_checks_capability_bounds_and_modality_runtime(self):
        payload = self.make_manifest()
        payload["models"][0]["max_pixels"] = 2_000_000
        with self.assertRaises(RuntimeManifestError):
            load_manifest_json(json.dumps(payload))
        payload = self.make_manifest()
        payload["models"][0]["runtime"] = "wan-video"
        with self.assertRaises(RuntimeManifestError):
            load_manifest_json(json.dumps(payload))

    def test_manifest_rejects_boolean_integer_fields(self):
        payload = self.make_manifest()
        payload["models"][0]["max_vram_mb"] = True
        with self.assertRaises(RuntimeManifestError):
            load_manifest_json(json.dumps(payload))

    def test_artifact_verification_checks_size_and_sha256(self):
        with tempfile.TemporaryDirectory() as root:
            model_file = Path(root) / "weights" / "model.bin"
            model_file.parent.mkdir()
            model_file.write_bytes(b"ASTR")
            payload = self.make_manifest()
            payload["models"][0]["files"][0]["sha256"] = hashlib.sha256(b"ASTR").hexdigest()
            manifest = load_manifest_json(json.dumps(payload))
            verified = verify_model_artifacts(manifest, model_root=root)
            self.assertEqual(verified[0]["files"][0]["resolved_path"], str(model_file.resolve()))

            model_file.write_bytes(b"DIFF")
            with self.assertRaises(RuntimeManifestError):
                verify_model_artifacts(manifest, model_root=root)

    def test_artifact_verification_rejects_missing_and_symlink_files(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            model_file = Path(root) / "weights" / "model.bin"
            model_file.parent.mkdir()
            outside_file = Path(outside) / "model.bin"
            outside_file.write_bytes(b"ASTR")
            payload = self.make_manifest()
            payload["models"][0]["files"][0]["sha256"] = hashlib.sha256(b"ASTR").hexdigest()
            manifest = load_manifest_json(json.dumps(payload))
            with self.assertRaises(RuntimeManifestError):
                verify_model_artifacts(manifest, model_root=root)

            try:
                model_file.symlink_to(outside_file)
            except (OSError, NotImplementedError):
                self.skipTest("Symlink creation unavailable on this platform.")
            with self.assertRaises(RuntimeManifestError):
                verify_model_artifacts(manifest, model_root=root)


if __name__ == "__main__":
    unittest.main()
