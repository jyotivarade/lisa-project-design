"""Calibrator/control selections and row corrections (docs/01 §5)."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import ControlRole, SampleStream, ValidationStatus, ValueState

# Instrument values: 18 significant digits with 6 decimal places comfortably covers
# ISTD areas in the tens of millions and retention times to a thousandth of a minute,
# without the reproducibility hazard of binary floating point.
MEASURE = Numeric(18, 6)


class CalibratorSelection(UUIDMixin, TimestampMixin, Base):
    """One discovered calibrator in one session: what it is, whether the user selected
    it, whether it may contribute to the derived ranges, and how it validated."""

    __tablename__ = "calibrator_selections"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("processing_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    processing_row_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("processing_rows.id", ondelete="CASCADE"), nullable=False
    )
    calibrator_id: Mapped[str] = mapped_column(String(100), nullable=False)

    is_selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    value_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ValueState.VALID.value
    )
    # Shown as "Included in range: YES/NO" in the UI (§10) — an invalid Cal_1 must be
    # visibly excluded, never silently folded into the reference range.
    included_in_range: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    percent_diff: Mapped[Decimal | None] = mapped_column(MEASURE)
    ion_ratio: Mapped[Decimal | None] = mapped_column(MEASURE)
    found_rt: Mapped[Decimal | None] = mapped_column(MEASURE)
    std_concentration: Mapped[Decimal | None] = mapped_column(MEASURE)
    concentration: Mapped[Decimal | None] = mapped_column(MEASURE)
    istd_area: Mapped[Decimal | None] = mapped_column(MEASURE)

    validation_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ValidationStatus.NOT_EVALUATED.value
    )
    validation_reason: Mapped[str | None] = mapped_column(Text)
    threshold_used: Mapped[Decimal | None] = mapped_column(MEASURE)

    selected_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    selected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("session_id", "calibrator_id", name="uq_session_calibrator"),
        CheckConstraint(
            f"value_state IN ({', '.join(repr(v) for v in ValueState.values())})",
            name="ck_calibrator_value_state",
        ),
        CheckConstraint(
            f"validation_status IN ({', '.join(repr(v) for v in ValidationStatus.values())})",
            name="ck_calibrator_validation_status",
        ),
        Index("ix_calibrator_selections_session", "session_id"),
    )


class ControlSelection(UUIDMixin, TimestampMixin, Base):
    """Same shape as a calibrator, plus the role that decides whether it gates the run.

    A control discovered in the file but unknown to configuration (e.g. `UC`) is
    DISCOVERED: listed and visible, but neither silently passed nor falsely failed.
    """

    __tablename__ = "control_selections"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("processing_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    processing_row_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("processing_rows.id", ondelete="CASCADE"), nullable=False
    )
    control_id: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ControlRole.DISCOVERED.value
    )
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    is_selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    value_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ValueState.VALID.value
    )
    percent_diff: Mapped[Decimal | None] = mapped_column(MEASURE)
    ion_ratio: Mapped[Decimal | None] = mapped_column(MEASURE)
    found_rt: Mapped[Decimal | None] = mapped_column(MEASURE)
    std_concentration: Mapped[Decimal | None] = mapped_column(MEASURE)
    concentration: Mapped[Decimal | None] = mapped_column(MEASURE)

    validation_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ValidationStatus.NOT_EVALUATED.value
    )
    validation_reason: Mapped[str | None] = mapped_column(Text)
    threshold_used: Mapped[Decimal | None] = mapped_column(MEASURE)

    selected_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    selected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("session_id", "control_id", name="uq_session_control"),
        CheckConstraint(
            f"role IN ({', '.join(repr(v) for v in ControlRole.values())})",
            name="ck_control_role",
        ),
        CheckConstraint(
            f"value_state IN ({', '.join(repr(v) for v in ValueState.values())})",
            name="ck_control_value_state",
        ),
        CheckConstraint(
            f"validation_status IN ({', '.join(repr(v) for v in ValidationStatus.values())})",
            name="ck_control_validation_status",
        ),
        Index("ix_control_selections_session", "session_id"),
    )


class RowCorrection(UUIDMixin, TimestampMixin, Base):
    """A user correction to a calibrator/control value (§19).

    The uploaded file is never modified and `processing_rows.raw` is never mutated:
    the effective value is the latest active correction, else the raw value. Both the
    original and the correction are retained permanently, with actor and reason.
    """

    __tablename__ = "row_corrections"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("processing_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    processing_row_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("processing_rows.id", ondelete="CASCADE"), nullable=False
    )
    stream: Mapped[str] = mapped_column(String(20), nullable=False)
    column_role: Mapped[str] = mapped_column(String(60), nullable=False)
    column_name: Mapped[str] = mapped_column(String(200), nullable=False)

    original_value: Mapped[str] = mapped_column(Text, nullable=False)
    corrected_value: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    corrected_by_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    corrected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # A superseded correction is deactivated, never deleted.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (
        CheckConstraint(
            f"stream IN ({', '.join(repr(v) for v in SampleStream.values())})",
            name="ck_row_corrections_stream",
        ),
        CheckConstraint("length(trim(reason)) > 0", name="ck_row_corrections_reason_present"),
        Index("ix_row_corrections_session", "session_id"),
        Index("ix_row_corrections_row", "processing_row_id", "is_active"),
    )
