import hashlib
import json
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from threading import Event

from runtime_manifest import load_manifest_json, verify_model_artifacts
from runtime_registry import build_adapter_registry
from wan21_adapter import MODEL_ID, Wan21T2VAdapter, WanAdapterError, make_wan_factory
from worker_runner import GenerationError

REVISION = "b" * 40


class FakeCuda:
    def __init__(self, *, available=True, bf16=True, free_mb=16000):
        self.available = available
        self.bf16 = bf16
        self.free_mb = free_mb

    def is_available(self):
        return self.available

    def is_bf16_supported(self):
        return self.bf16

    def mem_get_info(self):
        return self.free_mb * 1024 * 1024, 24576 * 1024 * 1024


class FakeGenerator:
    def __init__(self, device):
        self.device = device

    def manual_seed(self, seed):
        self.seed = seed
        return self


class FakeTorch:
    float32 = "float32"
    bfloat16 = "bfloat16"
    cuda = FakeCuda()
    Generator = FakeGenerator

    @staticmethod
    def inference_mode():
        return nullcontext()


class FakeAutoModel:
    options = None

    @classmethod
    def from_pretrained(cls, model_dir, **kwargs):
        cls.options = {"model_dir": model_dir, **kwargs}
        return "fake-vae"


class FakePipeline:
    def __init__(self):
        self.scheduler = SimpleNamespace(config={"scheduler": "test"})
        self.offload_enabled = False
        self.progress_disabled = False
        self.call_options = None

    def enable_model_cpu_offload(self):
        self.offload_enabled = True

    def set_progress_bar_config(self, *, disable):
        self.progress_disabled = disable

    def __call__(self, **kwargs):
        self.call_options = kwargs
        kwargs["callback_on_step_end"](self, 1, 0, {})
        return SimpleNamespace(frames=[["frame-1", "frame-2"]])


class FakePipelineClass:
    pipeline = None
    options = None

    @classmethod
    def from_pretrained(cls, model_dir, **kwargs):
        cls.options = {"model_dir": model_dir, **kwargs}
        cls.pipeline = FakePipeline()
        return cls.pipeline


class FakeScheduler:
    options = None

    @classmethod
    def from_config(cls, config, *, flow_shift):
        cls.options = {"config": config, "flow_shift": flow_shift}
        return {"scheduler": "configured"}


class FakeExporter:
    calls = []

    @classmethod
    def export(cls, frames, path, *, fps):
        cls.calls.append({"frames": frames, "path": path, "fps": fps})
        Path(path).write_bytes(b"mocked mp4 container")


class WanAdapterTests(unittest.TestCase):
    def build_model(self, root):
        model_dir = Path(root)
        (model_dir / "transformer").mkdir(parents=True)
        (model_dir / "transformer" / "weights.safetensors").write_bytes(b"wanweights")
        (model_dir / "model_index.json").write_text('{"_class_name":"WanPipeline"}', encoding="utf-8")
        payload = {
            "models": [{
                "model_id": MODEL_ID,
                "revision": REVISION,
                "modality": "video",
                "files": [
                    {
                        "path": "model_index.json",
                        "sha256": hashlib.sha256((model_dir / "model_index.json").read_bytes()).hexdigest(),
                        "size_bytes": (model_dir / "model_index.json").stat().st_size,
                    },
                    {
                        "path": "transformer/weights.safetensors",
                        "sha256": hashlib.sha256((model_dir / "transformer" / "weights.safetensors").read_bytes()).hexdigest(),
                        "size_bytes": (model_dir / "transformer" / "weights.safetensors").stat().st_size,
                    },
                ],
                "min_vram_mb": 13312,
                "max_width": 832,
                "max_height": 480,
                "max_pixels": 399360,
                "runtime": "wan-video",
                "allow_remote_code": False,
                "license_id": "apache-2.0",
                "license_reviewed_by_owner": True,
            }]
        }
        manifest = load_manifest_json(json.dumps(payload))
        return verify_model_artifacts(manifest, model_root=root)[0]

    def load_adapter(self, model, root, torch_module=FakeTorch):
        FakeExporter.calls.clear()
        return Wan21T2VAdapter.load(
            model,
            model_dir=root,
            auto_model_class=FakeAutoModel,
            pipeline_class=FakePipelineClass,
            scheduler_class=FakeScheduler,
            exporter=FakeExporter.export,
            torch_module=torch_module,
        )

    def test_loads_only_verified_local_weights_with_cpu_offload_and_480p_scheduler(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            adapter = self.load_adapter(model, root)
        self.assertEqual(adapter.model_id, MODEL_ID)
        self.assertEqual(adapter.revision, REVISION)
        self.assertTrue(FakeAutoModel.options["local_files_only"])
        self.assertTrue(FakeAutoModel.options["use_safetensors"])
        self.assertTrue(FakePipelineClass.options["local_files_only"])
        self.assertTrue(FakePipelineClass.options["use_safetensors"])
        self.assertEqual(FakeAutoModel.options["dtype"], FakeTorch.float32)
        self.assertEqual(FakePipelineClass.options["dtype"], FakeTorch.bfloat16)
        self.assertEqual(FakeScheduler.options["flow_shift"], 3.0)
        self.assertTrue(FakePipelineClass.pipeline.offload_enabled)
        self.assertTrue(FakePipelineClass.pipeline.progress_disabled)

    def test_load_refuses_unreviewed_license_wrong_runtime_cpu_non_bf16_and_low_vram(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            pending = dict(model)
            pending["license_reviewed_by_owner"] = False
            with self.assertRaises(WanAdapterError):
                self.load_adapter(pending, root)

            wrong = dict(model)
            wrong["runtime"] = "diffusers"
            with self.assertRaises(WanAdapterError):
                self.load_adapter(wrong, root)

            cpu = SimpleNamespace(cuda=FakeCuda(available=False), bfloat16="bf16", float32="f32")
            with self.assertRaises(WanAdapterError):
                self.load_adapter(model, root, cpu)

            no_bf16 = SimpleNamespace(cuda=FakeCuda(bf16=False), bfloat16="bf16", float32="f32")
            with self.assertRaises(WanAdapterError):
                self.load_adapter(model, root, no_bf16)

            low_gpu = SimpleNamespace(cuda=FakeCuda(free_mb=2048, bf16=True), bfloat16="bf16", float32="f32")
            with self.assertRaises(WanAdapterError):
                self.load_adapter(model, root, low_gpu)

    def test_load_rechecks_checksums_and_rejects_undeclared_files(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            (Path(root) / "transformer" / "weights.safetensors").write_bytes(b"tampered!!")
            with self.assertRaises(WanAdapterError):
                self.load_adapter(model, root)

        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            (Path(root) / "extra.bin").write_bytes(b"extra")
            with self.assertRaises(WanAdapterError):
                self.load_adapter(model, root)

    def test_factory_registers_wan_only_through_verified_runtime_registry(self):
        with tempfile.TemporaryDirectory() as root:
            model = self.build_model(root)
            factory = make_wan_factory(
                model_dir=root,
                auto_model_class=FakeAutoModel,
                pipeline_class=FakePipelineClass,
                scheduler_class=FakeScheduler,
                exporter=FakeExporter.export,
                torch_module=FakeTorch,
            )
            registry = build_adapter_registry([model], factories={"wan-video": factory})
        self.assertIsInstance(registry[(MODEL_ID, REVISION)], Wan21T2VAdapter)

    def test_generate_uses_bounded_480p_81_frame_pipeline_and_exports_mp4(self):
        with tempfile.TemporaryDirectory() as model_root, tempfile.TemporaryDirectory() as output_root:
            model = self.build_model(model_root)
            adapter = self.load_adapter(model, model_root)
            output = adapter.generate({
                "request": {
                    "compiled_prompt": "A cinematic sunrise over a quiet ocean",
                    "negative_prompt": "blurry",
                    "width": 832,
                    "height": 480,
                    "duration_seconds": 5,
                    "num_inference_steps": 40,
                    "guidance_scale": 5.0,
                    "seed": 321,
                }
            }, output_dir=Path(output_root), cancel_event=Event())
            self.assertTrue(output.is_file())
            self.assertEqual(FakePipelineClass.pipeline.call_options["num_frames"], 81)
            self.assertEqual(FakePipelineClass.pipeline.call_options["width"], 832)
            self.assertEqual(FakePipelineClass.pipeline.call_options["height"], 480)
            self.assertEqual(FakeExporter.calls[0]["fps"], 16)

    def test_generate_rejects_wrong_dimensions_duration_and_cancellation(self):
        with tempfile.TemporaryDirectory() as model_root, tempfile.TemporaryDirectory() as output_root:
            model = self.build_model(model_root)
            adapter = self.load_adapter(model, model_root)
            with self.assertRaises(GenerationError):
                adapter.generate({
                    "request": {"compiled_prompt": "A sunrise", "width": 1280, "height": 720, "duration_seconds": 5}
                }, output_dir=Path(output_root), cancel_event=Event())
            with self.assertRaises(GenerationError):
                adapter.generate({
                    "request": {"compiled_prompt": "A sunrise", "width": 832, "height": 480, "duration_seconds": 10}
                }, output_dir=Path(output_root), cancel_event=Event())
            event = Event()
            event.set()
            with self.assertRaises(GenerationError):
                adapter.generate({
                    "request": {"compiled_prompt": "A sunrise", "width": 832, "height": 480, "duration_seconds": 5}
                }, output_dir=Path(output_root), cancel_event=event)


if __name__ == "__main__":
    unittest.main()
