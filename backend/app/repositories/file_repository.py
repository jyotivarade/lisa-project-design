"""Uploaded file and processing session queries."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import ProcessingRow, ProcessingSession, UploadedFile


def get(db: Session, file_id: uuid.UUID) -> UploadedFile | None:
    return db.scalar(
        select(UploadedFile)
        .options(selectinload(UploadedFile.sessions))
        .where(UploadedFile.id == file_id)
    )


def find_duplicate(db: Session, analytics_id: uuid.UUID, file_hash: str) -> UploadedFile | None:
    """The earliest file with the same content in this analytics.

    Uploading the same bytes twice is worth flagging, never worth refusing: a lab
    may legitimately reprocess an identical export.
    """
    return db.scalar(
        select(UploadedFile)
        .where(UploadedFile.analytics_id == analytics_id, UploadedFile.file_hash == file_hash)
        .order_by(UploadedFile.uploaded_at)
        .limit(1)
    )


def list_files(
    db: Session,
    *,
    limit: int,
    offset: int,
    analytics_id: uuid.UUID | None = None,
) -> tuple[Sequence[UploadedFile], int]:
    stmt = select(UploadedFile)
    count_stmt = select(func.count()).select_from(UploadedFile)
    if analytics_id is not None:
        stmt = stmt.where(UploadedFile.analytics_id == analytics_id)
        count_stmt = count_stmt.where(UploadedFile.analytics_id == analytics_id)

    total = db.scalar(count_stmt) or 0
    rows = db.scalars(
        stmt.options(selectinload(UploadedFile.sessions))
        .order_by(UploadedFile.uploaded_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return rows, total


def get_session(db: Session, session_id: uuid.UUID) -> ProcessingSession | None:
    return db.scalar(select(ProcessingSession).where(ProcessingSession.id == session_id))


def latest_session(db: Session, file_id: uuid.UUID) -> ProcessingSession | None:
    return db.scalar(
        select(ProcessingSession)
        .where(ProcessingSession.uploaded_file_id == file_id)
        .order_by(ProcessingSession.session_number.desc())
        .limit(1)
    )


def next_session_number(db: Session, file_id: uuid.UUID) -> int:
    highest = db.scalar(
        select(func.max(ProcessingSession.session_number)).where(
            ProcessingSession.uploaded_file_id == file_id
        )
    )
    return (highest or 0) + 1


def preview_rows(
    db: Session, session_id: uuid.UUID, *, limit: int, stream: str | None = None
) -> Sequence[ProcessingRow]:
    stmt = select(ProcessingRow).where(ProcessingRow.session_id == session_id)
    if stream:
        stmt = stmt.where(ProcessingRow.stream == stream)
    return db.scalars(stmt.order_by(ProcessingRow.source_row_number).limit(limit)).all()


def count_rows(db: Session, session_id: uuid.UUID, stream: str | None = None) -> int:
    stmt = select(func.count()).select_from(ProcessingRow).where(
        ProcessingRow.session_id == session_id
    )
    if stream:
        stmt = stmt.where(ProcessingRow.stream == stream)
    return db.scalar(stmt) or 0


def analytics_file_stats(db: Session, analytics_ids: Sequence[uuid.UUID]) -> dict:
    """Real counts for the analytics list — read from rows, never estimated."""
    if not analytics_ids:
        return {}

    files = db.execute(
        select(
            UploadedFile.analytics_id,
            func.count(UploadedFile.id),
            func.max(UploadedFile.uploaded_at),
        )
        .where(UploadedFile.analytics_id.in_(analytics_ids))
        .group_by(UploadedFile.analytics_id)
    ).all()
    sessions = db.execute(
        select(ProcessingSession.analytics_id, func.count(ProcessingSession.id))
        .where(ProcessingSession.analytics_id.in_(analytics_ids))
        .group_by(ProcessingSession.analytics_id)
    ).all()

    stats: dict = {
        analytics_id: {
            "file_count": 0,
            "session_count": 0,
            "last_uploaded_at": None,
            "last_session_state": None,
        }
        for analytics_id in analytics_ids
    }
    for analytics_id, count, last_uploaded in files:
        stats[analytics_id]["file_count"] = count
        stats[analytics_id]["last_uploaded_at"] = last_uploaded
    for analytics_id, count in sessions:
        stats[analytics_id]["session_count"] = count

    for analytics_id in analytics_ids:
        latest = db.scalar(
            select(ProcessingSession.state)
            .where(ProcessingSession.analytics_id == analytics_id)
            .order_by(ProcessingSession.created_at.desc())
            .limit(1)
        )
        stats[analytics_id]["last_session_state"] = latest
    return stats
