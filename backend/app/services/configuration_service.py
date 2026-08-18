"""Versioned configuration (AD-1, spec sections 18 and 22).

`analytics_configuration_versions` is append-only. An edit inserts version N+1 and
repoints the active pointer; no UPDATE is ever issued against a stored payload.
That is the whole mechanism behind spec section 35: a completed session holds its
own snapshot, so changing configuration afterwards cannot move a historical result.
"""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.audit import RequestContext, record
from app.core.errors import NotFoundError
from app.core.rule_catalog import default_configuration_payload
from app.models import AnalyticsConfiguration, AnalyticsConfigurationVersion
from app.models.enums import AuditAction
from app.repositories import analytics_repository as repo
from app.schemas.configuration import (
    ConfigurationDiffEntry,
    ConfigurationPayload,
    ConfigurationRead,
)
from app.services.configuration_validator import require_valid


def _payload_of(version: AnalyticsConfigurationVersion) -> ConfigurationPayload:
    return ConfigurationPayload.model_validate(version.payload)


def create_initial_version(
    db: Session,
    *,
    analytics_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    context: RequestContext | None = None,
) -> AnalyticsConfigurationVersion:
    """Version 1, seeded from the rule catalogue.

    Seeded once, at creation. From here the values live in the database, and
    changing a default in code has no effect on any analytics that already exists.
    """
    payload = default_configuration_payload()
    require_valid(db, ConfigurationPayload.model_validate(payload))

    version = AnalyticsConfigurationVersion(
        analytics_id=analytics_id,
        version=1,
        payload=payload,
        change_note="Initial configuration seeded from the rule catalogue.",
        created_by_id=actor_id,
    )
    db.add(version)
    db.flush()

    pointer = AnalyticsConfiguration(
        analytics_id=analytics_id, active_version_id=version.id, updated_by_id=actor_id
    )
    db.add(pointer)
    db.flush()

    record(
        db,
        action=AuditAction.CONFIG_CREATED,
        actor_id=actor_id,
        entity_type="analytics_configuration_version",
        entity_id=version.id,
        analytics_id=analytics_id,
        new_value={"version": 1},
        context=context,
    )
    return version


def get_active(db: Session, analytics_id: uuid.UUID) -> ConfigurationRead:
    configuration = repo.get_configuration(db, analytics_id)
    if configuration is None or configuration.active_version is None:
        raise NotFoundError("This analytics has no active configuration.")
    version = configuration.active_version
    return ConfigurationRead(
        analytics_id=analytics_id,
        version=version.version,
        payload=_payload_of(version),
        change_note=version.change_note,
        created_at=version.created_at,
        created_by_id=version.created_by_id,
    )


def get_version(db: Session, analytics_id: uuid.UUID, version_number: int) -> ConfigurationRead:
    version = repo.get_version(db, analytics_id, version_number)
    if version is None:
        raise NotFoundError(f"Configuration version {version_number} does not exist.")
    return ConfigurationRead(
        analytics_id=analytics_id,
        version=version.version,
        payload=_payload_of(version),
        change_note=version.change_note,
        created_at=version.created_at,
        created_by_id=version.created_by_id,
    )


def update(
    db: Session,
    *,
    analytics_id: uuid.UUID,
    payload: ConfigurationPayload,
    change_note: str | None,
    actor_id: uuid.UUID | None,
    context: RequestContext | None = None,
) -> tuple[AnalyticsConfigurationVersion, list[ConfigurationDiffEntry]]:
    configuration = repo.get_configuration(db, analytics_id)
    if configuration is None:
        raise NotFoundError("This analytics has no configuration.")

    require_valid(db, payload)

    previous = configuration.active_version
    previous_payload = dict(previous.payload) if previous else {}
    new_payload = payload.model_dump(mode="json")
    diff = compute_diff(previous_payload, new_payload)

    version = AnalyticsConfigurationVersion(
        analytics_id=analytics_id,
        version=repo.next_version_number(db, analytics_id),
        payload=new_payload,
        change_note=change_note,
        created_by_id=actor_id,
    )
    db.add(version)
    db.flush()

    configuration.active_version_id = version.id
    configuration.updated_by_id = actor_id
    db.flush()

    record(
        db,
        action=AuditAction.CONFIG_CHANGED,
        actor_id=actor_id,
        entity_type="analytics_configuration_version",
        entity_id=version.id,
        analytics_id=analytics_id,
        old_value={"version": previous.version if previous else None},
        new_value={"version": version.version},
        metadata={"change_note": change_note, "changes": [d.model_dump() for d in diff]},
        context=context,
    )
    return version, diff


def resolve_snapshot(db: Session, analytics_id: uuid.UUID) -> tuple[uuid.UUID, dict[str, Any]]:
    """The configuration a new processing session will be pinned to (AD-1).

    Returns `(version_id, payload)`. Phase 4 copies the payload into
    `processing_sessions.config_snapshot`, and from that moment the session is
    immune to any further configuration change.
    """
    configuration = repo.get_configuration(db, analytics_id)
    if configuration is None or configuration.active_version is None:
        raise NotFoundError("This analytics has no active configuration.")

    version = configuration.active_version
    # Validated again here: a snapshot is only worth taking if it can actually run.
    require_valid(db, ConfigurationPayload.model_validate(version.payload))
    return version.id, dict(version.payload)


def compute_diff(before: Any, after: Any, path: str = "") -> list[ConfigurationDiffEntry]:
    """A flat, path-addressed diff between two configuration payloads.

    Shown in the version history so a reviewer can see exactly which threshold moved
    between two runs, rather than comparing two walls of JSON.
    """
    entries: list[ConfigurationDiffEntry] = []

    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            child = f"{path}.{key}" if path else key
            if key not in before:
                entries.append(
                    ConfigurationDiffEntry(path=child, to_value=after[key], change="added")
                )
            elif key not in after:
                entries.append(
                    ConfigurationDiffEntry(path=child, from_value=before[key], change="removed")
                )
            else:
                entries.extend(compute_diff(before[key], after[key], child))
        return entries

    if isinstance(before, list) and isinstance(after, list):
        # Rule and classification lists are keyed collections, not ordered ones:
        # comparing them by index would report a reorder as a wholesale rewrite.
        before_keyed = _key_list(before)
        after_keyed = _key_list(after)
        if before_keyed is not None and after_keyed is not None:
            for key in sorted(set(before_keyed) | set(after_keyed)):
                child = f"{path}[{key}]"
                if key not in before_keyed:
                    entries.append(
                        ConfigurationDiffEntry(
                            path=child, to_value=after_keyed[key], change="added"
                        )
                    )
                elif key not in after_keyed:
                    entries.append(
                        ConfigurationDiffEntry(
                            path=child, from_value=before_keyed[key], change="removed"
                        )
                    )
                else:
                    entries.extend(compute_diff(before_keyed[key], after_keyed[key], child))
            return entries

    if before != after:
        entries.append(
            ConfigurationDiffEntry(path=path, from_value=before, to_value=after, change="changed")
        )
    return entries


def _key_list(items: list[Any]) -> dict[str, Any] | None:
    """Index a list of dicts by a natural key, when they have one."""
    if not items or not all(isinstance(i, dict) for i in items):
        return None
    for candidate in ("rule_key", "label"):
        if all(candidate in item for item in items):
            keyed = {str(item[candidate]): item for item in items}
            if len(keyed) == len(items):
                return keyed
    return None
