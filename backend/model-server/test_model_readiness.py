import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from runtime_manifest import verify_model_artifacts
from model_readiness import (
    ModelReadinessError,
    inspect_manifest,
    inspect_model_package,
    SD35_ID,
    WAN_ID,
)

REVISION = "b" * 40


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


class ModelReadinessTests(unittest.TestCase):
    def build_package(self, root: Path, model_id: str, *, reviewed=False):
        is_image = model_id == SD35_ID
        pipeline = "StableDiffusion3Pipeline" if is_image else "WanPipeline"
        components = (
            {
                "scheduler": ("scheduler_config.json",),
                "text_encoder": ("config.json",),
                "text_encoder_2": ("config.json",),
                "text_encoder_3": ("config.json",),
                "tokenizer": ("tokenizer_config.json",),
                "tokenizer_2": ("tokenizer_config.json",),
                "tokenizer_3": ("tokenizer_config.json",),
                "transformer": ("config.json",),
                "vae": ("config.json",),
            } if is_image else {
                "scheduler": ("scheduler_config.json",),
                "text_encoder": ("config.json",),
                "tokenizer": ("tokenizer_config.json",),
                "transformer": ("config.json",),
                "vae": ("config.json",),
            }
        )
        write_json(root / "model_index.json", {"_class_name": pipeline})
        files = []
        for component, names in components.items():
            for name in names:
                path = root / component / name
                if name.endswith(".json"):
                    write_json(path, {"fixture": True})
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"fixture-safetensors-data")
        weight_components = ("text_encoder", "text_encoder_2", "text_encoder_3", "transformer", "vae") if is_image else ("text_encoder", "transformer", "vae")
        for component in weight_components:
            (root / component / "model-00001-of-00001.safetensors").write_bytes(b"fixture-safetensors-data")
        for path in sorted(p for p in root.rglob("*") if p.is_file()):
            relative = path.relative_to(root).as_posix()
            files.append({
                "path": relative,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "size_bytes": path.stat().st_size,
            })
        model = {
            "model_id": model_id,
            "revision": REVISION,
            "modality": "image" if is_image else "video",
            "files": files,
            "min_vram_mb": 16000,
            "max_width": 1024 if is_image else 832,
            "max_height": 1024 if is_image else 480,
            "max_pixels": 1_000_000 if is_image else 399360,
            "runtime": "diffusers" if is_image else "wan-video",
            "allow_remote_code": False,
            "license_id": "stabilityai-community-license" if is_image else "apache-2.0",
            "license_reviewed_by_owner": reviewed,
        }
        return verify_model_artifacts([model], model_root=root)[0]

    def test_sd35_structure_valid_but_unreviewed_license_is_not_inference_eligible(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self.build_package(root, SD35_ID, reviewed=False)
            report = inspect_model_package(model, model_root=root)
        self.assertTrue(report["structure_valid"])
        self.assertFalse(report["inference_eligible"])
        self.assertFalse(report["inference_performed"])
        self.assertEqual(len(report["checked_components"]), 9)

    def test_wan_structure_valid_only_after_explicit_license_review(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self.build_package(root, WAN_ID, reviewed=True)
            report = inspect_model_package(model, model_root=root)
        self.assertTrue(report["structure_valid"])
        self.assertTrue(report["inference_eligible"])
        self.assertFalse(report["inference_performed"])

    def test_rejects_missing_component_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self.build_package(root, WAN_ID, reviewed=True)
            (root / "vae" / "config.json").unlink()
            with self.assertRaises(ModelReadinessError):
                inspect_model_package(model, model_root=root)

    def test_accepts_sharded_safetensors_and_requires_every_shard_in_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self.build_package(root, WAN_ID, reviewed=True)
            transformer = root / "transformer"
            (transformer / "model-00002-of-00002.safetensors").write_bytes(b"second-shard-data")
            # The new shard is deliberately absent from the manifest.
            with self.assertRaisesRegex(ModelReadinessError, "MODEL_WEIGHT_FILE_NOT_IN_MANIFEST"):
                inspect_model_package(model, model_root=root)

    def test_rejects_wrong_pipeline_class(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self.build_package(root, WAN_ID, reviewed=True)
            write_json(root / "model_index.json", {"_class_name": "WrongPipeline"})
            with self.assertRaises(ModelReadinessError):
                inspect_model_package(model, model_root=root)

    def test_inspect_manifest_verifies_checksums_before_package_inspection(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self.build_package(root, WAN_ID, reviewed=True)
            raw = json.dumps({"models": [model]})
            reports = inspect_manifest(raw, model_root=root)
        self.assertEqual(len(reports), 1)
        self.assertTrue(reports[0]["structure_valid"])
        self.assertFalse(reports[0]["inference_performed"])


if __name__ == "__main__":
    unittest.main()
