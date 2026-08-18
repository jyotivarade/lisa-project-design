"""Analytics management (spec section 3)."""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import RequestContext, record
from app.core.errors import ErrorCode, LisaError, NotFoundError
from app.models import Analytics
from app.models.enums import AuditAction
from app.repositories import analytics_repository as repo
from app.services import configuration_service


class AnalyticsConflict(LisaError):
    status_code = 409
    error_code = ErrorCode.VALIDATION_ERROR


def get(db: Session, analytics_id: uuid.UUID) -> Analytics:
    analytics = repo.get(db, analytics_id)
    if analytics is None:
        raise NotFoundError("Analytics not found.")
    return analytics


def create(
    db: Session,
    *,
    name: str,
    code: str,
    description: str | None,
    analyte_name: str,
    actor_id: uuid.UUID | None,
    context: RequestContext | None = None,
) -> Analytics:
    """Create an analytics and its configuration version 1, atomically.

    An analytics without configuration could not be processed, so the two are
    created together or not at all.
    """
    if repo.get_by_code(db, code) is not None:
        raise AnalyticsConflict(
            "An analytics with that code already exists.",
            details=[{"field": "code", "issue": "Already in use."}],
        )
    if repo.get_by_name(db, name) is not None:
        raise AnalyticsConflict(
            "An analytics with that name already exists.",
            details=[{"field": "name", "issue": "Already in use."}],
        )

    analytics = Analytics(
        name=name,
        code=code,
        description=description,
        analyte_name=analyte_name,
        is_active=True,
        created_by_id=actor_id,
        updated_by_id=actor_id,
    )
    db.add(analytics)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise AnalyticsConflict("An analytics with that name or code already exists.") from exc

    record(
        db,
        action=AuditAction.ANALYTICS_CREATED,
        actor_id=actor_id,
        entity_type="analytics",
        entity_id=analytics.id,
        analytics_id=analytics.id,
        new_value={"name": name, "code": code, "analyte_name": analyte_name},
        context=context,
    )
    configuration_service.create_initial_version(
        db, analytics_id=analytics.id, actor_id=actor_id, context=context
    )
    return analytics


def update(
    db: Session,
    *,
    analytics_id: uuid.UUID,
    name: str | None,
    description: str | None,
    analyte_name: str | None,
    is_active: bool | None,
    actor_id: uuid.UUID | None,
    context: RequestContext | None = None,
) -> Analytics:
    analytics = get(db, analytics_id)
    before = {
        "name": analytics.name,
        "description": analytics.description,
        "analyte_name": analytics.analyte_name,
        "is_active": analytics.is_active,
    }

    if name is not None and name.strip().lower() != analytics.name.lower():
        clash = repo.get_by_name(db, name)
        if clash is not None and clash.id != analytics.id:
            raise AnalyticsConflict(
                "An analytics with that name already exists.",
                details=[{"field": "name", "issue": "Already in use."}],
            )
        analytics.name = name.strip()

    if description is not None:
        analytics.description = description
    if analyte_name is not None:
        analytics.analyte_name = analyte_name.strip()
    if is_active is not None:
        analytics.is_active = is_active

    analytics.updated_by_id = actor_id
    db.flush()

    record(
        db,
        action=AuditAction.ANALYTICS_UPDATED,
        actor_id=actor_id,
        entity_type="analytics",
        entity_id=analytics.id,
        analytics_id=analytics.id,
        old_value=before,
        new_value={
            "name": analytics.name,
            "description": analytics.description,
            "analyte_name": analytics.analyte_name,
            "is_active": analytics.is_active,
        },
        context=context,
    )
    return analytics
