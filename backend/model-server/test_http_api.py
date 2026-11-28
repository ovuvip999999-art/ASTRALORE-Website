import json
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import app

TOKEN = "integration-test-secret-value-at-least-32-characters"


class ModelServerHttpTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def auth(self):
        return {"Authorization": "Bearer " + TOKEN}

    def test_health_does_not_expose_model_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertFalse(body["imageModelConfigured"])
        self.assertNotIn("ASTRA_MODEL_SERVER_TOKEN", json.dumps(body))

    def test_brief_endpoint_requires_authentication(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": TOKEN}):
            response = self.client.post("/v1/brief/compile", json={"brief": {"prompt": "A blue planet"}})
        self.assertEqual(response.status_code, 401)

    def test_brief_endpoint_returns_compiled_prompt(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": TOKEN}):
            response = self.client.post(
                "/v1/brief/compile",
                headers=self.auth(),
                json={"brief": {"prompt": "A blue planet", "lighting": "soft sunrise"}},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("A blue planet", response.json()["compiled_prompt"])
        self.assertIn("Lighting: soft sunrise", response.json()["compiled_prompt"])

    def test_brief_endpoint_rejects_unknown_fields(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": TOKEN}):
            response = self.client.post(
                "/v1/brief/compile", headers=self.auth(),
                json={"brief": {"prompt": "A blue planet", "unexpected": "field"}},
            )
        self.assertEqual(response.status_code, 422)

    def test_model_route_endpoint_requires_configured_catalog(self):
        with patch.dict(os.environ, {"ASTRA_MODEL_SERVER_TOKEN": TOKEN}, clear=True):
            response = self.client.post(
                "/v1/models/route", headers=self.auth(),
                json={"model_id": "astra-image-test", "modality": "image",
                      "aspect_ratio": "1:1", "width": 512, "height": 512},
            )
        self.assertEqual(response.status_code, 422)

    def test_model_route_endpoint_returns_explicit_model(self):
        catalog = [{
            "model_id": "astra-image-test",
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
        with patch.dict(os.environ, {
            "ASTRA_MODEL_SERVER_TOKEN": TOKEN,
            "ASTRA_MODEL_CATALOG_JSON": json.dumps(catalog),
        }):
            response = self.client.post(
                "/v1/models/route", headers=self.auth(),
                json={"model_id": "astra-image-test", "modality": "image",
                      "aspect_ratio": "1:1", "width": 512, "height": 512},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model_id"], "astra-image-test")

    def test_generation_routes_remain_fail_closed(self):
        with patch.dict(os.environ, {
            "ASTRA_MODEL_SERVER_TOKEN": TOKEN,
            "ASTRA_IMAGE_MODEL_ID": "configured-but-no-runtime",
            "ASTRA_VIDEO_MODEL_ID": "configured-but-no-runtime",
        }):
            image_response = self.client.post(
                "/v1/image", headers=self.auth(),
                json={"task": "image", "prompt": "A quiet nebula",
                      "aspectRatio": "16:9", "output": "base64"},
            )
            video_response = self.client.post(
                "/v1/video", headers=self.auth(),
                json={"task": "video", "prompt": "A quiet nebula",
                      "aspectRatio": "16:9", "durationSeconds": 5,
                      "resolution": "480p", "output": "https-url"},
            )
        self.assertEqual(image_response.status_code, 503)
        self.assertEqual(video_response.status_code, 503)
        self.assertIn("not implemented", image_response.json()["detail"])
        self.assertIn("not implemented", video_response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
