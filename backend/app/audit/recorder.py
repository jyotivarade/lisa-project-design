"""Audit writer (spec section 23).

The audit row is added to the caller's session, never committed independently: an
action that commits is always logged, and an action that rolls back is never logged.
An audit trail that can disagree with what happened is worse than none.
"""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog
from app.models.enums import AuditAction


class RequestContext:
    """The who-and-from-where of a request, threaded into audit rows."""

    __slots__ = ("ip", "user_agent")

    def __init__(self, ip: str | None = None, user_agent: str | None = None) -> None:
        self.ip = ip
        self.user_agent = user_agent


def record(
    db: Session,
    *,
    action: AuditAction,
    actor_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    analytics_id: uuid.UUID | None = None,
    session_id: uuid.UUID | None = None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    context: RequestContext | None = None,
) -> AuditLog:
    entry = AuditLog(
        action=action.value,
        actor_id=actor_id,
        entity_type=entity_type,
        entity_id=entity_id,
        analytics_id=analytics_id,
        session_id=session_id,
        old_value=old_value,
        new_value=new_value,
        audit_metadata=metadata,
        ip=context.ip if context else None,
        user_agent=context.user_agent if context else None,
    )
    db.add(entry)
    return entry
