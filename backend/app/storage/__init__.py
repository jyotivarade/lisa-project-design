"""Storage selection. One place decides which backend is in use."""

from functools import lru_cache

from app.core.config import get_settings
from app.storage.base import (
    FileStorage,
    FileTooLarge,
    StorageError,
    StoredObject,
    validate_key,
)
from app.storage.local import LocalFileStorage


@lru_cache
def get_storage() -> FileStorage:
    settings = get_settings()
    if settings.storage_backend == "local":
        return LocalFileStorage(settings.storage_local_root)
    # S3Storage lands in Phase 12 behind this same protocol; failing loudly is
    # better than silently writing to local disk in a deployment that expects S3.
    raise StorageError(f"Storage backend {settings.storage_backend!r} is not available yet.")


def object_key(analytics_id, file_id, kind: str, extension: str) -> str:  # type: ignore[no-untyped-def]
    """Server-generated key. A user's filename is metadata and never a path."""
    return f"analytics/{analytics_id}/files/{file_id}/{kind}{extension}"


__all__ = [
    "FileStorage",
    "FileTooLarge",
    "LocalFileStorage",
    "StorageError",
    "StoredObject",
    "get_storage",
    "object_key",
    "validate_key",
]
