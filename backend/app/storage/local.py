"""Local filesystem storage. The default for development and on-premise installs."""

import hashlib
import os
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

from app.storage.base import FileTooLarge, StoredObject, validate_key


class LocalFileStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / validate_key(key)).resolve()
        # Defence in depth: even with a validated key, never write outside the root.
        if not path.is_relative_to(self.root):
            raise ValueError(f"Key escapes the storage root: {key!r}")
        return path

    def put(self, key: str, stream: BinaryIO, *, max_bytes: int | None = None) -> StoredObject:
        """Write via a temporary file and rename.

        A crash mid-upload leaves a temp file, never a truncated object that looks
        complete. The size limit is enforced against bytes actually read, not
        against a Content-Length header a client could lie about.
        """
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)

        digest = hashlib.sha256()
        total = 0
        descriptor, temp_name = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                while chunk := stream.read(65_536):
                    total += len(chunk)
                    if max_bytes is not None and total > max_bytes:
                        raise FileTooLarge(max_bytes)
                    digest.update(chunk)
                    handle.write(chunk)
            os.replace(temp_name, path)
        except BaseException:
            Path(temp_name).unlink(missing_ok=True)
            raise

        return StoredObject(key=key, size_bytes=total, sha256=digest.hexdigest())

    def open(self, key: str) -> BinaryIO:
        return self._path(key).open("rb")

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def iter_chunks(self, key: str, chunk_size: int = 65_536) -> Iterator[bytes]:
        with self.open(key) as handle:
            while chunk := handle.read(chunk_size):
                yield chunk

    def clear(self) -> None:
        """Test helper. Never called by application code."""
        shutil.rmtree(self.root, ignore_errors=True)
        self.root.mkdir(parents=True, exist_ok=True)
