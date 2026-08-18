"""Assay definition, versioned configuration and the rule catalogue (docs/01 §2)."""

import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import SampleStream


class Analytics(UUIDMixin, TimestampMixin, Base):
    """One assay/analyte configuration. Names are data, never code (§3, §30)."""

    __tablename__ = "analytics"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    analyte_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    configuration: Mapped["AnalyticsConfiguration | None"] = relationship(
        back_populates="analytics", uselist=False
    )
    versions: Mapped[list["AnalyticsConfigurationVersion"]] = relationship(
        back_populates="analytics", order_by="AnalyticsConfigurationVersion.version"
    )

    __table_args__ = (
        Index("ix_analytics_is_active", "is_active"),
        # Case-insensitive uniqueness on the display name: two analytics called
        # "Cocaine" and "cocaine" would be a data-entry accident, not two assays.
        Index("uq_analytics_name_lower", text("lower(name)"), unique=True),
    )


class AnalyticsConfigurationVersion(UUIDMixin, TimestampMixin, Base):
    """APPEND-ONLY (AD-1). No UPDATE is ever issued against this table.

    `payload` is the complete resolved configuration and is the exact shape copied
    into processing_sessions.config_snapshot at session creation.
    """

    __tablename__ = "analytics_configuration_versions"

    analytics_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("analytics.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    change_note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    analytics: Mapped[Analytics] = relationship(back_populates="versions")

    __table_args__ = (
        UniqueConstraint("analytics_id", "version", name="uq_config_version"),
        CheckConstraint("version >= 1", name="ck_config_version_positive"),
        Index("ix_config_versions_analytics_id", "analytics_id"),
    )


class AnalyticsConfiguration(UUIDMixin, TimestampMixin, Base):
    """Pointer to the active version. 1:1 with analytics."""

    __tablename__ = "analytics_configurations"

    analytics_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("analytics.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    active_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("analytics_configuration_versions.id", ondelete="RESTRICT"),
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    analytics: Mapped[Analytics] = relationship(back_populates="configuration")
    active_version: Mapped[AnalyticsConfigurationVersion | None] = relationship()


class RuleDefinition(UUIDMixin, TimestampMixin, Base):
    """The rule catalogue (§18, §37).

    This is what the Configuration UI renders, which is why no threshold ever needs
    to exist in React (§43). `parameter_schema` carries type, unit, min, max, default
    and help text for every parameter of the rule.
    """

    __tablename__ = "rule_definitions"

    rule_key: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    stream: Mapped[str] = mapped_column(String(20), nullable=False)
    default_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    default_mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    default_priority: Mapped[int] = mapped_column(Integer, nullable=False)
    parameter_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    error_codes: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=list)

    __table_args__ = (
        CheckConstraint(
            f"stream IN ({', '.join(repr(v) for v in SampleStream.values())})",
            name="ck_rule_definitions_stream",
        ),
        Index("ix_rule_definitions_priority", "default_priority"),
    )
