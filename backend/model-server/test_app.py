import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import verify_token, model_is_configured, compile_creative_brief, BriefCompileRequest


class AuthTests(unittest.TestCase):
    def test_missing_server_secret_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                verify_token("Bearer anything")
        self.assertEqual(raised.exception.status_code, 503)

    def test_invalid_token_is_rejected(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret"}):
            with self.assertRaises(HTTPException) as raised:
                verify_token("Bearer wrong-secret")
        self.assertEqual(raised.exception.status_code, 401)

    def test_valid_token_is_accepted(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret"}):
            verify_token("Bearer correct-secret")

    def test_model_is_not_ready_without_model_id(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(model_is_configured("image"))
            self.assertFalse(model_is_configured("video"))

    def test_brief_compile_endpoint_requires_auth_and_returns_compiled_brief(self):
        body = BriefCompileRequest(brief={"prompt": "A glass observatory", "lighting": "soft dawn"})
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret"}):
            result = compile_creative_brief(body, "Bearer correct-secret")
        self.assertIn("A glass observatory", result["compiled_prompt"])
        self.assertIn("Lighting: soft dawn", result["compiled_prompt"])

    def test_brief_compile_endpoint_rejects_invalid_brief(self):
        body = BriefCompileRequest(brief={"prompt": "A glass observatory", "unknown": "ignored?"})
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": "correct-secret"}):
            with self.assertRaises(HTTPException) as raised:
                compile_creative_brief(body, "Bearer correct-secret")
        self.assertEqual(raised.exception.status_code, 422)

    def test_image_and_video_readiness_are_independent(self):
        with patch.dict(os.environ, {"ASTRA_IMAGE_MODEL_ID": "pinned-image-model"}, clear=True):
            self.assertTrue(model_is_configured("image"))
            self.assertFalse(model_is_configured("video"))


if __name__ == "__main__":
    unittest.main()
