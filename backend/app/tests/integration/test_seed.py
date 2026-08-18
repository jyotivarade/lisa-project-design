"""Reference-data seeding: idempotent, and it seeds nothing but reference data."""

import pytest
from sqlalchemy import func, select

from app.auth.permissions import ALL_PERMISSIONS, ROLE_PERMISSIONS
from app.core.rule_catalog import RULE_CATALOG
from app.core.seed import seed_reference_data
from app.models import (
    Analytics,
    Permission,
    ProcessingSession,
    Role,
    RolePermission,
    RuleDefinition,
    UploadedFile,
)
from app.tests.conftest import requires_db

pytestmark = [pytest.mark.integration, requires_db]


def test_seed_creates_roles_permissions_and_rules(db) -> None:
    seed_reference_data(db)
    assert db.scalar(select(func.count()).select_from(Permission)) == len(ALL_PERMISSIONS)
    assert db.scalar(select(func.count()).select_from(Role)) == len(ROLE_PERMISSIONS)
    assert db.scalar(select(func.count()).select_from(RuleDefinition)) == len(RULE_CATALOG)


def test_seed_is_idempotent(db) -> None:
    seed_reference_data(db)
    first = db.scalar(select(func.count()).select_from(RolePermission))
    seed_reference_data(db)
    seed_reference_data(db)
    assert db.scalar(select(func.count()).select_from(RolePermission)) == first


def test_seed_creates_no_business_data(db) -> None:
    """Spec section 27: an empty install must say 'No analytics data available'
    rather than show numbers nobody uploaded."""
    seed_reference_data(db)
    assert db.scalar(select(func.count()).select_from(Analytics)) == 0
    assert db.scalar(select(func.count()).select_from(UploadedFile)) == 0
    assert db.scalar(select(func.count()).select_from(ProcessingSession)) == 0


def test_role_permission_matrix(db) -> None:
    seed_reference_data(db)
    granted = {
        role.name: {p.code for p in role.permissions}
        for role in db.scalars(select(Role))
    }
    assert granted["ADMIN"] == set(ALL_PERMISSIONS)
    # Separation of duty (section 37): an analyst runs the workflow but cannot
    # administer users or roles, and cannot read the audit trail.
    assert "users:write" not in granted["ANALYST"]
    assert "roles:write" not in granted["ANALYST"]
    assert "audit:read" not in granted["ANALYST"]
    assert "processing:execute" in granted["ANALYST"]
    # A viewer can never start processing or mutate anything.
    assert all(":read" in c or c == "files:download" for c in granted["VIEWER"])
    assert "processing:execute" not in granted["VIEWER"]


def test_revoked_permission_is_actually_removed(db, monkeypatch) -> None:
    """A permission dropped from the catalogue must be revoked, not left granted —
    otherwise the seed silently keeps a privilege that no longer appears in code."""
    seed_reference_data(db)
    trimmed = {k: list(v) for k, v in ROLE_PERMISSIONS.items()}
    trimmed["ANALYST"] = [c for c in trimmed["ANALYST"] if c != "processing:execute"]
    monkeypatch.setattr("app.core.seed.ROLE_PERMISSIONS", trimmed)

    seed_reference_data(db)
    analyst = db.scalar(select(Role).where(Role.name == "ANALYST"))
    db.refresh(analyst)
    assert "processing:execute" not in {p.code for p in analyst.permissions}


def test_rule_definitions_carry_their_parameter_schema(db) -> None:
    seed_reference_data(db)
    ion_ratio = db.scalar(select(RuleDefinition).where(RuleDefinition.rule_key == "ion_ratio"))
    schema = ion_ratio.parameter_schema
    # This is what the Configuration UI renders, which is why no threshold needs to
    # exist in React (section 43).
    assert schema["adjustment_percent"]["default"] == 10
    assert schema["adjustment_percent"]["minimum"] == 0
    assert schema["formula"]["choices"] == ["SPAN", "MULTIPLICATIVE"]
