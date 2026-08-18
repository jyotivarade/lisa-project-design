"""Analytics and configuration-version queries."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Analytics, AnalyticsConfiguration, AnalyticsConfigurationVersion


def get(db: Session, analytics_id: uuid.UUID) -> Analytics | None:
    return db.scalar(
        select(Analytics)
        .options(selectinload(Analytics.configuration))
        .where(Analytics.id == analytics_id)
    )


def get_by_code(db: Session, code: str) -> Analytics | None:
    return db.scalar(select(Analytics).where(Analytics.code == code))


def get_by_name(db: Session, name: str) -> Analytics | None:
    return db.scalar(select(Analytics).where(func.lower(Analytics.name) == name.strip().lower()))


def list_analytics(
    db: Session, *, limit: int, offset: int, include_inactive: bool = True
) -> tuple[Sequence[Analytics], int]:
    stmt = select(Analytics)
    count_stmt = select(func.count()).select_from(Analytics)
    if not include_inactive:
        stmt = stmt.where(Analytics.is_active.is_(True))
        count_stmt = count_stmt.where(Analytics.is_active.is_(True))

    total = db.scalar(count_stmt) or 0
    rows = db.scalars(
        stmt.options(selectinload(Analytics.configuration))
        .order_by(Analytics.name)
        .limit(limit)
        .offset(offset)
    ).all()
    return rows, total


def get_configuration(db: Session, analytics_id: uuid.UUID) -> AnalyticsConfiguration | None:
    return db.scalar(
        select(AnalyticsConfiguration)
        .options(selectinload(AnalyticsConfiguration.active_version))
        .where(AnalyticsConfiguration.analytics_id == analytics_id)
    )


def get_version(
    db: Session, analytics_id: uuid.UUID, version: int
) -> AnalyticsConfigurationVersion | None:
    return db.scalar(
        select(AnalyticsConfigurationVersion).where(
            AnalyticsConfigurationVersion.analytics_id == analytics_id,
            AnalyticsConfigurationVersion.version == version,
        )
    )


def list_versions(
    db: Session, analytics_id: uuid.UUID
) -> Sequence[AnalyticsConfigurationVersion]:
    return db.scalars(
        select(AnalyticsConfigurationVersion)
        .where(AnalyticsConfigurationVersion.analytics_id == analytics_id)
        .order_by(AnalyticsConfigurationVersion.version.desc())
    ).all()


def next_version_number(db: Session, analytics_id: uuid.UUID) -> int:
    highest = db.scalar(
        select(func.max(AnalyticsConfigurationVersion.version)).where(
            AnalyticsConfigurationVersion.analytics_id == analytics_id
        )
    )
    return (highest or 0) + 1
