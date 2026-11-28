"""Local-only Stable Diffusion 3.5 Medium adapter.

The adapter loads only an already verified local model directory. It never
downloads weights, accepts remote code, or bypasses the ASTRA moderation gate.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from runtime_errors import GenerationError

MODEL_ID = "stabilityai/stable-diffusion-3.5-medium"
MAX_SIDE = 1024
MAX_PIXELS = 1_048_576
HASH_CHUNK = 1024 * 1024


class SD35AdapterError(RuntimeError):
    """Sanitized local SD3.5 runtime initialization error."""


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
        raise SD35AdapterError("A verified SD3.5 model artifact could not be read.") from None
    return digest.hexdigest()


def _verified_model_directory(model: dict[str, Any], model_dir: str | Path) -> Path:
    if (
        model.get("model_id") != MODEL_ID
        or model.get("modality") != "image"
        or model.get("runtime") != "diffusers"
        or model.get("license_reviewed_by_owner") is not True
        or model.get("license_id") != "stabilityai-community-license"
        or model.get("allow_remote_code") is not False
    ):
        raise SD35AdapterError("SD3.5 model identity, license review, or runtime policy is not approved.")

    root_input = Path(model_dir)
    if root_input.is_symlink():
        raise SD35AdapterError("SD3.5 model directory cannot be a symbolic link.")
    try:
        root = root_input.resolve(strict=True)
    except (OSError, RuntimeError):
        raise SD35AdapterError("SD3.5 local model directory is unavailable.") from None
    if not root.is_dir():
        raise SD35AdapterError("SD3.5 local model directory must be a directory.")

    files = model.get("files")
    if not isinstance(files, list) or not files:
        raise SD35AdapterError("SD3.5 model files have not been verified.")
    expected: set[str] = set()
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("resolved_path"), str):
            raise SD35AdapterError("SD3.5 model artifact manifest is invalid.")
        path = Path(item["resolved_path"])
        if path.is_symlink():
            raise SD35AdapterError("SD3.5 model artifacts cannot be symbolic links.")
        try:
            resolved = path.resolve(strict=True)
            relative = resolved.relative_to(root)
        except (OSError, ValueError, RuntimeError):
            raise SD35AdapterError("SD3.5 model artifact is outside its local model directory.") from None
        if not resolved.is_file():
            raise SD35AdapterError("SD3.5 model artifact is not a regular file.")
        before = resolved.stat()
        if type(item.get("size_bytes")) is not int or before.st_size != item["size_bytes"]:
            raise SD35AdapterError("SD3.5 model artifact size changed after verification.")
        if not isinstance(item.get("sha256"), str) or _hash_file(resolved) != item["sha256"]:
            raise SD35AdapterError("SD3.5 model artifact checksum changed after verification.")
        after = resolved.stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
        ):
            raise SD35AdapterError("SD3.5 model artifact changed while loading.")
        expected.add(relative.as_posix())

    actual: set[str] = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise SD35AdapterError("SD3.5 model directory contains a symbolic link.")
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    if actual != expected:
        raise SD35AdapterError("SD3.5 model directory contains missing or undeclared files.")
    return root


class SD35MediumAdapter:
    def __init__(self, pipeline: Any, torch_module: Any, model: dict[str, Any]):
        self.pipeline = pipeline
        self.torch = torch_module
        self.model_id = model["model_id"]
        self.revision = model["revision"]
        self.max_width = min(int(model["max_width"]), MAX_SIDE)
        self.max_height = min(int(model["max_height"]), MAX_SIDE)
        self.max_pixels = min(int(model["max_pixels"]), MAX_PIXELS)

    @classmethod
    def load(
        cls,
        model: dict[str, Any],
        *,
        model_dir: str | Path,
        pipeline_class: Any | None = None,
        torch_module: Any | None = None,
    ) -> "SD35MediumAdapter":
        local_dir = _verified_model_directory(model, model_dir)
        try:
            if torch_module is None:
                import torch as torch_module
            if pipeline_class is None:
                from diffusers import StableDiffusion3Pipeline as pipeline_class
        except ImportError:
            raise SD35AdapterError("The reviewed PyTorch/Diffusers runtime is not installed.") from None

        if not torch_module.cuda.is_available():
            raise SD35AdapterError("SD3.5 requires an approved CUDA GPU runtime.")
        minimum_vram_mb = model.get("min_vram_mb")
        if type(minimum_vram_mb) is not int or not 1024 <= minimum_vram_mb <= 131072:
            raise SD35AdapterError("SD3.5 minimum VRAM requirement is not configured.")
        try:
            free_bytes, total_bytes = torch_module.cuda.mem_get_info()
        except Exception:
            raise SD35AdapterError("ASTRA could not inspect available GPU memory.") from None
        if free_bytes < minimum_vram_mb * 1024 * 1024:
            raise SD35AdapterError("Insufficient free GPU memory for the configured SD3.5 runtime.")

        try:
            pipeline = pipeline_class.from_pretrained(
                str(local_dir),
                dtype=torch_module.float16,
                local_files_only=True,
                use_safetensors=True,
            )
            # Offload is intentionally required; SD3-family pipelines have
            # multiple text encoders and can exceed commodity GPU memory.
            offload = getattr(pipeline, "enable_model_cpu_offload", None)
            if not callable(offload):
                raise SD35AdapterError("The installed Diffusers pipeline lacks required CPU offload support.")
            offload()
            progress = getattr(pipeline, "set_progress_bar_config", None)
            if callable(progress):
                progress(disable=True)
        except SD35AdapterError:
            raise
        except Exception:
            raise SD35AdapterError("SD3.5 local model initialization failed.") from None
        return cls(pipeline, torch_module, model)

    def generate(self, job: dict[str, Any], *, output_dir: Path, cancel_event) -> Path:
        request = job.get("request")
        if not isinstance(request, dict):
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        prompt = request.get("compiled_prompt")
        width = request.get("width")
        height = request.get("height")
        steps = request.get("num_inference_steps", 28)
        guidance = request.get("guidance_scale", 4.5)
        seed = request.get("seed", 0)
        negative_prompt = request.get("negative_prompt", "")

        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if (
            type(width) is not int or type(height) is not int
            or width < 256 or height < 256
            or width > self.max_width or height > self.max_height
            or width % 8 or height % 8 or width * height > self.max_pixels
        ):
            raise GenerationError("OUTPUT_DIMENSION_MISMATCH", retryable=False)
        if type(steps) is not int or not 10 <= steps <= 50:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if isinstance(guidance, bool) or not isinstance(guidance, (int, float)) or not 0 <= guidance <= 15:
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
        output_path = root / "astra-sd35-output.png"
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
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    guidance_scale=float(guidance),
                    generator=generator,
                    num_images_per_prompt=1,
                    skip_guidance_layers=[7, 8, 9],
                    skip_layer_guidance_scale=2.8,
                    skip_layer_guidance_start=0.01,
                    skip_layer_guidance_stop=0.2,
                    callback_on_step_end=on_step_end,
                )
            if cancel_event.is_set():
                raise GenerationError("CANCELLED_BY_USER", retryable=False)
            images = getattr(result, "images", None)
            if not isinstance(images, list) or len(images) != 1:
                raise GenerationError("MODEL_OUTPUT_INVALID", retryable=False)
            images[0].save(output_path, format="PNG")
            if not output_path.is_file() or output_path.is_symlink():
                raise GenerationError("MODEL_OUTPUT_INVALID", retryable=False)
            return output_path
        except GenerationError:
            raise
        except Exception:
            raise GenerationError("INFERENCE_FAILED", retryable=False) from None


def make_sd35_factory(
    *,
    model_dir: str | Path,
    pipeline_class: Any | None = None,
    torch_module: Any | None = None,
):
    """Return a code-owned factory suitable for runtime_registry.build_adapter_registry."""
    def factory(model: dict[str, Any]) -> SD35MediumAdapter:
        return SD35MediumAdapter.load(
            model,
            model_dir=model_dir,
            pipeline_class=pipeline_class,
            torch_module=torch_module,
        )
    return factory
