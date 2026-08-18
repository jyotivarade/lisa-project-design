"""File upload and parsing (spec sections 4, 5 and 33).

Uploading is deliberately additive: an existing file is never overwritten, and a
duplicate is flagged rather than refused or silently discarded. Every upload
creates its own processing session pinned to a configuration snapshot, so the run
is reproducible from the moment it arrives.
"""

import logging
import uuid
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import BinaryIO

from sqlalchemy.orm import Session

from app.audit import RequestContext, record
from app.core.config import get_settings
from app.core.errors import ErrorCode, LisaError, NotFoundError
from app.criteria.version import ENGINE_VERSION
from app.models import Analytics, ProcessingSession, UploadedFile
from app.models.enums import AuditAction, ProcessingState, UploadStatus
from app.processing.orchestrator import ParseResult, parse_session
from app.repositories import file_repository as repo
from app.services import configuration_service
from app.storage import FileStorage, FileTooLarge, get_storage, object_key

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".csv", ".txt"}
ALLOWED_CONTENT_TYPES = {
    "text/csv",
    "text/plain",
    "application/csv",
    "application/vnd.ms-excel",  # what several browsers send for a .csv
    "application/octet-stream",
    "",
}


class UnsupportedFileType(LisaError):
    status_code = 400
    error_code = ErrorCode.UNSUPPORTED_FILE_TYPE


class FileTooLargeError(LisaError):
    status_code = 413
    error_code = ErrorCode.FILE_TOO_LARGE


@dataclass
class UploadOutcome:
    uploaded_file: UploadedFile
    session: ProcessingSession
    parse: ParseResult | None
    duplicate_of: UploadedFile | None


def _check_type(filename: str, content_type: str | None) -> str:
    extension = PurePosixPath(filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileType(
            f"Only {', '.join(sorted(ALLOWED_EXTENSIONS))} files can be uploaded.",
            details=[{"field": "file", "issue": f"'{extension or filename}' is not supported."}],
        )
    if (content_type or "").split(";")[0].strip().lower() not in ALLOWED_CONTENT_TYPES:
        raise UnsupportedFileType(
            "The file's content type is not supported.",
            details=[{"field": "file", "issue": f"Received '{content_type}'."}],
        )
    return extension


def upload(
    db: Session,
    *,
    analytics: Analytics,
    filename: str,
    content_type: str | None,
    stream: BinaryIO,
    actor_id: uuid.UUID | None,
    context: RequestContext | None = None,
    storage: FileStorage | None = None,
    parse: bool = True,
) -> UploadOutcome:
    storage = storage or get_storage()
    settings = get_settings()
    extension = _check_type(filename, content_type)

    version_id, snapshot = configuration_service.resolve_snapshot(db, analytics.id)
    max_bytes = int(snapshot.get("limits", {}).get("max_upload_bytes") or settings.max_upload_bytes)

    # The id is generated before storing so the key never contains a user string.
    file_id = uuid.uuid4()
    key = object_key(analytics.id, file_id, "original", extension)

    try:
        stored = storage.put(key, stream, max_bytes=max_bytes)
    except FileTooLarge as exc:
        raise FileTooLargeError(
            f"The file is larger than the {max_bytes} byte limit for this analytics.",
            details=[{"limit_bytes": max_bytes}],
        ) from exc

    duplicate = repo.find_duplicate(db, analytics.id, stored.sha256)

    uploaded = UploadedFile(
        id=file_id,
        analytics_id=analytics.id,
        uploaded_by_id=actor_id,
        original_filename=filename,
        stored_filename=key,
        file_hash=stored.sha256,
        size_bytes=stored.size_bytes,
        content_type=content_type,
        status=UploadStatus.STORED.value,
        is_duplicate=duplicate is not None,
        duplicate_of_id=duplicate.id if duplicate else None,
    )
    db.add(uploaded)
    db.flush()

    session = ProcessingSession(
        uploaded_file_id=uploaded.id,
        analytics_id=analytics.id,
        session_number=repo.next_session_number(db, uploaded.id),
        state=ProcessingState.UPLOADED.value,
        # Pinned now: from this moment the run is immune to configuration changes.
        config_snapshot=snapshot,
        config_version_id=version_id,
        engine_version=ENGINE_VERSION,
        started_by_id=actor_id,
    )
    db.add(session)
    db.flush()

    record(
        db,
        action=AuditAction.UPLOAD,
        actor_id=actor_id,
        entity_type="uploaded_file",
        entity_id=uploaded.id,
        analytics_id=analytics.id,
        session_id=session.id,
        new_value={
            "filename": filename,
            "size_bytes": stored.size_bytes,
            "sha256": stored.sha256,
            "is_duplicate": duplicate is not None,
        },
        context=context,
    )

    result: ParseResult | None = None
    if parse:
        result = parse_session(
            db,
            session=session,
            uploaded_file=uploaded,
            storage=storage,
            analyte_name=analytics.analyte_name,
        )

    return UploadOutcome(
        uploaded_file=uploaded, session=session, parse=result, duplicate_of=duplicate
    )


def get_file(db: Session, file_id: uuid.UUID) -> UploadedFile:
    uploaded = repo.get(db, file_id)
    if uploaded is None:
        raise NotFoundError("File not found.")
    return uploaded


def open_original(uploaded: UploadedFile, storage: FileStorage | None = None) -> BinaryIO:
    """The stored bytes, untouched. The original is never rewritten (section 18)."""
    storage = storage or get_storage()
    if not storage.exists(uploaded.stored_filename):
        raise NotFoundError("The stored file is no longer available.")
    return storage.open(uploaded.stored_filename)
