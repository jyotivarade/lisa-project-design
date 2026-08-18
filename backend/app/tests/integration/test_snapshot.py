"""Snapshot resolution (AD-1, spec sections 22 and 35).

Phase 4 pins each processing session to the payload `resolve_snapshot` returns.
These tests establish the property Phase 6 depends on: once taken, a snapshot is
detached from the live configuration for good.
"""

import copy

import pytest

from app.models.enums import RoleName
from app.services import configuration_service
from app.services.configuration_validator import ConfigurationInvalid
from app.tests.conftest import requires_db

pytestmark = [pytest.mark.integration, requires_db]


@pytest.fixture
def analytics(client, login):
    headers = login(RoleName.ANALYST)[1]
    created = client.post(
        "/api/analytics",
        json={"name": "Cocaine", "code": "cocaine", "analyte_name": "Cocaine"},
        headers=headers,
    ).json()
    return created, headers


def tolerance(payload: dict) -> float:
    rule = next(r for r in payload["rules"] if r["rule_key"] == "calibration_accuracy")
    return rule["parameters"]["tolerance_percent"]


def test_snapshot_returns_the_active_version_and_its_payload(db, analytics) -> None:
    created, _ = analytics
    version_id, payload = configuration_service.resolve_snapshot(db, created["id"])
    assert version_id is not None
    assert tolerance(payload) == 25


def test_a_snapshot_is_a_copy_not_a_live_view(client, db, analytics) -> None:
    """The core of spec section 35, expressed as it will be used.

    Day 1: a session pins tolerance 25. Day 2: an administrator sets 10. The
    session's copy must still read 25, or no historical result is reproducible.
    """
    created, headers = analytics
    _, snapshot = configuration_service.resolve_snapshot(db, created["id"])
    snapshot = copy.deepcopy(snapshot)
    assert tolerance(snapshot) == 25

    payload = client.get(
        f"/api/analytics/{created['id']}/configuration", headers=headers
    ).json()["payload"]
    for rule in payload["rules"]:
        if rule["rule_key"] == "calibration_accuracy":
            rule["parameters"]["tolerance_percent"] = 10
    response = client.post(
        f"/api/analytics/{created['id']}/configuration",
        json={"payload": payload, "change_note": "Tighten to 10%"},
        headers=headers,
    )
    assert response.status_code == 201

    assert tolerance(snapshot) == 25
    _, fresh = configuration_service.resolve_snapshot(db, created["id"])
    assert tolerance(fresh) == 10


def test_the_snapshot_tracks_which_version_it_came_from(client, db, analytics) -> None:
    created, headers = analytics
    first_id, _ = configuration_service.resolve_snapshot(db, created["id"])

    payload = client.get(
        f"/api/analytics/{created['id']}/configuration", headers=headers
    ).json()["payload"]
    payload["analyte_scope_policy"] = "ALL"
    client.post(
        f"/api/analytics/{created['id']}/configuration",
        json={"payload": payload},
        headers=headers,
    )

    second_id, _ = configuration_service.resolve_snapshot(db, created["id"])
    assert second_id != first_id


def test_an_invalid_stored_configuration_refuses_to_snapshot(db, analytics) -> None:
    """Validation runs again here, not only on write: a snapshot is worth taking
    only if it can actually be executed (spec section 39)."""
    from app.repositories import analytics_repository as repo

    created, _ = analytics
    configuration = repo.get_configuration(db, created["id"])
    broken = copy.deepcopy(configuration.active_version.payload)
    broken["calibration"]["minimum_required"] = 99
    configuration.active_version.payload = broken
    db.flush()

    with pytest.raises(ConfigurationInvalid):
        configuration_service.resolve_snapshot(db, created["id"])
