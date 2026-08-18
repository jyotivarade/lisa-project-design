"""Uploaded files (docs/01 §3). Originals are immutable and never overwritten (§4)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import UploadStatus


class UploadedFile(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "uploaded_files"

    analytics_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("analytics.id", ondelete="RESTRICT"), nullable=False
    )
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(200))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=UploadStatus.STORED.value
    )
    header_columns: Mapped[list[str] | None] = mapped_column(JSONB)
    total_rows: Mapped[int | None] = mapped_column(Integer)
    empty_rows: Mapped[int | None] = mapped_column(Integer)
    malformed_rows: Mapped[int | None] = mapped_column(Integer)
    detected_analytes: Mapped[list[str] | None] = mapped_column(JSONB)

    # A duplicate is flagged, never silently deleted (§4).
    is_duplicate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("uploaded_files.id", ondelete="SET NULL")
    )
    validation_errors: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)

    sessions: Mapped[list["ProcessingSession"]] = relationship(  # noqa: F821
        back_populates="uploaded_file", order_by="ProcessingSession.session_number"
    )

    __table_args__ = (
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in UploadStatus.values())})",
            name="ck_uploaded_files_status",
        ),
        CheckConstraint("size_bytes >= 0", name="ck_uploaded_files_size"),
        Index("ix_uploaded_files_analytics_uploaded_at", "analytics_id", "uploaded_at"),
        Index("ix_uploaded_files_file_hash", "file_hash"),
        Index("ix_uploaded_files_status", "status"),
    )
