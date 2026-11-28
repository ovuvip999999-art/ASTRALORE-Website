"""Private Supabase Storage adapter for validated ASTRA generation outputs.

Objects are uploaded only to a private bucket using a server-side service-role
key. No public URLs or signed URLs are created here. The worker must validate
the media bytes before calling this adapter.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse
from typing import Any, Iterator
from uuid import UUID

import httpx

BUCKET = "astra-generated-private"
MAX_BYTES = 512 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
}


class AssetStoreError(RuntimeError):
    """Sanitized private asset storage error."""


@dataclass(frozen=True)
class AssetStoreConfig:
    supabase_url: str
    service_role_key: str

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "AssetStoreConfig":
        source = os.environ if environ is None else environ
        url = source.get("SUPABASE_URL", "").strip().rstrip("/")
        key = source.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        parsed = urlparse(url)
        if (
            parsed.scheme != "https" or not parsed.hostname
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment
        ):
            raise AssetStoreError("SUPABASE_URL must be a valid HTTPS project URL.")
        if len(key) < 24:
            raise AssetStoreError("The server-side Supabase storage credential is not configured.")
        return cls(url, key)


class SupabasePrivateAssetStore:
    def __init__(
        self,
        config: AssetStoreConfig,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        if not 1 <= timeout_seconds <= 120:
            raise AssetStoreError("Asset upload timeout must be between 1 and 120 seconds.")
        self.config = config
        self.transport = transport
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _uuid(value: str, field: str) -> str:
        try:
            parsed = UUID(value)
        except (TypeError, ValueError, AttributeError):
            raise AssetStoreError(f"{field} must be a UUID.") from None
        if str(parsed) != value.lower():
            raise AssetStoreError(f"{field} must be a canonical UUID.")
        return str(parsed)

    @staticmethod
    def _object_path(user_id: str, job_id: str, asset: dict[str, Any]) -> str:
        user = SupabasePrivateAssetStore._uuid(user_id, "user_id")
        job = SupabasePrivateAssetStore._uuid(job_id, "job_id")
        asset_id = SupabasePrivateAssetStore._uuid(asset.get("asset_id"), "asset_id")
        mime = asset.get("mime_type")
        extension = EXTENSIONS.get(mime)
        if not extension:
            raise AssetStoreError("The validated asset MIME type is not supported.")
        return f"{user}/{job}/{asset_id}.{extension}"

    def _url(self, path: str) -> str:
        encoded = "/".join(quote(part, safe="") for part in path.split("/"))
        return f"{self.config.supabase_url}/storage/v1/object/{BUCKET}/{encoded}"

    def _headers(self, mime: str, size: int) -> dict[str, str]:
        return {
            "apikey": self.config.service_role_key,
            "Authorization": "Bearer " + self.config.service_role_key,
            "Content-Type": mime,
            "Content-Length": str(size),
            "Cache-Control": "private, no-store, max-age=0",
            "x-upsert": "false",
        }

    def _delete_object(self, object_path: str) -> None:
        try:
            with httpx.Client(timeout=self.timeout_seconds, transport=self.transport, follow_redirects=False) as client:
                client.request(
                    "DELETE",
                    self._url(object_path),
                    headers={
                        "apikey": self.config.service_role_key,
                        "Authorization": "Bearer " + self.config.service_role_key,
                    },
                )
        except httpx.HTTPError:
            # A failed cleanup is not safe to hide from the caller's operational logs;
            # the public exception remains sanitized and contains no credential data.
            return

    @staticmethod
    def _validate_object_path(object_path: str) -> str:
        if not isinstance(object_path, str):
            raise AssetStoreError("Private asset path is invalid.")
        parts = object_path.split("/")
        if len(parts) != 3:
            raise AssetStoreError("Private asset path is invalid.")
        user_id = SupabasePrivateAssetStore._uuid(parts[0], "asset owner")
        job_id = SupabasePrivateAssetStore._uuid(parts[1], "asset job")
        filename = parts[2]
        stem, separator, extension = filename.rpartition(".")
        asset_id = SupabasePrivateAssetStore._uuid(stem, "asset id")
        if not separator or extension not in set(EXTENSIONS.values()):
            raise AssetStoreError("Private asset path is invalid.")
        return f"{user_id}/{job_id}/{asset_id}.{extension}"

    def create_signed_url(self, object_path: str, *, expires_in: int = 60) -> str:
        """Create a short-lived URL only after the caller has verified job ownership."""
        canonical_path = self._validate_object_path(object_path)
        if isinstance(expires_in, bool) or not isinstance(expires_in, int) or not 30 <= expires_in <= 300:
            raise AssetStoreError("Signed asset URL lifetime must be between 30 and 300 seconds.")
        encoded = "/".join(quote(part, safe="") for part in canonical_path.split("/"))
        url = f"{self.config.supabase_url}/storage/v1/object/sign/{BUCKET}/{encoded}"
        try:
            with httpx.Client(
                timeout=self.timeout_seconds,
                transport=self.transport,
                follow_redirects=False,
            ) as client:
                response = client.post(
                    url,
                    headers={
                        "apikey": self.config.service_role_key,
                        "Authorization": "Bearer " + self.config.service_role_key,
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    json={"expiresIn": expires_in},
                )
            if response.status_code < 200 or response.status_code >= 300:
                raise AssetStoreError("Private asset signing request was rejected.")
            payload = response.json()
        except AssetStoreError:
            raise
        except (httpx.HTTPError, ValueError, TypeError):
            raise AssetStoreError("Private asset signing service is unavailable.") from None

        signed_path = payload.get("signedURL") if isinstance(payload, dict) else None
        expected_prefix = f"/object/sign/{BUCKET}/{canonical_path}?"
        if not isinstance(signed_path, str) or not signed_path.startswith(expected_prefix):
            raise AssetStoreError("Private asset signing service returned an invalid URL.")
        from urllib.parse import parse_qs, urlsplit
        parsed = urlsplit(signed_path)
        query = parse_qs(parsed.query)
        if parsed.scheme or parsed.netloc or parsed.fragment or not query.get("token") or not query["token"][0]:
            raise AssetStoreError("Private asset signing service returned an invalid URL.")
        return self.config.supabase_url + "/storage/v1" + signed_path

    def delete_object(self, object_path: str) -> None:
        """Delete only a canonical object path inside ASTRA's private bucket."""
        canonical_path = self._validate_object_path(object_path)
        try:
            with httpx.Client(
                timeout=self.timeout_seconds,
                transport=self.transport,
                follow_redirects=False,
            ) as client:
                response = client.delete(
                    self._url(canonical_path),
                    headers={
                        "apikey": self.config.service_role_key,
                        "Authorization": "Bearer " + self.config.service_role_key,
                    },
                )
            if response.status_code not in {200, 202, 204, 404}:
                raise AssetStoreError("Private asset cleanup was rejected.")
        except AssetStoreError:
            raise
        except httpx.HTTPError:
            raise AssetStoreError("Private asset cleanup service is unavailable.") from None

    def upload_validated_file(
        self,
        path: str | Path,
        *,
        work_dir: str | Path,
        user_id: str,
        job_id: str,
        validated_asset: dict[str, Any],
    ) -> dict[str, Any]:
        """Stream a previously validated file and recheck its digest while uploading."""
        if not isinstance(validated_asset, dict):
            raise AssetStoreError("Validated media metadata must be an object.")
        object_path = self._object_path(user_id, job_id, validated_asset)
        mime = validated_asset.get("mime_type")
        expected_digest = validated_asset.get("sha256")
        expected_size = validated_asset.get("size_bytes")
        if (
            not isinstance(expected_digest, str)
            or len(expected_digest) != 64
            or any(c not in "0123456789abcdef" for c in expected_digest.lower())
            or isinstance(expected_size, bool)
            or not isinstance(expected_size, int)
            or not 1 <= expected_size <= MAX_BYTES
        ):
            raise AssetStoreError("Validated media metadata is incomplete or invalid.")

        try:
            root = Path(work_dir).resolve(strict=True)
            candidate = Path(path)
            if not candidate.is_absolute():
                candidate = root / candidate
            if candidate.is_symlink():
                raise AssetStoreError("Symbolic-link media outputs are not accepted.")
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(root)
            if not resolved.is_file():
                raise AssetStoreError("Media output must be a regular file.")
            handle = resolved.open("rb")
        except AssetStoreError:
            raise
        except (OSError, ValueError, RuntimeError):
            raise AssetStoreError("Media output must be inside the worker output directory.") from None

        digest = hashlib.sha256()
        sent = 0
        try:
            before = os.fstat(handle.fileno())
            path_before = resolved.stat()
            if before.st_size != expected_size or (before.st_dev, before.st_ino) != (path_before.st_dev, path_before.st_ino):
                raise AssetStoreError("Media output changed after validation.")

            def chunks() -> Iterator[bytes]:
                nonlocal sent
                while True:
                    block = handle.read(CHUNK_SIZE)
                    if not block:
                        break
                    sent += len(block)
                    if sent > MAX_BYTES:
                        raise AssetStoreError("Media output exceeds the upload limit.")
                    digest.update(block)
                    yield block

            try:
                with httpx.Client(
                    timeout=self.timeout_seconds,
                    transport=self.transport,
                    follow_redirects=False,
                ) as client:
                    response = client.post(
                        self._url(object_path),
                        headers=self._headers(mime, expected_size),
                        content=chunks(),
                    )
            except AssetStoreError:
                raise
            except httpx.HTTPError:
                raise AssetStoreError("Private media upload failed.") from None

            if response.status_code < 200 or response.status_code >= 300:
                raise AssetStoreError(f"Private media storage rejected the upload (HTTP {response.status_code}).")

            try:
                after = os.fstat(handle.fileno())
                path_after = resolved.stat()
            except OSError:
                self._delete_object(object_path)
                raise AssetStoreError("Media output changed during private upload.") from None
            signature_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            signature_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            path_signature = (path_after.st_dev, path_after.st_ino, path_after.st_size, path_after.st_mtime_ns)
            if (
                sent != expected_size
                or digest.hexdigest() != expected_digest.lower()
                or signature_before != signature_after
                or signature_after != path_signature
            ):
                self._delete_object(object_path)
                raise AssetStoreError("Media output integrity changed during private upload.")

            result = dict(validated_asset)
            result["storage_path"] = object_path
            return result
        finally:
            handle.close()
