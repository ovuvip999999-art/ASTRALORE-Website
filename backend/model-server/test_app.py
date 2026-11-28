import json
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import (verify_token, model_is_configured, compile_creative_brief,
                 BriefCompileRequest, route_creative_model, ModelRouteRequest)


class AuthTests(unittest.TestCase):
    def test_missing_server_secret_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                verify_token("Bearer anything")
        self.assertEqual(raised.exception.status_code, 503)

    def test_short_server_secret_fails_closed(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "too-short"}):
            with self.assertRaises(HTTPException) as raised:
                verify_token("Bearer too-short")
        self.assertEqual(raised.exception.status_code, 503)

    def test_invalid_token_is_rejected(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret-value-with-at-least-32-characters"}):
            with self.assertRaises(HTTPException) as raised:
                verify_token("Bearer wrong-secret")
        self.assertEqual(raised.exception.status_code, 401)

    def test_valid_token_is_accepted(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret-value-with-at-least-32-characters"}):
            verify_token("Bearer correct-secret-value-with-at-least-32-characters")

    def test_model_is_not_ready_without_model_id(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(model_is_configured("image"))
            self.assertFalse(model_is_configured("video"))

    def test_brief_compile_endpoint_requires_auth_and_returns_compiled_brief(self):
        body = BriefCompileRequest(brief={"prompt": "A glass observatory", "lighting": "soft dawn"})
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret-value-with-at-least-32-characters"}):
            result = compile_creative_brief(body, "Bearer correct-secret-value-with-at-least-32-characters")
        self.assertIn("A glass observatory", result["compiled_prompt"])
        self.assertIn("Lighting: soft dawn", result["compiled_prompt"])

    def test_brief_compile_endpoint_rejects_invalid_brief(self):
        body = BriefCompileRequest(brief={"prompt": "A glass observatory", "unknown": "ignored?"})
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret-value-with-at-least-32-characters"}):
            with self.assertRaises(HTTPException) as raised:
                compile_creative_brief(body, "Bearer correct-secret-value-with-at-least-32-characters")
        self.assertEqual(raised.exception.status_code, 422)

    def test_model_route_endpoint_uses_explicit_catalog_model(self):
        catalog = [{
            "model_id": "astra-image-test-v1",
            "revision": "sha256:abc123",
            "provider": "local",
            "modalities": ["image"],
            "aspect_ratios": ["1:1"],
            "max_width": 512,
            "max_height": 512,
            "max_pixels": 262144,
            "min_vram_mb": 8000,
            "enabled": True,
        }]
        body = ModelRouteRequest(model_id="astra-image-test-v1", modality="image",
                                 aspect_ratio="1:1", width=512, height=512)
        with patch.dict(os.environ, {
            "ASTRA_MODEL_SERVER_TOKEN": "correct-secret-value-with-at-least-32-characters",
            "ASTRA_MODEL_CATALOG_JSON": json.dumps(catalog),
        }):
            result = route_creative_model(body, "Bearer correct-secret-value-with-at-least-32-characters")
        self.assertEqual(result["model_id"], "astra-image-test-v1")
        self.assertEqual(result["routing_policy"], "explicit-model-no-fallback")

    def test_model_route_endpoint_fails_closed_without_catalog(self):
        body = ModelRouteRequest(model_id="astra-image-test-v1", modality="image",
                                 aspect_ratio="1:1", width=512, height=512)
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret-value-with-at-least-32-characters"}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                route_creative_model(body, "Bearer correct-secret-value-with-at-least-32-characters")
        self.assertEqual(raised.exception.status_code, 422)

    def test_image_and_video_readiness_are_independent(self):
        with patch.dict(os.environ, {"ASTRA_IMAGE_MODEL_ID": "pinned-image-model"}, clear=True):
            self.assertTrue(model_is_configured("image"))
            self.assertFalse(model_is_configured("video"))


if __name__ == "__main__":
    unittest.main()
