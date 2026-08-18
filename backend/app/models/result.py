"""Patient results, per-rule outcomes, calculation traces and outputs (docs/01 §6)."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import FinalResult, OutputKind, RuleStatus, TraceKey

MEASURE = Numeric(18, 6)


class ProcessingResult(UUIDMixin, TimestampMixin, Base):
    """One evaluated patient row.

    `original_concentration` is never overwritten (§9): an adjustment produced by a
    rule is recorded separately alongside the cut-off that caused it.
    """

    __tablename__ = "processing_results"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("processing_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    processing_row_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("processing_rows.id", ondelete="CASCADE"), nullable=False
    )
    source_row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    sample_id: Mapped[str] = mapped_column(String(200), nullable=False)
    analyte_name: Mapped[str | None] = mapped_column(String(200))

    final_result: Mapped[str] = mapped_column(String(10), nullable=False)
    original_concentration: Mapped[Decimal | None] = mapped_column(MEASURE)
    adjusted_concentration: Mapped[Decimal | None] = mapped_column(MEASURE)
    cutoff_value: Mapped[Decimal | None] = mapped_column(MEASURE)

    istd_area: Mapped[Decimal | None] = mapped_column(MEASURE)
    ion_ratio: Mapped[Decimal | None] = mapped_column(MEASURE)
    found_rt: Mapped[Decimal | None] = mapped_column(MEASURE)

    rules_evaluated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rules_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failure_codes: Mapped[list[str]] = mapped_column(
        ARRAY(String(60)), nullable=False, server_default="{}"
    )
    evaluation_details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    rule_results: Mapped[list["RuleResult"]] = relationship(
        back_populates="result", cascade="all, delete-orphan", order_by="RuleResult.priority"
    )

    __table_args__ = (
        UniqueConstraint("session_id", "processing_row_id", name="uq_result_per_row"),
        CheckConstraint(
            f"final_result IN ({', '.join(repr(v) for v in FinalResult.values())})",
            name="ck_results_final_result",
        ),
        Index("ix_results_session_final", "session_id", "final_result"),
        Index("ix_results_session_sample", "session_id", "sample_id"),
        Index("ix_results_analyte_name", "analyte_name"),
        Index("ix_results_failure_codes", "failure_codes", postgresql_using="gin"),
    )


class RuleResult(UUIDMixin, TimestampMixin, Base):
    """One rule's outcome for one row — passes included.

    §14 requires the full evaluation, not a boolean: a reviewer must be able to see
    `PASS - Internal Standard` next to `FAIL - Ion Ratio`.
    """

    __tablename__ = "rule_results"

    processing_result_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("processing_results.id", ondelete="CASCADE"),
        nullable=False,
    )
    rule_key: Mapped[str] = mapped_column(String(60), nullable=False)
    rule_name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(60))
    original_value: Mapped[str | None] = mapped_column(Text)
    calculated_value: Mapped[str | None] = mapped_column(Text)
    threshold: Mapped[str | None] = mapped_column(Text)
    lower_limit: Mapped[Decimal | None] = mapped_column(MEASURE)
    upper_limit: Mapped[Decimal | None] = mapped_column(MEASURE)
    message: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rule_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)

    result: Mapped[ProcessingResult] = relationship(back_populates="rule_results")

    __table_args__ = (
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in RuleStatus.values())})",
            name="ck_rule_results_status",
        ),
        Index("ix_rule_results_result", "processing_result_id"),
        Index("ix_rule_results_key_status", "rule_key", "status"),
    )


class CalculationTrace(UUIDMixin, TimestampMixin, Base):
    """How a derived limit was computed — formula, inputs, exclusions, result.

    This is what lets the UI answer "where did 24.45 – 34.77 come from?" without the
    reviewer reverse-engineering it from the CSV (§10, §11, §17).
    """

    __tablename__ = "calculation_traces"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("processing_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    formula: Mapped[str] = mapped_column(Text, nullable=False)
    inputs: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    excluded: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    adjustment_percent: Mapped[Decimal | None] = mapped_column(MEASURE)
    adjustment_value: Mapped[Decimal | None] = mapped_column(MEASURE)
    lower_limit: Mapped[Decimal | None] = mapped_column(MEASURE)
    upper_limit: Mapped[Decimal | None] = mapped_column(MEASURE)
    result: Mapped[Decimal | None] = mapped_column(MEASURE)

    __table_args__ = (
        UniqueConstraint("session_id", "key", name="uq_trace_per_session_key"),
        CheckConstraint(
            f"key IN ({', '.join(repr(v) for v in TraceKey.values())})",
            name="ck_calculation_traces_key",
        ),
        Index("ix_calculation_traces_session", "session_id"),
    )


class OutputFile(UUIDMixin, TimestampMixin, Base):
    """Generated PASSED / EXCEPTIONS artefacts. Additive only — a rerun writes new
    objects under a new session, so a download a year later is byte-identical."""

    __tablename__ = "output_files"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("processing_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    generated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        UniqueConstraint("session_id", "kind", name="uq_output_per_session_kind"),
        CheckConstraint(
            f"kind IN ({', '.join(repr(v) for v in OutputKind.values())})",
            name="ck_output_files_kind",
        ),
        Index("ix_output_files_session_kind", "session_id", "kind"),
    )
