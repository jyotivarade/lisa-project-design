"""Analytics and configuration endpoints (spec section 24)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select

from app.api.deps import DbSession, RequestCtx, require_permission
from app.auth.permissions import Perm
from app.core.pagination import Page, PageParams
from app.models import Analytics, RuleDefinition, User
from app.repositories import analytics_repository as repo
from app.repositories import file_repository as files_repo
from app.schemas.analytics import (
    AnalyticsCreate,
    AnalyticsListItem,
    AnalyticsRead,
    AnalyticsUpdate,
)
from app.schemas.configuration import (
    ConfigurationRead,
    ConfigurationUpdate,
    ConfigurationUpdateResult,
    ConfigurationVersionSummary,
    RuleDefinitionRead,
)
from app.services import analytics_service, configuration_service

router = APIRouter(tags=["analytics"])

AnalyticsReader = Annotated[User, Depends(require_permission(Perm.ANALYTICS_READ))]
AnalyticsWriter = Annotated[User, Depends(require_permission(Perm.ANALYTICS_WRITE))]
ConfigReader = Annotated[User, Depends(require_permission(Perm.CONFIGURATION_READ))]
ConfigWriter = Annotated[User, Depends(require_permission(Perm.CONFIGURATION_WRITE))]


def _active_version(db: DbSession, analytics: Analytics) -> int | None:
    configuration = repo.get_configuration(db, analytics.id)
    if configuration is None or configuration.active_version is None:
        return None
    return configuration.active_version.version


@router.get(
    "/rule-definitions",
    response_model=list[RuleDefinitionRead],
    summary="The rule catalogue",
)
def rule_definitions(_: ConfigReader, db: DbSession) -> list[RuleDefinition]:
    """Every rule with its parameter schema, units, bounds and defaults.

    This is what the Configuration UI renders, which is why no business threshold
    ever needs to exist in the frontend (spec section 43).
    """
    return list(db.scalars(select(RuleDefinition).order_by(RuleDefinition.default_priority)))


@router.get("/analytics", response_model=Page[AnalyticsListItem], summary="List analytics")
def list_analytics(
    _: AnalyticsReader,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    include_inactive: bool = True,
) -> Page[AnalyticsListItem]:
    params = PageParams(page=page, page_size=page_size)
    rows, total = repo.list_analytics(
        db, limit=params.page_size, offset=params.offset, include_inactive=include_inactive
    )
    # Counts are read from real rows in one grouped query — never estimated, and
    # never seeded (spec section 27).
    stats = files_repo.analytics_file_stats(db, [row.id for row in rows])
    items = []
    for row in rows:
        item = AnalyticsListItem(
            **AnalyticsRead.model_validate(row).model_dump(),
            **stats.get(row.id, {}),
        )
        item.configuration_version = _active_version(db, row)
        items.append(item)
    return Page[AnalyticsListItem].build(items, total, params)


@router.post(
    "/analytics",
    response_model=AnalyticsRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create an analytics",
)
def create_analytics(
    payload: AnalyticsCreate, actor: AnalyticsWriter, db: DbSession, context: RequestCtx
) -> AnalyticsRead:
    analytics = analytics_service.create(
        db,
        name=payload.name,
        code=payload.code,
        description=payload.description,
        analyte_name=payload.analyte_name,
        actor_id=actor.id,
        context=context,
    )
    db.commit()
    result = AnalyticsRead.model_validate(analytics)
    result.configuration_version = _active_version(db, analytics)
    return result


@router.get("/analytics/{analytics_id}", response_model=AnalyticsRead, summary="Get an analytics")
def get_analytics(analytics_id: uuid.UUID, _: AnalyticsReader, db: DbSession) -> AnalyticsRead:
    analytics = analytics_service.get(db, analytics_id)
    result = AnalyticsRead.model_validate(analytics)
    result.configuration_version = _active_version(db, analytics)
    return result


@router.put(
    "/analytics/{analytics_id}", response_model=AnalyticsRead, summary="Update an analytics"
)
def update_analytics(
    analytics_id: uuid.UUID,
    payload: AnalyticsUpdate,
    actor: AnalyticsWriter,
    db: DbSession,
    context: RequestCtx,
) -> AnalyticsRead:
    analytics = analytics_service.update(
        db,
        analytics_id=analytics_id,
        name=payload.name,
        description=payload.description,
        analyte_name=payload.analyte_name,
        is_active=payload.is_active,
        actor_id=actor.id,
        context=context,
    )
    db.commit()
    result = AnalyticsRead.model_validate(analytics)
    result.configuration_version = _active_version(db, analytics)
    return result


@router.get(
    "/analytics/{analytics_id}/configuration",
    response_model=ConfigurationRead,
    summary="The active configuration",
)
def get_configuration(
    analytics_id: uuid.UUID, _: ConfigReader, db: DbSession
) -> ConfigurationRead:
    analytics_service.get(db, analytics_id)
    return configuration_service.get_active(db, analytics_id)


@router.post(
    "/analytics/{analytics_id}/configuration",
    response_model=ConfigurationUpdateResult,
    status_code=status.HTTP_201_CREATED,
    summary="Save configuration as a new version",
)
def update_configuration(
    analytics_id: uuid.UUID,
    payload: ConfigurationUpdate,
    actor: ConfigWriter,
    db: DbSession,
    context: RequestCtx,
) -> ConfigurationUpdateResult:
    analytics_service.get(db, analytics_id)
    version, diff = configuration_service.update(
        db,
        analytics_id=analytics_id,
        payload=payload.payload,
        change_note=payload.change_note,
        actor_id=actor.id,
        context=context,
    )
    db.commit()
    # affected_sessions is always 0 and says so deliberately: existing sessions hold
    # their own snapshot and cannot be moved by editing configuration.
    return ConfigurationUpdateResult(version=version.version, diff=diff, affected_sessions=0)


@router.get(
    "/analytics/{analytics_id}/configuration/versions",
    response_model=list[ConfigurationVersionSummary],
    summary="Configuration version history",
)
def list_versions(
    analytics_id: uuid.UUID, _: ConfigReader, db: DbSession
) -> list[ConfigurationVersionSummary]:
    analytics_service.get(db, analytics_id)
    configuration = repo.get_configuration(db, analytics_id)
    active_id = configuration.active_version_id if configuration else None
    return [
        ConfigurationVersionSummary(
            id=version.id,
            version=version.version,
            change_note=version.change_note,
            created_at=version.created_at,
            created_by_id=version.created_by_id,
            is_active=version.id == active_id,
        )
        for version in repo.list_versions(db, analytics_id)
    ]


@router.get(
    "/analytics/{analytics_id}/configuration/versions/{version}",
    response_model=ConfigurationRead,
    summary="A historical configuration version",
)
def get_version(
    analytics_id: uuid.UUID, version: int, _: ConfigReader, db: DbSession
) -> ConfigurationRead:
    analytics_service.get(db, analytics_id)
    return configuration_service.get_version(db, analytics_id, version)
