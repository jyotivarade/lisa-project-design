"""Storage abstraction (spec section 33).

Business logic never touches a filesystem path. It hands this interface a stream and
gets back a key; swapping local disk for S3 changes one class and nothing else.
"""

import hashlib
import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import BinaryIO, Protocol

# Keys are server-generated, so this is a guard against a programming mistake
# rather than against user input — no user string ever reaches a key.
_SAFE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")


class StorageError(RuntimeError):
    pass


@dataclass(frozen=True)
class StoredObject:
    key: str
    size_bytes: int
    sha256: str


def validate_key(key: str) -> str:
    if not _SAFE_KEY.match(key) or ".." in key or key.endswith("/"):
        raise StorageError(f"Unsafe storage key: {key!r}")
    return key


class FileStorage(Protocol):
    """Every implementation must be able to round-trip bytes unchanged."""

    def put(self, key: str, stream: BinaryIO, *, max_bytes: int | None = None) -> StoredObject:
        """Stream `stream` to `key`. Raises FileTooLarge past `max_bytes`."""

    def open(self, key: str) -> BinaryIO: ...

    def exists(self, key: str) -> bool: ...

    def delete(self, key: str) -> None: ...

    def iter_chunks(self, key: str, chunk_size: int = 65_536) -> Iterator[bytes]: ...


class FileTooLarge(StorageError):
    def __init__(self, limit: int) -> None:
        super().__init__(f"File exceeds the {limit} byte limit.")
        self.limit = limit


def hash_and_measure(stream: BinaryIO, chunk_size: int = 65_536) -> tuple[str, int]:
    """SHA-256 and byte count without holding the file in memory."""
    digest = hashlib.sha256()
    total = 0
    while chunk := stream.read(chunk_size):
        digest.update(chunk)
        total += len(chunk)
    return digest.hexdigest(), total
