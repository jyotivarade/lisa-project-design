"""Idempotent reference-data seeding: roles, permissions and the rule catalogue.

This is reference data, not demo data. No analytics, no files, no results are ever
created here — the application must show "No analytics data available" on a fresh
install rather than fabricate numbers (spec section 27).

Running it twice is a no-op; running it after a catalogue change updates in place.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.permissions import (
    PERMISSION_DESCRIPTIONS,
    ROLE_DESCRIPTIONS,
    ROLE_PERMISSIONS,
)
from app.core.rule_catalog import RULE_CATALOG
from app.models import Permission, Role, RolePermission, RuleDefinition

logger = logging.getLogger(__name__)


def seed_permissions(db: Session) -> dict[str, Permission]:
    existing = {p.code: p for p in db.scalars(select(Permission))}
    for code, description in PERMISSION_DESCRIPTIONS.items():
        if code in existing:
            existing[code].description = description
        else:
            perm = Permission(code=code, description=description)
            db.add(perm)
            existing[code] = perm
    db.flush()
    return existing


def seed_roles(db: Session, permissions: dict[str, Permission]) -> dict[str, Role]:
    existing = {r.name: r for r in db.scalars(select(Role))}
    for name, description in ROLE_DESCRIPTIONS.items():
        if name in existing:
            existing[name].description = description
        else:
            role = Role(name=name, description=description, is_system=True)
            db.add(role)
            existing[name] = role
    db.flush()

    current = {
        (rp.role_id, rp.permission_id) for rp in db.scalars(select(RolePermission))
    }
    wanted: set[tuple] = set()
    for role_name, codes in ROLE_PERMISSIONS.items():
        role = existing[role_name]
        for code in codes:
            wanted.add((role.id, permissions[code].id))

    for role_id, permission_id in sorted(wanted - current, key=str):
        db.add(RolePermission(role_id=role_id, permission_id=permission_id))
    # A permission removed from a role in the catalogue must actually be revoked,
    # otherwise the seed grants a privilege nobody can see in the code.
    for role_id, permission_id in current - wanted:
        stale = db.scalar(
            select(RolePermission).where(
                RolePermission.role_id == role_id,
                RolePermission.permission_id == permission_id,
            )
        )
        if stale is not None:
            db.delete(stale)
    db.flush()
    return existing


def seed_rule_definitions(db: Session) -> dict[str, RuleDefinition]:
    existing = {r.rule_key: r for r in db.scalars(select(RuleDefinition))}
    for entry in RULE_CATALOG:
        rule = existing.get(entry["rule_key"])
        if rule is None:
            rule = RuleDefinition(rule_key=entry["rule_key"])
            db.add(rule)
            existing[entry["rule_key"]] = rule
        rule.name = entry["name"]
        rule.description = entry["description"]
        rule.stream = entry["stream"]
        rule.default_enabled = entry["default_enabled"]
        rule.default_mandatory = entry["default_mandatory"]
        rule.default_priority = entry["default_priority"]
        rule.parameter_schema = entry["parameter_schema"]
        rule.error_codes = entry["error_codes"]
    db.flush()
    return existing


def seed_reference_data(db: Session) -> dict[str, int]:
    """Seed everything. Returns the resulting row counts."""
    permissions = seed_permissions(db)
    roles = seed_roles(db, permissions)
    rules = seed_rule_definitions(db)
    counts = {
        "permissions": len(permissions),
        "roles": len(roles),
        "rule_definitions": len(rules),
    }
    logger.info("Reference data seeded", extra=counts)
    return counts
