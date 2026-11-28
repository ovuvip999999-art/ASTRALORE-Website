"""Local-only Wan2.1 T2V 1.3B Diffusers adapter (480p baseline)."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from runtime_errors import GenerationError

MODEL_ID = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
WIDTH = 832
HEIGHT = 480
NUM_FRAMES = 81
FPS = 16
MAX_PIXELS = WIDTH * HEIGHT
HASH_CHUNK = 1024 * 1024


class WanAdapterError(RuntimeError):
    """Sanitized local Wan runtime initialization error."""


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while True:
                block = handle.read(HASH_CHUNK)
                if not block:
                    break
                digest.update(block)
    except OSError:
        raise WanAdapterError("A verified Wan model artifact could not be read.") from None
    return digest.hexdigest()


def _verified_model_directory(model: dict[str, Any], model_dir: str | Path) -> Path:
    if (
        model.get("model_id") != MODEL_ID
        or model.get("modality") != "video"
        or model.get("runtime") != "wan-video"
        or model.get("license_reviewed_by_owner") is not True
        or model.get("license_id") != "apache-2.0"
        or model.get("allow_remote_code") is not False
    ):
        raise WanAdapterError("Wan model identity, license review, or runtime policy is not approved.")

    root_input = Path(model_dir)
    if root_input.is_symlink():
        raise WanAdapterError("Wan model directory cannot be a symbolic link.")
    try:
        root = root_input.resolve(strict=True)
    except (OSError, RuntimeError):
        raise WanAdapterError("Wan local model directory is unavailable.") from None
    if not root.is_dir():
        raise WanAdapterError("Wan local model directory must be a directory.")

    if (
        type(model.get("max_width")) is not int or model["max_width"] < WIDTH
        or type(model.get("max_height")) is not int or model["max_height"] < HEIGHT
        or type(model.get("max_pixels")) is not int or model["max_pixels"] < MAX_PIXELS
    ):
        raise WanAdapterError("Wan model capability manifest does not support the 480p baseline.")

    files = model.get("files")
    if not isinstance(files, list) or not files:
        raise WanAdapterError("Wan model files have not been verified.")
    expected: set[str] = set()
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("resolved_path"), str):
            raise WanAdapterError("Wan model artifact manifest is invalid.")
        path = Path(item["resolved_path"])
        if path.is_symlink():
            raise WanAdapterError("Wan model artifacts cannot be symbolic links.")
        try:
            resolved = path.resolve(strict=True)
            relative = resolved.relative_to(root)
        except (OSError, ValueError, RuntimeError):
            raise WanAdapterError("Wan model artifact is outside its local model directory.") from None
        if not resolved.is_file():
            raise WanAdapterError("Wan model artifact is not a regular file.")
        before = resolved.stat()
        if type(item.get("size_bytes")) is not int or before.st_size != item["size_bytes"]:
            raise WanAdapterError("Wan model artifact size changed after verification.")
        if not isinstance(item.get("sha256"), str) or _hash_file(resolved) != item["sha256"]:
            raise WanAdapterError("Wan model artifact checksum changed after verification.")
        after = resolved.stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
        ):
            raise WanAdapterError("Wan model artifact changed while loading.")
        expected.add(relative.as_posix())

    actual: set[str] = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise WanAdapterError("Wan model directory contains a symbolic link.")
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    if actual != expected:
        raise WanAdapterError("Wan model directory contains missing or undeclared files.")
    return root


class Wan21T2VAdapter:
    def __init__(self, pipeline: Any, torch_module: Any, exporter: Any, model: dict[str, Any]):
        self.pipeline = pipeline
        self.torch = torch_module
        self.exporter = exporter
        self.model_id = model["model_id"]
        self.revision = model["revision"]

    @classmethod
    def load(
        cls,
        model: dict[str, Any],
        *,
        model_dir: str | Path,
        auto_model_class: Any | None = None,
        pipeline_class: Any | None = None,
        scheduler_class: Any | None = None,
        exporter: Any | None = None,
        torch_module: Any | None = None,
    ) -> "Wan21T2VAdapter":
        local_dir = _verified_model_directory(model, model_dir)
        try:
            if torch_module is None:
                import torch as torch_module
            if auto_model_class is None:
                from diffusers import AutoModel as auto_model_class
            if pipeline_class is None:
                from diffusers import WanPipeline as pipeline_class
            if scheduler_class is None:
                from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler as scheduler_class
            if exporter is None:
                from diffusers.utils import export_to_video as exporter
        except ImportError:
            raise WanAdapterError("The reviewed PyTorch/Diffusers video runtime is not installed.") from None

        if not torch_module.cuda.is_available():
            raise WanAdapterError("Wan requires an approved CUDA GPU runtime.")
        supports_bf16 = getattr(torch_module.cuda, "is_bf16_supported", None)
        if not callable(supports_bf16) or not supports_bf16():
            raise WanAdapterError("Wan requires a CUDA GPU with bfloat16 support.")
        minimum_vram_mb = model.get("min_vram_mb")
        if type(minimum_vram_mb) is not int or not 1024 <= minimum_vram_mb <= 131072:
            raise WanAdapterError("Wan minimum VRAM requirement is not configured.")
        try:
            free_bytes, _total_bytes = torch_module.cuda.mem_get_info()
        except Exception:
            raise WanAdapterError("ASTRA could not inspect available GPU memory.") from None
        if free_bytes < minimum_vram_mb * 1024 * 1024:
            raise WanAdapterError("Insufficient free GPU memory for the configured Wan runtime.")

        try:
            vae = auto_model_class.from_pretrained(
                str(local_dir),
                subfolder="vae",
                dtype=torch_module.float32,
                local_files_only=True,
                use_safetensors=True,
            )
            pipeline = pipeline_class.from_pretrained(
                str(local_dir),
                vae=vae,
                dtype=torch_module.bfloat16,
                local_files_only=True,
                use_safetensors=True,
            )
            pipeline.scheduler = scheduler_class.from_config(
                pipeline.scheduler.config,
                flow_shift=3.0,
            )
            offload = getattr(pipeline, "enable_model_cpu_offload", None)
            if not callable(offload):
                raise WanAdapterError("The installed Wan pipeline lacks required CPU offload support.")
            offload()
            progress = getattr(pipeline, "set_progress_bar_config", None)
            if callable(progress):
                progress(disable=True)
        except WanAdapterError:
            raise
        except Exception:
            raise WanAdapterError("Wan local model initialization failed.") from None
        return cls(pipeline, torch_module, exporter, model)

    def generate(self, job: dict[str, Any], *, output_dir: Path, cancel_event) -> Path:
        request = job.get("request")
        if not isinstance(request, dict):
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        prompt = request.get("compiled_prompt")
        negative_prompt = request.get("negative_prompt", "")
        width = request.get("width")
        height = request.get("height")
        duration = request.get("duration_seconds", 5)
        steps = request.get("num_inference_steps", 50)
        guidance = request.get("guidance_scale", 5.0)
        seed = request.get("seed", 0)

        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if width != WIDTH or height != HEIGHT:
            raise GenerationError("OUTPUT_DIMENSION_MISMATCH", retryable=False)
        if type(duration) is not int or duration != 5:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if type(steps) is not int or not 20 <= steps <= 50:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if isinstance(guidance, bool) or not isinstance(guidance, (int, float)) or not 1 <= guidance <= 10:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if type(seed) is not int or not 0 <= seed <= 4_294_967_295:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if not isinstance(negative_prompt, str) or len(negative_prompt) > 1000:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if cancel_event.is_set():
            raise GenerationError("CANCELLED_BY_USER", retryable=False)

        root = Path(output_dir).resolve(strict=True)
        if not root.is_dir() or Path(output_dir).is_symlink():
            raise GenerationError("OUTPUT_VALIDATION_FAILED", retryable=False)
        output_path = root / "astra-wan-output.mp4"
        if output_path.exists() or output_path.is_symlink():
            raise GenerationError("OUTPUT_VALIDATION_FAILED", retryable=False)

        def on_step_end(_pipeline, _step, _timestep, callback_kwargs):
            if cancel_event.is_set():
                raise GenerationError("CANCELLED_BY_USER", retryable=False)
            return callback_kwargs

        try:
            generator = self.torch.Generator(device="cuda").manual_seed(seed)
            with self.torch.inference_mode():
                result = self.pipeline(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    height=HEIGHT,
                    width=WIDTH,
                    num_frames=NUM_FRAMES,
                    num_inference_steps=steps,
                    guidance_scale=float(guidance),
                    generator=generator,
                    callback_on_step_end=on_step_end,
                )
            if cancel_event.is_set():
                raise GenerationError("CANCELLED_BY_USER", retryable=False)
            videos = getattr(result, "frames", None)
            if not isinstance(videos, list) or len(videos) != 1 or not videos[0]:
                raise GenerationError("MODEL_OUTPUT_INVALID", retryable=False)
            self.exporter(videos[0], str(output_path), fps=FPS)
            if not output_path.is_file() or output_path.is_symlink():
                raise GenerationError("MODEL_OUTPUT_INVALID", retryable=False)
            return output_path
        except GenerationError:
            raise
        except Exception:
            raise GenerationError("INFERENCE_FAILED", retryable=False) from None


def make_wan_factory(
    *,
    model_dir: str | Path,
    auto_model_class: Any | None = None,
    pipeline_class: Any | None = None,
    scheduler_class: Any | None = None,
    exporter: Any | None = None,
    torch_module: Any | None = None,
):
    """Return a code-owned factory suitable for runtime_registry.build_adapter_registry."""
    def factory(model: dict[str, Any]) -> Wan21T2VAdapter:
        return Wan21T2VAdapter.load(
            model,
            model_dir=model_dir,
            auto_model_class=auto_model_class,
            pipeline_class=pipeline_class,
            scheduler_class=scheduler_class,
            exporter=exporter,
            torch_module=torch_module,
        )
    return factory
