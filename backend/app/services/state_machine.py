"""The processing state machine (spec section 16).

Declared once, here. Every transition goes through `transition()`, which refuses
anything not in the table and writes a `processing_events` row for the ones it
allows — so an illegal move is impossible and a legal one is always explained.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ErrorCode
from app.models import ProcessingEvent, ProcessingSession
from app.models.enums import ProcessingState as S

ALLOWED: dict[S, set[S]] = {
    S.UPLOADED: {S.VALIDATING},
    S.VALIDATING: {S.CALIBRATION_REVIEW, S.PROCESSING_FAILED},
    S.CALIBRATION_REVIEW: {S.CALIBRATION_FAILED, S.CONTROL_REVIEW, S.PROCESSING_FAILED},
    # A failed verdict is revisable: the user re-selects or corrects, and validation
    # runs again. That loop is the whole point of the review stages.
    S.CALIBRATION_FAILED: {S.CALIBRATION_REVIEW},
    S.CONTROL_REVIEW: {S.CONTROL_FAILED, S.READY, S.CALIBRATION_REVIEW, S.PROCESSING_FAILED},
    S.CONTROL_FAILED: {S.CONTROL_REVIEW, S.CALIBRATION_REVIEW},
    # READY can fall back to review: changing a calibrator selection after readiness
    # invalidates the verdict that granted it, and a stale PASS must never survive.
    S.READY: {S.PROCESSING_PATIENTS, S.CALIBRATION_REVIEW, S.CONTROL_REVIEW},
    S.PROCESSING_PATIENTS: {S.COMPLETED, S.PROCESSING_FAILED},
    # Terminal. A rerun creates a new session rather than reviving this one.
    S.COMPLETED: set(),
    S.PROCESSING_FAILED: set(),
}


class InvalidStateTransition(ConflictError):
    error_code = ErrorCode.INVALID_STATE


def can_transition(current: S, target: S) -> bool:
    return target in ALLOWED.get(current, set())


def transition(
    db: Session,
    session: ProcessingSession,
    target: S,
    *,
    actor_id: uuid.UUID | None = None,
    reason: str | None = None,
) -> ProcessingSession:
    current = S(session.state)
    if not can_transition(current, target):
        raise InvalidStateTransition(
            f"A processing session cannot move from {current.value} to {target.value}.",
            details=[{"from_state": current.value, "to_state": target.value}],
        )

    session.state = target.value
    db.add(
        ProcessingEvent(
            session_id=session.id,
            from_state=current.value,
            to_state=target.value,
            actor_id=actor_id,
            reason=reason,
        )
    )
    db.flush()
    return session
