"""Mocked tests for the local-only SD3.5 adapter; no model weights or GPU needed."""
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from threading import Event

from PIL import Image

from runtime_manifest import load_manifest_json, verify_model_artifacts
from sd35_adapter import MODEL_ID, SD35AdapterError, SD35MediumAdapter, make_sd35_factory
from runtime_registry import build_adapter_registry
from worker_runner import GenerationError

REVISION = "a" * 40


class FakeCuda:
    def __init__(self, *, available=True, free_mb=16000):
        self.available = available
        self.free_mb = free_mb

    def is_available(self):
        return self.available

    def mem_get_info(self):
        return self.free_mb * 1024 * 1024, 24576 * 1024 * 1024


class FakeGenerator:
    def __init__(self, device):
        self.device = device
        self.seed = None

    def manual_seed(self, seed):
        self.seed = seed
        return self


class FakeTorch:
    float16 = "float16"
    cuda = FakeCuda()
    Generator = FakeGenerator

    @staticmethod
    def inference_mode():
        return nullcontext()


class FakeImage:
    def save(self, path, format):
        Image.new("RGB", (512, 512), (15, 25, 35)).save(path, format=format)


class FakePipeline:
    def __init__(self, *, cancel_event=None, fail=False):
        self.cancel_event = cancel_event
        self.fail = fail
        self.load_options = None
        self.call_options = None
        self.offload_enabled = False
        self.progress_disabled = False

    def enable_model_cpu_offload(self):
        self.offload_enabled = True

    def set_progress_bar_config(self, *, disable):
        self.progress_disabled = disable

    def __call__(self, **kwargs):
        self.call_options = kwargs
        if self.cancel_event is not None:
            self.cancel_event.set()
        kwargs["callback_on_step_end"](self, 1, 0)
        if self.fail:
            raise RuntimeError("private model detail")
        return SimpleNamespace(images=[FakeImage()])


class FakePipelineClass:
    pipeline = None
    options = None

    @classmethod
    def from_pretrained(cls, model_dir, **kwargs):
        cls.options = {"model_dir": model_dir, **kwargs}
        cls.pipeline = FakePipeline()
        return cls.pipeline


class SD35AdapterTests(unittest.TestCase):
    def build_model(self, root):
        model_dir = Path(root)
        (model_dir / "transformer").mkdir(parents=True)
        (model_dir / "transformer" / "weights.safetensors").write_bytes(b"weights")
        (model_dir / "model_index.json").write_text('{"_class_name":"StableDiffusion3Pipeline"}', encoding="utf-8")
        payload = {
            "models": [{
                "model_id": MODEL_ID,
                "revision": REVISION,
                "modality": "image",
                "files": [
                    {
                        "path": "model_index.json",
                        "sha256": __import__("hashlib").sha256((model_dir / "model_index.json").read_bytes()).hexdigest(),
                        "size_bytes": (model_dir / "model_index.json").stat().st_size,
                    },
                    {
                        "path": "transformer/weights.safetensors",
                        "sha256": __import__("hashlib").sha256((model_dir / "transformer" / "weights.safetensors").read_bytes()).hexdigest(),
                        "size_bytes": (model_dir / "transformer" / "weights.safetensors").stat().st_size,
                    },
                ],
                "min_vram_mb": 10240,
                "max_width": 1024,
                "max_height": 1024,
                "max_pixels": 1048576,
                "runtime": "diffusers",
                "allow_remote_code": False,
                "license_id": "stabilityai-community-license",
                "license_reviewed_by_owner": True,
            }]
        }
        verified = verify_model_artifacts(load_manifest_json(__import__("json").dumps(payload)), model_root=root)
        return verified[0]

    def test_loads_only_verified_local_weights_and_requires_offload(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            adapter = SD35MediumAdapter.load(
                model,
                model_dir=root,
                pipeline_class=FakePipelineClass,
                torch_module=FakeTorch,
            )
        self.assertEqual(adapter.model_id, MODEL_ID)
        self.assertEqual(adapter.revision, REVISION)
        self.assertTrue(FakePipelineClass.pipeline.offload_enabled)
        self.assertTrue(FakePipelineClass.pipeline.progress_disabled)
        self.assertTrue(FakePipelineClass.options["local_files_only"])
        self.assertTrue(FakePipelineClass.options["use_safetensors"])
        self.assertEqual(FakePipelineClass.options["dtype"], FakeTorch.float16)

    def test_load_refuses_unreviewed_license_wrong_model_and_cpu_only(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            pending = dict(model)
            pending["license_reviewed_by_owner"] = False
            with self.assertRaises(SD35AdapterError):
                SD35MediumAdapter.load(pending, model_dir=root, pipeline_class=FakePipelineClass, torch_module=FakeTorch)
            wrong = dict(model)
            wrong["model_id"] = "other/model"
            with self.assertRaises(SD35AdapterError):
                SD35MediumAdapter.load(wrong, model_dir=root, pipeline_class=FakePipelineClass, torch_module=FakeTorch)
            cpu = SimpleNamespace(cuda=FakeCuda(available=False), float16="float16")
            with self.assertRaises(SD35AdapterError):
                SD35MediumAdapter.load(model, model_dir=root, pipeline_class=FakePipelineClass, torch_module=cpu)

    def test_load_refuses_insufficient_free_vram_and_extra_unmanifested_files(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            low_gpu = SimpleNamespace(cuda=FakeCuda(free_mb=2048), float16="float16")
            with self.assertRaises(SD35AdapterError):
                SD35MediumAdapter.load(model, model_dir=root, pipeline_class=FakePipelineClass, torch_module=low_gpu)
            (Path(root) / "unlisted.bin").write_bytes(b"extra")
            with self.assertRaises(SD35AdapterError):
                SD35MediumAdapter.load(model, model_dir=root, pipeline_class=FakePipelineClass, torch_module=FakeTorch)

    def test_sd35_factory_registers_only_through_verified_runtime_registry(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            factory = make_sd35_factory(
                model_dir=root,
                pipeline_class=FakePipelineClass,
                torch_module=FakeTorch,
            )
            registry = build_adapter_registry([model], factories={"diffusers": factory})
        adapter = registry[(MODEL_ID, REVISION)]
        self.assertIsInstance(adapter, SD35MediumAdapter)

    def test_load_rechecks_sha256_if_model_file_changes_after_manifest_verification(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            (Path(root) / "transformer" / "weights.safetensors").write_bytes(b"changed")
            with self.assertRaises(SD35AdapterError):
                SD35MediumAdapter.load(
                    model,
                    model_dir=root,
                    pipeline_class=FakePipelineClass,
                    torch_module=FakeTorch,
                )

    def test_generate_uses_bounded_deterministic_settings_and_saves_png(self):
        with tempfile.TemporaryDirectory() as model_root, tempfile.TemporaryDirectory() as output_root:
            model = self.build_model(model_root)
            adapter = SD35MediumAdapter.load(model, model_dir=model_root, pipeline_class=FakePipelineClass, torch_module=FakeTorch)
            output = adapter.generate({
                "request": {
                    "compiled_prompt": "A cinematic blue planet",
                    "width": 512,
                    "height": 512,
                    "num_inference_steps": 28,
                    "guidance_scale": 4.5,
                    "seed": 123,
                }
            }, output_dir=Path(output_root), cancel_event=Event())
            self.assertTrue(output.is_file())
            with Image.open(output) as image:
                self.assertEqual(image.size, (512, 512))
            self.assertEqual(FakePipelineClass.pipeline.call_options["num_inference_steps"], 28)
            self.assertEqual(FakePipelineClass.pipeline.call_options["skip_guidance_layers"], [7, 8, 9])

    def test_generation_rejects_bad_dimensions_and_cancellation(self):
        with tempfile.TemporaryDirectory() as model_root, tempfile.TemporaryDirectory() as output_root:
            model = self.build_model(model_root)
            adapter = SD35MediumAdapter.load(model, model_dir=model_root, pipeline_class=FakePipelineClass, torch_module=FakeTorch)
            with self.assertRaises(GenerationError):
                adapter.generate({
                    "request": {"compiled_prompt": "A planet", "width": 2048, "height": 2048}
                }, output_dir=Path(output_root), cancel_event=Event())
            event = Event()
            event.set()
            with self.assertRaises(GenerationError):
                adapter.generate({
                    "request": {"compiled_prompt": "A planet", "width": 512, "height": 512}
                }, output_dir=Path(output_root), cancel_event=event)


if __name__ == "__main__":
    unittest.main()
