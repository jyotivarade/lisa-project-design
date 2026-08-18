"""Analytics management and versioned configuration."""

import copy

import pytest
from sqlalchemy import func, select

from app.models import Analytics, AnalyticsConfigurationVersion, AuditLog
from app.models.enums import AuditAction, RoleName
from app.tests.conftest import requires_db

pytestmark = [pytest.mark.integration, requires_db]

NEW_ANALYTICS = {
    "name": "Mitragynine",
    "code": "mitragynine",
    "description": "LC-MS/MS confirmation assay",
    "analyte_name": "Mitragynine",
}


@pytest.fixture
def analyst(client, login):
    return login(RoleName.ANALYST)[1]


@pytest.fixture
def created(client, analyst):
    response = client.post("/api/analytics", json=NEW_ANALYTICS, headers=analyst)
    assert response.status_code == 201, response.text
    return response.json()


class TestAnalyticsCrud:
    def test_creating_an_analytics_returns_it(self, created) -> None:
        assert created["name"] == "Mitragynine"
        assert created["analyte_name"] == "Mitragynine"
        assert created["is_active"] is True
        assert created["configuration_version"] == 1

    def test_the_code_is_slugged(self, client, analyst) -> None:
        response = client.post(
            "/api/analytics", json={**NEW_ANALYTICS, "code": "Temazepam_2026"}, headers=analyst
        )
        assert response.status_code == 201
        assert response.json()["code"] == "temazepam_2026"

    def test_an_invalid_code_is_refused(self, client, analyst) -> None:
        response = client.post(
            "/api/analytics", json={**NEW_ANALYTICS, "code": "has spaces!"}, headers=analyst
        )
        assert response.status_code == 422

    def test_duplicate_code_is_refused(self, client, analyst, created) -> None:
        response = client.post(
            "/api/analytics", json={**NEW_ANALYTICS, "name": "Other"}, headers=analyst
        )
        assert response.status_code == 409

    def test_duplicate_name_is_refused_regardless_of_case(
        self, client, analyst, created
    ) -> None:
        response = client.post(
            "/api/analytics",
            json={**NEW_ANALYTICS, "code": "other", "name": "MITRAGYNINE"},
            headers=analyst,
        )
        assert response.status_code == 409

    def test_analytics_can_be_updated(self, client, analyst, created) -> None:
        response = client.put(
            f"/api/analytics/{created['id']}",
            json={"description": "Updated", "is_active": False},
            headers=analyst,
        )
        assert response.status_code == 200
        assert response.json()["description"] == "Updated"
        assert response.json()["is_active"] is False

    def test_listing_shows_zero_counts_not_invented_ones(self, client, analyst, created) -> None:
        # Spec section 27: a fresh analytics has no files and no sessions, and the
        # list must say exactly that.
        body = client.get("/api/analytics", headers=analyst).json()
        assert body["total"] == 1
        item = body["items"][0]
        assert item["file_count"] == 0
        assert item["session_count"] == 0
        assert item["last_uploaded_at"] is None
        assert item["last_session_state"] is None

    def test_unknown_analytics_is_not_found(self, client, analyst) -> None:
        response = client.get(
            "/api/analytics/00000000-0000-0000-0000-000000000000", headers=analyst
        )
        assert response.status_code == 404

    def test_creation_is_audited(self, client, analyst, created, db) -> None:
        actions = set(db.scalars(select(AuditLog.action)))
        assert AuditAction.ANALYTICS_CREATED.value in actions
        assert AuditAction.CONFIG_CREATED.value in actions

    def test_a_viewer_cannot_create_analytics(self, client, login) -> None:
        _, headers = login(RoleName.VIEWER, email="viewer@lisa.local")
        response = client.post("/api/analytics", json=NEW_ANALYTICS, headers=headers)
        assert response.status_code == 403

    def test_a_failed_creation_leaves_nothing_behind(self, client, analyst, created, db) -> None:
        """The analytics and its configuration are created together or not at all —
        an analytics with no configuration could never be processed."""
        before = db.scalar(select(func.count()).select_from(Analytics))
        client.post("/api/analytics", json={**NEW_ANALYTICS, "name": "Other"}, headers=analyst)
        assert db.scalar(select(func.count()).select_from(Analytics)) == before


class TestInitialConfiguration:
    def test_version_one_is_complete(self, client, analyst, created) -> None:
        body = client.get(
            f"/api/analytics/{created['id']}/configuration", headers=analyst
        ).json()
        assert body["version"] == 1
        payload = body["payload"]
        for key in (
            "calibration",
            "controls",
            "value_tokens",
            "classification",
            "column_role_patterns",
            "analyte_scope_policy",
            "rules",
            "corrections",
            "output",
            "limits",
        ):
            assert key in payload
        assert len(payload["rules"]) == 7

    def test_defaults_match_the_decisions_log(self, client, analyst, created) -> None:
        payload = client.get(
            f"/api/analytics/{created['id']}/configuration", headers=analyst
        ).json()["payload"]
        rules = {r["rule_key"]: r["parameters"] for r in payload["rules"]}

        assert rules["calibration_accuracy"]["tolerance_percent"] == 25   # D-03
        assert rules["control_accuracy"]["tolerance_percent"] == 25       # D-04
        assert rules["ion_ratio"]["formula"] == "SPAN"                    # D-01
        assert rules["ion_ratio"]["adjustment_percent"] == 10             # D-02
        assert rules["ion_ratio"]["zero_ratio_policy"] == "EXCLUDE_FROM_RANGE"  # D-07
        assert rules["retention_time"]["adjustment_percent"] == 20        # D-06
        assert rules["concentration_cutoff"]["source_sample_id"] == "WCS1"  # D-10
        assert payload["calibration"]["required_calibrators"] == [f"Cal_{n}" for n in range(1, 8)]
        assert payload["controls"]["required_controls"] == ["WCS1", "WCS2", "WCS3"]

    def test_the_rule_catalogue_is_served_with_bounds(self, client, analyst) -> None:
        catalogue = {r["rule_key"]: r for r in client.get(
            "/api/rule-definitions", headers=analyst
        ).json()}
        assert len(catalogue) == 7
        spec = catalogue["ion_ratio"]["parameter_schema"]["adjustment_percent"]
        # The UI renders bounds from here, so a threshold cannot be valid in one
        # place and invalid in another.
        assert spec["minimum"] == 0
        assert spec["maximum"] == 100
        assert spec["unit"] == "%"
        assert catalogue["ion_ratio"]["parameter_schema"]["formula"]["choices"] == [
            "SPAN",
            "MULTIPLICATIVE",
        ]


class TestConfigurationVersioning:
    def _payload(self, client, headers, analytics_id: str) -> dict:
        return client.get(
            f"/api/analytics/{analytics_id}/configuration", headers=headers
        ).json()["payload"]

    def _save(self, client, headers, analytics_id: str, payload: dict, note: str = "edit"):
        return client.post(
            f"/api/analytics/{analytics_id}/configuration",
            json={"payload": payload, "change_note": note},
            headers=headers,
        )

    def test_an_edit_creates_a_new_version(self, client, analyst, created) -> None:
        payload = self._payload(client, analyst, created["id"])
        for rule in payload["rules"]:
            if rule["rule_key"] == "calibration_accuracy":
                rule["parameters"]["tolerance_percent"] = 30

        response = self._save(client, analyst, created["id"], payload, "Widen to 30%")
        assert response.status_code == 201
        assert response.json()["version"] == 2

    def test_version_one_is_byte_identical_after_an_edit(
        self, client, analyst, created, db
    ) -> None:
        """AD-1: the append-only history is the mechanism behind spec section 35.
        If version 1 could move, no historical result would be reproducible."""
        original = copy.deepcopy(
            db.scalar(
                select(AnalyticsConfigurationVersion.payload).where(
                    AnalyticsConfigurationVersion.version == 1
                )
            )
        )

        payload = self._payload(client, analyst, created["id"])
        payload["calibration"]["minimum_required"] = 6
        self._save(client, analyst, created["id"], payload)

        after = db.scalar(
            select(AnalyticsConfigurationVersion.payload).where(
                AnalyticsConfigurationVersion.version == 1
            )
        )
        assert after == original

    def test_the_active_version_moves_to_the_newest(self, client, analyst, created) -> None:
        payload = self._payload(client, analyst, created["id"])
        payload["analyte_scope_policy"] = "ALL"
        self._save(client, analyst, created["id"], payload)

        active = client.get(
            f"/api/analytics/{created['id']}/configuration", headers=analyst
        ).json()
        assert active["version"] == 2
        assert active["payload"]["analyte_scope_policy"] == "ALL"

    def test_a_historical_version_is_still_readable(self, client, analyst, created) -> None:
        payload = self._payload(client, analyst, created["id"])
        payload["analyte_scope_policy"] = "ALL"
        self._save(client, analyst, created["id"], payload)

        v1 = client.get(
            f"/api/analytics/{created['id']}/configuration/versions/1", headers=analyst
        ).json()
        assert v1["payload"]["analyte_scope_policy"] == "STRICT"

    def test_the_diff_names_exactly_what_changed(self, client, analyst, created) -> None:
        payload = self._payload(client, analyst, created["id"])
        for rule in payload["rules"]:
            if rule["rule_key"] == "retention_time":
                rule["parameters"]["adjustment_percent"] = 5

        diff = self._save(client, analyst, created["id"], payload).json()["diff"]
        assert len(diff) == 1
        entry = diff[0]
        assert entry["path"] == "rules[retention_time].parameters.adjustment_percent"
        assert entry["from_value"] == 20
        assert entry["to_value"] == 5
        assert entry["change"] == "changed"

    def test_reordering_rules_is_not_reported_as_a_rewrite(
        self, client, analyst, created
    ) -> None:
        # Rule lists are keyed collections. Diffing them by index would report a
        # reorder as if every threshold had changed.
        payload = self._payload(client, analyst, created["id"])
        payload["rules"] = list(reversed(payload["rules"]))
        diff = self._save(client, analyst, created["id"], payload).json()["diff"]
        assert diff == []

    def test_saving_reports_that_no_session_is_affected(self, client, analyst, created) -> None:
        payload = self._payload(client, analyst, created["id"])
        payload["limits"]["max_upload_bytes"] = 52_428_800
        assert self._save(client, analyst, created["id"], payload).json()["affected_sessions"] == 0

    def test_version_history_marks_the_active_one(self, client, analyst, created) -> None:
        payload = self._payload(client, analyst, created["id"])
        payload["limits"]["max_upload_bytes"] = 52_428_800
        self._save(client, analyst, created["id"], payload, "Halve the upload limit")

        versions = client.get(
            f"/api/analytics/{created['id']}/configuration/versions", headers=analyst
        ).json()
        assert [v["version"] for v in versions] == [2, 1]
        assert versions[0]["is_active"] is True
        assert versions[1]["is_active"] is False
        assert versions[0]["change_note"] == "Halve the upload limit"

    def test_the_change_is_audited_with_the_diff(self, client, analyst, created, db) -> None:
        payload = self._payload(client, analyst, created["id"])
        payload["controls"]["minimum_required"] = 2
        self._save(client, analyst, created["id"], payload)

        entry = db.scalar(
            select(AuditLog).where(AuditLog.action == AuditAction.CONFIG_CHANGED.value)
        )
        assert entry is not None
        assert entry.old_value == {"version": 1}
        assert entry.new_value == {"version": 2}
        assert entry.audit_metadata["changes"]

    def test_an_analyst_may_configure_but_a_viewer_may_not(
        self, client, login, created, analyst
    ) -> None:
        payload = self._payload(client, analyst, created["id"])
        _, viewer = login(RoleName.VIEWER, email="viewer@lisa.local")
        assert self._save(client, viewer, created["id"], payload).status_code == 403
