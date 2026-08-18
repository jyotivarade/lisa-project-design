"""Audit trail (§23). Written in the same transaction as the mutation it records."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class AuditLog(UUIDMixin, Base):
    """Append-only. No updated_at: an audit row that could be edited is not an audit row."""

    __tablename__ = "audit_logs"

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(80))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))
    analytics_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))
    session_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    audit_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
        Index("ix_audit_logs_actor_at", "actor_id", "at"),
        Index("ix_audit_logs_session", "session_id"),
        Index("ix_audit_logs_analytics_at", "analytics_id", "at"),
        Index("ix_audit_logs_action_at", "action", "at"),
    )
