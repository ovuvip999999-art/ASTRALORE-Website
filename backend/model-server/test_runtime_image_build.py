import subprocess
import unittest
from unittest.mock import Mock

from runtime_image_build import RuntimeBuildError, build_runtime_image


BASE = "pytorch/pytorch@sha256:" + "a" * 64


class RuntimeImageBuildTests(unittest.TestCase):
    def test_builds_and_smoke_tests_digest_pinned_image_without_push(self):
        runner = Mock(side_effect=[
            subprocess.CompletedProcess([], 0, "build ok"),
            subprocess.CompletedProcess([], 0, "ASTRA_RUNTIME_IMPORTS_OK"),
        ])
        result = build_runtime_image(
            base_image=BASE,
            local_tag="astra-model-runtime:test",
            runner=runner,
        )
        self.assertEqual(result["status"], "build_and_import_smoke_test_passed")
        self.assertEqual(result["registry_digest"], "not_published")
        self.assertEqual(runner.call_count, 2)
        build_args = runner.call_args_list[0].args[0]
        smoke_args = runner.call_args_list[1].args[0]
        self.assertIn("--no-cache", build_args)
        self.assertIn("--network", smoke_args)
        self.assertIn("none", smoke_args)
        self.assertNotIn("push", build_args)

    def test_rejects_mutable_or_placeholder_base_image_before_docker(self):
        runner = Mock()
        for image in ("pytorch/pytorch:latest", "pytorch/pytorch@sha256:<digest>", ""):
            with self.subTest(image=image):
                with self.assertRaises(RuntimeBuildError):
                    build_runtime_image(
                        base_image=image,
                        local_tag="astra-model-runtime:test",
                        runner=runner,
                    )
        runner.assert_not_called()

    def test_rejects_invalid_tag(self):
        runner = Mock()
        with self.assertRaises(RuntimeBuildError):
            build_runtime_image(
                base_image=BASE,
                local_tag="latest",
                runner=runner,
            )
        runner.assert_not_called()

    def test_fails_closed_when_import_smoke_output_is_missing(self):
        runner = Mock(side_effect=[
            subprocess.CompletedProcess([], 0, "build ok"),
            subprocess.CompletedProcess([], 0, "unexpected output"),
        ])
        with self.assertRaises(RuntimeBuildError):
            build_runtime_image(
                base_image=BASE,
                local_tag="astra-model-runtime:test",
                runner=runner,
            )

    def test_sanitizes_docker_failure(self):
        runner = Mock(side_effect=OSError("secret host detail"))
        with self.assertRaisesRegex(RuntimeBuildError, "RUNTIME_BUILD_OR_SMOKE_TEST_FAILED"):
            build_runtime_image(
                base_image=BASE,
                local_tag="astra-model-runtime:test",
                runner=runner,
            )


if __name__ == "__main__":
    unittest.main()
