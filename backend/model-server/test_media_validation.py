import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from media_validation import MediaValidationError, inspect_media_file


class MediaValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write_png(self, name="sample.png", size=(32, 24)):
        path = self.root / name
        Image.new("RGB", size, (12, 34, 56)).save(path, format="PNG")
        return path

    def test_png_is_fully_decoded_and_digest_matches_bytes(self):
        path = self.write_png()
        result = inspect_media_file(path, work_dir=self.root, modality="image")
        raw = path.read_bytes()
        self.assertEqual(result["mime_type"], "image/png")
        self.assertEqual(result["width"], 32)
        self.assertEqual(result["height"], 24)
        self.assertEqual(result["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["size_bytes"], len(raw))
        self.assertEqual(len(result["asset_id"]), 36)
        self.assertNotIn("duration_ms", result)

    def test_jpeg_and_webp_are_detected_from_bytes(self):
        for fmt, expected in (("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
            path = self.root / ("sample." + fmt.lower())
            Image.new("RGB", (16, 16), (90, 80, 70)).save(path, format=fmt)
            result = inspect_media_file(path, work_dir=self.root, modality="image")
            self.assertEqual(result["mime_type"], expected)

    def test_corrupt_and_unsupported_image_bytes_are_rejected(self):
        corrupt = self.root / "corrupt.png"
        corrupt.write_bytes(b"not an image")
        with self.assertRaises(MediaValidationError):
            inspect_media_file(corrupt, work_dir=self.root, modality="image")

        gif = self.root / "unsupported.gif"
        Image.new("RGB", (8, 8)).save(gif, format="GIF")
        with self.assertRaises(MediaValidationError):
            inspect_media_file(gif, work_dir=self.root, modality="image")

    def test_output_must_be_inside_worker_directory_and_not_a_symlink(self):
        outside = self.root.parent / "outside.png"
        Image.new("RGB", (8, 8)).save(outside, format="PNG")
        with self.assertRaises(MediaValidationError):
            inspect_media_file(outside, work_dir=self.root, modality="image")
        link = self.root / "linked.png"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            outside.unlink(missing_ok=True)
            self.skipTest("Symlink creation is unavailable on this platform.")
        with self.assertRaises(MediaValidationError):
            inspect_media_file(link, work_dir=self.root, modality="image")
        outside.unlink(missing_ok=True)

    def test_empty_file_and_invalid_modality_are_rejected(self):
        empty = self.root / "empty.bin"
        empty.write_bytes(b"")
        with self.assertRaises(MediaValidationError):
            inspect_media_file(empty, work_dir=self.root, modality="image")
        with self.assertRaises(MediaValidationError):
            inspect_media_file(empty, work_dir=self.root, modality="audio")

    @patch("media_validation.subprocess.run")
    def test_mp4_is_inspected_and_video_metadata_is_returned(self, run):
        path = self.root / "generated.mp4"
        path.write_bytes(b"mocked-container-bytes")
        run.return_value = type("Completed", (), {
            "returncode": 0,
            "stdout": json.dumps({
                "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "5.25"},
                "streams": [{"codec_type": "video", "width": 640, "height": 360, "duration": "5.25"}],
            }),
            "stderr": "",
        })()
        result = inspect_media_file(path, work_dir=self.root, modality="video")
        self.assertEqual(result["mime_type"], "video/mp4")
        self.assertEqual(result["duration_ms"], 5250)
        self.assertEqual(result["width"], 640)
        args, kwargs = run.call_args
        self.assertIn("-protocol_whitelist", args[0])
        self.assertFalse(kwargs["shell"])
        self.assertTrue(kwargs["capture_output"])

    @patch("media_validation.subprocess.run")
    def test_webm_is_supported_but_other_containers_are_rejected(self, run):
        path = self.root / "generated.webm"
        path.write_bytes(b"mocked-container-bytes")
        run.return_value = type("Completed", (), {
            "returncode": 0,
            "stdout": json.dumps({
                "format": {"format_name": "matroska,webm", "duration": "2"},
                "streams": [{"codec_type": "video", "width": 320, "height": 240}],
            }),
            "stderr": "",
        })()
        result = inspect_media_file(path, work_dir=self.root, modality="video")
        self.assertEqual(result["mime_type"], "video/webm")
        self.assertEqual(result["duration_ms"], 2000)

        run.return_value.stdout = json.dumps({
            "format": {"format_name": "matroska", "duration": "2"},
            "streams": [{"codec_type": "video", "width": 320, "height": 240}],
        })
        with self.assertRaises(MediaValidationError):
            inspect_media_file(path, work_dir=self.root, modality="video")

    @patch("media_validation.subprocess.run")
    def test_invalid_video_stream_duration_and_inspector_failures(self, run):
        path = self.root / "bad.mp4"
        path.write_bytes(b"mocked-container-bytes")
        run.return_value = type("Completed", (), {
            "returncode": 0,
            "stdout": json.dumps({
                "format": {"format_name": "mp4", "duration": "121"},
                "streams": [{"codec_type": "video", "width": 320, "height": 240}],
            }),
            "stderr": "",
        })()
        with self.assertRaises(MediaValidationError):
            inspect_media_file(path, work_dir=self.root, modality="video")

        run.side_effect = __import__("subprocess").TimeoutExpired("ffprobe", 12)
        with self.assertRaises(MediaValidationError):
            inspect_media_file(path, work_dir=self.root, modality="video")


if __name__ == "__main__":
    unittest.main()
