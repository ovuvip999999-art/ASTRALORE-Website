import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from moderation_http import (
    HTTPSModerationProvider,
    ModerationServiceConfig,
    ModerationTransportError,
    moderation_provider_from_env,
)
from safety_gate import SafetyDecision, SafetyGate, SafetyGateError

TOKEN = "t" * 48


class FakeResponse:
    status = 200
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, size=-1):
        return self.payload[:size]


class FakeOpener:
    def __init__(self, response):
        self.response = response
        self.requests = []
    def open(self, request, timeout):
        self.requests.append((request, timeout))
        return self.response


class ModerationHTTPTests(unittest.TestCase):
    def provider(self, response=None):
        opener = FakeOpener(response or FakeResponse(
            json.dumps({"action": "allow", "category": "benign", "confidence": 0.99}).encode()
        ))
        provider = HTTPSModerationProvider(
            ModerationServiceConfig("https://moderation.example", TOKEN, 5),
            opener=opener,
        )
        return provider, opener

    def test_prompt_is_sent_to_fixed_route_with_bearer_auth(self):
        provider, opener = self.provider()
        result = provider.moderate_prompt("A mountain landscape", "image")
        request, timeout = opener.requests[0]
        self.assertEqual(result, SafetyDecision("allow", "benign", 0.99))
        self.assertEqual(request.full_url, "https://moderation.example/v1/moderate/prompt")
        self.assertEqual(request.get_header("Authorization"), "Bearer " + TOKEN)
        self.assertEqual(timeout, 5)

    def test_output_sends_bounded_content_and_integrity_metadata(self):
        provider, opener = self.provider()
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "result.png"
            path.write_bytes(b"test-media")
            provider.moderate_output(path, "image")
        payload = json.loads(opener.requests[0][0].data)
        self.assertEqual(base64.b64decode(payload["content_base64"]), b"test-media")
        self.assertEqual(payload["sha256"], hashlib.sha256(b"test-media").hexdigest())
        self.assertEqual(payload["size_bytes"], 10)

    def test_rejects_non_https_endpoint_and_redirects_are_not_followed_by_default(self):
        with self.assertRaises(ValueError):
            ModerationServiceConfig("http://moderation.example", TOKEN)
        provider, opener = self.provider(FakeResponse(
            json.dumps({"action": "allow", "category": "benign", "confidence": 0.99, "extra": 1}).encode()
        ))
        with self.assertRaises(ModerationTransportError):
            provider.moderate_prompt("test", "image")

    def test_rejects_invalid_provider_configuration(self):
        with self.assertRaises(ModerationTransportError):
            moderation_provider_from_env({})
        with self.assertRaises(ModerationTransportError):
            moderation_provider_from_env({
                "ASTRA_MODERATION_URL": "http://insecure.example",
                "ASTRA_MODERATION_TOKEN": TOKEN,
            })

    def test_moderation_transport_failure_fails_closed_through_safety_gate(self):
        class FailedOpener:
            def open(self, *args, **kwargs):
                raise TimeoutError()
        provider = HTTPSModerationProvider(
            ModerationServiceConfig("https://moderation.example", TOKEN),
            opener=FailedOpener(),
        )
        gate = SafetyGate(provider)
        with self.assertRaises(SafetyGateError) as caught:
            gate.check_prompt("A landscape", "image")
        self.assertEqual(caught.exception.error_code, "MODERATION_UNAVAILABLE")

    def test_rejects_oversized_output_media(self):
        provider, _ = self.provider()
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "too-large.mp4"
            with path.open("wb") as handle:
                handle.truncate(64 * 1024 * 1024 + 1)
            with self.assertRaises(ModerationTransportError):
                provider.moderate_output(path, "video")


if __name__ == "__main__":
    unittest.main()
