import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import verify_token, model_is_configured


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

    def test_image_and_video_readiness_are_independent(self):
        with patch.dict(os.environ, {"ASTRA_IMAGE_MODEL_ID": "pinned-image-model"}, clear=True):
            self.assertTrue(model_is_configured("image"))
            self.assertFalse(model_is_configured("video"))


if __name__ == "__main__":
    unittest.main()
