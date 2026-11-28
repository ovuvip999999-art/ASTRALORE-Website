import hashlib
import tempfile
import unittest
from pathlib import Path

import httpx
from PIL import Image

from asset_store import AssetStoreConfig, AssetStoreError, SupabasePrivateAssetStore
from media_validation import inspect_media_file

USER_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
SERVICE = "service-role-key-value-with-sufficient-length-123456"


class PrivateAssetStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.file = self.root / "output.png"
        Image.new("RGB", (24, 16), (40, 80, 120)).save(self.file, format="PNG")
        self.asset = inspect_media_file(self.file, work_dir=self.root, modality="image")

    def tearDown(self):
        self.temp.cleanup()

    def config(self):
        return AssetStoreConfig("https://example.supabase.co", SERVICE)

    def test_config_requires_https_and_server_side_key(self):
        with self.assertRaises(AssetStoreError):
            AssetStoreConfig.from_env({
                "SUPABASE_URL": "http://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": SERVICE,
            })
        with self.assertRaises(AssetStoreError):
            AssetStoreConfig.from_env({"SUPABASE_URL": "https://example.supabase.co"})

    def test_upload_streams_to_private_owner_job_asset_path(self):
        def handler(request):
            self.assertEqual(request.method, "POST")
            self.assertEqual(
                request.url.path,
                f"/storage/v1/object/astra-generated-private/{USER_ID}/{JOB_ID}/{self.asset['asset_id']}.png",
            )
            self.assertEqual(request.headers["authorization"], "Bearer " + SERVICE)
            self.assertEqual(request.headers["apikey"], SERVICE)
            self.assertEqual(request.headers["content-type"], "image/png")
            self.assertEqual(request.headers["x-upsert"], "false")
            self.assertEqual(request.headers["cache-control"], "private, no-store, max-age=0")
            self.assertEqual(request.content, self.file.read_bytes())
            return httpx.Response(200, json={"Key": "private-object"})
        store = SupabasePrivateAssetStore(self.config(), transport=httpx.MockTransport(handler))
        result = store.upload_validated_file(
            self.file, work_dir=self.root, user_id=USER_ID, job_id=JOB_ID,
            validated_asset=self.asset,
        )
        self.assertEqual(
            result["storage_path"],
            f"{USER_ID}/{JOB_ID}/{self.asset['asset_id']}.png",
        )
        self.assertNotIn("public_url", result)
        self.assertNotIn("signed_url", result)

    def test_digest_mismatch_triggers_private_object_cleanup(self):
        calls = []
        wrong = dict(self.asset)
        wrong["sha256"] = "0" * 64

        def handler(request):
            calls.append(request.method)
            return httpx.Response(200, json={}) if request.method == "POST" else httpx.Response(200)
        store = SupabasePrivateAssetStore(self.config(), transport=httpx.MockTransport(handler))
        with self.assertRaises(AssetStoreError):
            store.upload_validated_file(
                self.file, work_dir=self.root, user_id=USER_ID, job_id=JOB_ID,
                validated_asset=wrong,
            )
        self.assertEqual(calls, ["POST", "DELETE"])

    def test_outside_file_and_invalid_owner_ids_are_rejected(self):
        with tempfile.TemporaryDirectory() as outside_dir:
            outside = Path(outside_dir) / "outside.png"
            Image.new("RGB", (8, 8)).save(outside, format="PNG")
            store = SupabasePrivateAssetStore(
                self.config(),
                transport=httpx.MockTransport(lambda request: self.fail("Network must not be called")),
            )
            with self.assertRaises(AssetStoreError):
                store.upload_validated_file(
                    outside, work_dir=self.root, user_id=USER_ID, job_id=JOB_ID,
                    validated_asset=self.asset,
                )
        store = SupabasePrivateAssetStore(self.config())
        with self.assertRaises(AssetStoreError):
            store.upload_validated_file(
                self.file, work_dir=self.root, user_id="../other", job_id=JOB_ID,
                validated_asset=self.asset,
            )

    def test_file_digest_is_rechecked_during_upload(self):
        self.file.write_bytes(b"changed after validation")
        store = SupabasePrivateAssetStore(
            self.config(),
            transport=httpx.MockTransport(lambda request: self.fail("Network must not be called")),
        )
        with self.assertRaises(AssetStoreError):
            store.upload_validated_file(
                self.file, work_dir=self.root, user_id=USER_ID, job_id=JOB_ID,
                validated_asset=self.asset,
            )


if __name__ == "__main__":
    unittest.main()
