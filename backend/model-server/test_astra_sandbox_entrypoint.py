import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import astra_sandbox_entrypoint as entrypoint


class EntrypointProtocolTests(unittest.TestCase):
    def test_accepts_exact_bounded_request_shape(self):
        request = {
            "model_id": "astra-image",
            "model_revision": "a" * 40,
            "job": {"id": "job-1"},
            "manifest": {"models": []},
        }
        with patch.object(entrypoint.sys, "stdin", io.TextIOWrapper(io.BytesIO(
            json.dumps(request).encode("utf-8")
        ))):
            self.assertEqual(entrypoint._read_request(), request)

    def test_rejects_unknown_request_fields(self):
        request = {
            "model_id": "astra-image",
            "model_revision": "a" * 40,
            "job": {},
            "manifest": {"models": []},
            "extra": True,
        }
        with patch.object(entrypoint.sys, "stdin", io.TextIOWrapper(io.BytesIO(
            json.dumps(request).encode("utf-8")
        ))):
            with self.assertRaises(entrypoint.EntrypointError):
                entrypoint._read_request()

    def test_wan_factory_uses_code_owned_factory_name(self):
        expected = object()
        model = {"runtime": "wan-video"}
        with patch.object(entrypoint, "_model_directory", return_value=Path("/models/wan")), \
             patch.object(entrypoint, "make_wan_factory", return_value=lambda _model: expected) as factory:
            self.assertIs(entrypoint._factory("wan-video", model), expected)
        factory.assert_called_once_with(model_dir=Path("/models/wan"))

    def test_model_directory_must_remain_inside_model_root(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            root_path = Path(root)
            outside_file = Path(outside) / "weights.safetensors"
            outside_file.write_bytes(b"x")
            model = {"files": [{"resolved_path": str(outside_file)}]}
            with patch.object(entrypoint, "MODEL_ROOT", root_path):
                with self.assertRaises(entrypoint.EntrypointError):
                    entrypoint._model_directory(model)


if __name__ == "__main__":
    unittest.main()
