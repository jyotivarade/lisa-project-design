"""Processing sessions, state transitions and parsed rows (docs/01 §4)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import ProcessingState, SampleStream, Verdict


class ProcessingSession(UUIDMixin, TimestampMixin, Base):
    """One run of one file. A rerun is always a NEW session (§20).

    `config_snapshot` is the whole point of AD-1: the criteria engine reads this and
    only this, so changing configuration later cannot alter a historical result (§35).
    """

    __tablename__ = "processing_sessions"

    uploaded_file_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("uploaded_files.id", ondelete="CASCADE"), nullable=False
    )
    analytics_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("analytics.id", ondelete="RESTRICT"), nullable=False
    )
    session_number: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_session_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("processing_sessions.id", ondelete="SET NULL")
    )

    state: Mapped[str] = mapped_column(
        String(30), nullable=False, default=ProcessingState.UPLOADED.value
    )
    config_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    config_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("analytics_configuration_versions.id", ondelete="RESTRICT"),
    )
    engine_version: Mapped[str] = mapped_column(String(20), nullable=False)

    calibration_verdict: Mapped[str] = mapped_column(
        String(20), nullable=False, default=Verdict.NOT_REVIEWED.value
    )
    control_verdict: Mapped[str] = mapped_column(
        String(20), nullable=False, default=Verdict.NOT_REVIEWED.value
    )
    calibration_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    control_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gate_blocked_reason: Mapped[str | None] = mapped_column(String(40))

    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calibrator_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    control_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    patient_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    other_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    started_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(60))
    error_message: Mapped[str | None] = mapped_column(Text)

    uploaded_file: Mapped["UploadedFile"] = relationship(back_populates="sessions")  # noqa: F821

    __table_args__ = (
        UniqueConstraint("uploaded_file_id", "session_number", name="uq_session_number"),
        CheckConstraint(
            f"state IN ({', '.join(repr(v) for v in ProcessingState.values())})",
            name="ck_sessions_state",
        ),
        CheckConstraint(
            f"calibration_verdict IN ({', '.join(repr(v) for v in Verdict.values())})",
            name="ck_sessions_calibration_verdict",
        ),
        CheckConstraint(
            f"control_verdict IN ({', '.join(repr(v) for v in Verdict.values())})",
            name="ck_sessions_control_verdict",
        ),
        CheckConstraint("session_number >= 1", name="ck_sessions_number_positive"),
        Index("ix_sessions_analytics_created", "analytics_id", "created_at"),
        Index("ix_sessions_file_number", "uploaded_file_id", "session_number"),
        Index("ix_sessions_state", "state"),
    )


class ProcessingEvent(UUIDMixin, TimestampMixin, Base):
    """Append-only state-transition log. Written by services/state_machine.py."""

    __tablename__ = "processing_events"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("processing_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_state: Mapped[str | None] = mapped_column(String(30))
    to_state: Mapped[str] = mapped_column(String(30), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    reason: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_processing_events_session", "session_id", "created_at"),)


class ProcessingRow(UUIDMixin, TimestampMixin, Base):
    """Every parsed row, verbatim. `raw` is never mutated — corrections live in
    row_corrections so the original is always recoverable (§19)."""

    __tablename__ = "processing_rows"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("processing_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    stream: Mapped[str] = mapped_column(String(20), nullable=False)
    sample_id: Mapped[str | None] = mapped_column(String(200))
    sample_type: Mapped[str | None] = mapped_column(String(100))
    analyte_name: Mapped[str | None] = mapped_column(String(200))
    classification_reason: Mapped[str | None] = mapped_column(Text)
    is_malformed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    parse_warnings: Mapped[list[str] | None] = mapped_column(JSONB)

    __table_args__ = (
        UniqueConstraint("session_id", "source_row_number", name="uq_session_row_number"),
        CheckConstraint(
            f"stream IN ({', '.join(repr(v) for v in SampleStream.values())})",
            name="ck_processing_rows_stream",
        ),
        Index("ix_processing_rows_session_stream", "session_id", "stream"),
        Index("ix_processing_rows_sample_id", "sample_id"),
    )
