import tempfile
import unittest
from pathlib import Path

from safety_gate import SafetyDecision, SafetyGate, SafetyGateError


class FakeModerationProvider:
    def __init__(self, prompt=None, output=None, error=False):
        self.prompt = prompt or SafetyDecision("allow", "benign", 0.99)
        self.output = output or SafetyDecision("allow", "none", 0.98)
        self.error = error
        self.calls = []

    def moderate_prompt(self, prompt, modality):
        self.calls.append(("prompt", prompt, modality))
        if self.error:
            raise RuntimeError("private provider detail")
        return self.prompt

    def moderate_output(self, media_path, modality):
        self.calls.append(("output", Path(media_path), modality))
        if self.error:
            raise RuntimeError("private provider detail")
        return self.output


class SafetyGateTests(unittest.TestCase):
    def test_benign_prompt_and_output_are_allowed(self):
        provider = FakeModerationProvider()
        gate = SafetyGate(provider)
        gate.check_prompt("A blue planet above the horizon", "image")
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / "media.bin"
            output.write_bytes(b"test")
            gate.check_output(output, "image")
        self.assertEqual([call[0] for call in provider.calls], ["prompt", "output"])

    def test_block_review_or_low_confidence_decisions_fail_closed(self):
        for decision in (
            SafetyDecision("block", "policy", 0.99),
            SafetyDecision("review", "policy", 0.99),
            SafetyDecision("allow", "unknown", 0.99),
            SafetyDecision("allow", "benign", 0.50),
        ):
            gate = SafetyGate(FakeModerationProvider(prompt=decision))
            with self.subTest(decision=decision), self.assertRaises(SafetyGateError):
                gate.check_prompt("A neutral landscape", "image")

    def test_moderation_provider_errors_are_sanitized_and_retryable(self):
        gate = SafetyGate(FakeModerationProvider(error=True))
        with self.assertRaises(SafetyGateError) as raised:
            gate.check_prompt("A neutral landscape", "image")
        self.assertEqual(raised.exception.error_code, "MODERATION_UNAVAILABLE")
        self.assertTrue(raised.exception.retryable)
        self.assertNotIn("private provider detail", str(raised.exception))

    def test_invalid_prompt_modality_and_missing_output_are_rejected(self):
        gate = SafetyGate(FakeModerationProvider())
        for prompt in ("", "   ", "x" * 4001):
            with self.subTest(prompt_length=len(prompt)), self.assertRaises(SafetyGateError):
                gate.check_prompt(prompt, "image")
        with self.assertRaises(SafetyGateError):
            gate.check_prompt("A neutral landscape", "audio")
        with tempfile.TemporaryDirectory() as root:
            missing = Path(root) / "missing.png"
            with self.assertRaises(SafetyGateError):
                gate.check_output(missing, "image")

    def test_missing_provider_and_invalid_confidence_threshold_are_rejected(self):
        with self.assertRaises(ValueError):
            SafetyGate(None)
        with self.assertRaises(ValueError):
            SafetyGate(FakeModerationProvider(), minimum_confidence=0.2)


if __name__ == "__main__":
    unittest.main()
