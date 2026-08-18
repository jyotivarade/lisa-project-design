"""Configuration validation (spec section 39).

Every case here would produce an unrunnable or silently wrong analysis if it were
allowed through, so each is refused at the write and again before processing.
"""

import copy

import pytest

from app.core.rule_catalog import default_configuration_payload
from app.models.enums import RoleName
from app.schemas.configuration import ConfigurationPayload
from app.services.configuration_validator import (
    ConfigurationInvalid,
    require_valid,
    validate_payload,
)
from app.tests.conftest import requires_db

pytestmark = [pytest.mark.integration, requires_db]


def payload() -> dict:
    return copy.deepcopy(default_configuration_payload())


def rule(config: dict, key: str) -> dict:
    return next(r for r in config["rules"] if r["rule_key"] == key)


def fields(problems: list[dict]) -> set[str]:
    return {p["field"] for p in problems}


class TestValidPayload:
    def test_the_seeded_default_is_valid(self, seeded) -> None:
        assert validate_payload(seeded, ConfigurationPayload.model_validate(payload())) == []

    def test_require_valid_raises_with_details(self, seeded) -> None:
        config = payload()
        rule(config, "ion_ratio")["parameters"]["adjustment_percent"] = -5
        with pytest.raises(ConfigurationInvalid) as excinfo:
            require_valid(seeded, ConfigurationPayload.model_validate(config))
        assert excinfo.value.error_code == "INVALID_CONFIGURATION"
        assert excinfo.value.status_code == 422
        assert excinfo.value.details


class TestNumericBounds:
    @pytest.mark.parametrize(
        ("rule_key", "parameter", "value"),
        [
            ("ion_ratio", "adjustment_percent", -1),          # spec section 39
            ("retention_time", "adjustment_percent", -0.1),
            ("calibration_accuracy", "tolerance_percent", -25),
            ("control_accuracy", "tolerance_percent", 101),
            ("istd", "suppression_threshold_percent", -10),
        ],
    )
    def test_out_of_range_values_are_refused(
        self, seeded, rule_key: str, parameter: str, value: float
    ) -> None:
        config = payload()
        rule(config, rule_key)["parameters"][parameter] = value
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert f"rules.{rule_key}.parameters.{parameter}" in fields(problems)

    def test_bounds_come_from_the_catalogue_not_from_code(self, seeded, db) -> None:
        """Widening the catalogue widens what the validator accepts. If the bound
        were duplicated in Python, the two would drift."""
        from sqlalchemy import select

        from app.models import RuleDefinition

        config = payload()
        rule(config, "ion_ratio")["parameters"]["adjustment_percent"] = 150
        assert validate_payload(seeded, ConfigurationPayload.model_validate(config))

        definition = db.scalar(
            select(RuleDefinition).where(RuleDefinition.rule_key == "ion_ratio")
        )
        schema = copy.deepcopy(definition.parameter_schema)
        schema["adjustment_percent"]["maximum"] = 200
        definition.parameter_schema = schema
        db.flush()

        assert validate_payload(seeded, ConfigurationPayload.model_validate(config)) == []

    def test_a_non_numeric_threshold_is_refused(self, seeded) -> None:
        config = payload()
        rule(config, "calibration_accuracy")["parameters"]["tolerance_percent"] = True
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.calibration_accuracy.parameters.tolerance_percent" in fields(problems)


class TestChoicesAndParameters:
    def test_an_unknown_choice_is_refused(self, seeded) -> None:
        config = payload()
        rule(config, "ion_ratio")["parameters"]["formula"] = "GEOMETRIC"
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.ion_ratio.parameters.formula" in fields(problems)

    def test_an_unknown_parameter_is_refused(self, seeded) -> None:
        # Silently ignoring it would let an operator believe they had configured
        # something that has no effect at all.
        config = payload()
        rule(config, "ion_ratio")["parameters"]["fudge_factor"] = 1
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.ion_ratio.parameters.fudge_factor" in fields(problems)

    def test_a_missing_parameter_is_refused(self, seeded) -> None:
        config = payload()
        del rule(config, "ion_ratio")["parameters"]["zero_ratio_policy"]
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.ion_ratio.parameters.zero_ratio_policy" in fields(problems)

    def test_an_unknown_rule_is_refused(self, seeded) -> None:
        config = payload()
        config["rules"].append(
            {"rule_key": "invented", "enabled": True, "mandatory": True, "priority": 99,
             "parameters": {}}
        )
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.invented" in fields(problems)

    def test_a_missing_rule_is_refused(self, seeded) -> None:
        config = payload()
        config["rules"] = [r for r in config["rules"] if r["rule_key"] != "ion_ratio"]
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.ion_ratio" in fields(problems)

    def test_duplicate_priorities_are_refused(self, seeded) -> None:
        # Execution order must be unambiguous; two rules sharing a priority would
        # run in whatever order the database happened to return.
        config = payload()
        rule(config, "ion_ratio")["priority"] = rule(config, "retention_time")["priority"]
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert any("priority" in f for f in fields(problems))


class TestCalibrationAndControls:
    def test_requiring_more_calibrators_than_exist_is_refused(self, seeded) -> None:
        config = payload()
        config["calibration"]["minimum_required"] = 9
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "calibration.minimum_required" in fields(problems)

    def test_requiring_zero_calibrators_is_refused_when_enabled(self, seeded) -> None:
        config = payload()
        config["calibration"]["minimum_required"] = 0
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "calibration.minimum_required" in fields(problems)

    def test_duplicate_calibrator_ids_are_refused(self, seeded) -> None:
        config = payload()
        config["calibration"]["required_calibrators"] = ["Cal_1", "Cal_1", "Cal_2"]
        config["calibration"]["minimum_required"] = 2
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "calibration.required_calibrators" in fields(problems)

    def test_requiring_more_controls_than_exist_is_refused(self, seeded) -> None:
        config = payload()
        config["controls"]["minimum_required"] = 5
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "controls.minimum_required" in fields(problems)

    def test_a_control_cannot_be_both_required_and_optional(self, seeded) -> None:
        config = payload()
        config["controls"]["discovered_optional"] = ["UC", "WCS1"]
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "controls.discovered_optional" in fields(problems)

    def test_disabling_calibration_relaxes_its_checks(self, seeded) -> None:
        config = payload()
        config["calibration"]["enabled"] = False
        config["calibration"]["minimum_required"] = 0
        config["calibration"]["required_calibrators"] = []
        assert validate_payload(seeded, ConfigurationPayload.model_validate(config)) == []


class TestCutOffSource:
    def test_a_cutoff_source_that_is_not_a_control_is_refused(self, seeded) -> None:
        """WCS1 supplies the cut-off from its Std. Conc. Naming a control that is not
        in the run means no cut-off could ever be derived."""
        config = payload()
        rule(config, "concentration_cutoff")["parameters"]["source_sample_id"] = "WCS9"
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.concentration_cutoff.parameters.source_sample_id" in fields(problems)

    def test_an_optional_control_may_supply_the_cutoff(self, seeded) -> None:
        config = payload()
        rule(config, "concentration_cutoff")["parameters"]["source_sample_id"] = "UC"
        assert validate_payload(seeded, ConfigurationPayload.model_validate(config)) == []

    def test_a_fixed_cutoff_must_be_positive(self, seeded) -> None:
        config = payload()
        params = rule(config, "concentration_cutoff")["parameters"]
        params["source"] = "FIXED_VALUE"
        params["fixed_value"] = 0
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.concentration_cutoff.parameters.fixed_value" in fields(problems)

    def test_a_valid_fixed_cutoff_is_accepted(self, seeded) -> None:
        config = payload()
        params = rule(config, "concentration_cutoff")["parameters"]
        params["source"] = "FIXED_VALUE"
        params["fixed_value"] = 1.5
        assert validate_payload(seeded, ConfigurationPayload.model_validate(config)) == []


class TestRetentionTimeMode:
    def test_absolute_mode_needs_a_window(self, seeded) -> None:
        config = payload()
        params = rule(config, "retention_time")["parameters"]
        params["mode"] = "ABSOLUTE"
        params["absolute_window_minutes"] = 0
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "rules.retention_time.parameters.absolute_window_minutes" in fields(problems)

    def test_absolute_mode_with_a_window_is_accepted(self, seeded) -> None:
        config = payload()
        params = rule(config, "retention_time")["parameters"]
        params["mode"] = "ABSOLUTE"
        params["absolute_window_minutes"] = 0.1
        assert validate_payload(seeded, ConfigurationPayload.model_validate(config)) == []


class TestPatterns:
    def test_an_invalid_classification_regex_is_refused(self, seeded) -> None:
        config = payload()
        config["classification"][0]["sample_id_pattern"] = "^(unclosed"
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert any("classification[0]" in f for f in fields(problems))

    def test_an_invalid_column_pattern_is_refused(self, seeded) -> None:
        config = payload()
        config["column_role_patterns"]["percent_diff"] = ["[a-"]
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "column_role_patterns.percent_diff[0]" in fields(problems)

    def test_duplicate_classification_priorities_are_refused(self, seeded) -> None:
        config = payload()
        config["classification"][1]["priority"] = config["classification"][0]["priority"]
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert any("classification[1].priority" in f for f in fields(problems))

    def test_an_empty_classification_set_is_refused(self, seeded) -> None:
        config = payload()
        config["classification"] = []
        problems = validate_payload(seeded, ConfigurationPayload.model_validate(config))
        assert "classification" in fields(problems)


class TestThroughTheApi:
    def _headers(self, login):
        return login(RoleName.ANALYST)[1]

    def test_an_invalid_configuration_is_refused_with_field_detail(
        self, client, login
    ) -> None:
        headers = self._headers(login)
        analytics = client.post(
            "/api/analytics",
            json={"name": "Temazepam", "code": "temazepam", "analyte_name": "Temazepam"},
            headers=headers,
        ).json()

        config = client.get(
            f"/api/analytics/{analytics['id']}/configuration", headers=headers
        ).json()["payload"]
        rule(config, "ion_ratio")["parameters"]["adjustment_percent"] = -10

        response = client.post(
            f"/api/analytics/{analytics['id']}/configuration",
            json={"payload": config},
            headers=headers,
        )
        assert response.status_code == 422
        body = response.json()
        assert body["error_code"] == "INVALID_CONFIGURATION"
        assert any(
            d["field"] == "rules.ion_ratio.parameters.adjustment_percent"
            for d in body["details"]
        )

    def test_a_refused_configuration_creates_no_version(self, client, login, db) -> None:
        from sqlalchemy import func, select

        from app.models import AnalyticsConfigurationVersion

        headers = self._headers(login)
        analytics = client.post(
            "/api/analytics",
            json={"name": "Temazepam", "code": "temazepam", "analyte_name": "Temazepam"},
            headers=headers,
        ).json()
        before = db.scalar(select(func.count()).select_from(AnalyticsConfigurationVersion))

        config = client.get(
            f"/api/analytics/{analytics['id']}/configuration", headers=headers
        ).json()["payload"]
        config["calibration"]["minimum_required"] = 99
        client.post(
            f"/api/analytics/{analytics['id']}/configuration",
            json={"payload": config},
            headers=headers,
        )

        assert db.scalar(select(func.count()).select_from(AnalyticsConfigurationVersion)) == before

    def test_an_unknown_top_level_key_is_refused(self, client, login) -> None:
        headers = self._headers(login)
        analytics = client.post(
            "/api/analytics",
            json={"name": "Temazepam", "code": "temazepam", "analyte_name": "Temazepam"},
            headers=headers,
        ).json()
        config = client.get(
            f"/api/analytics/{analytics['id']}/configuration", headers=headers
        ).json()["payload"]
        config["surprise"] = True

        response = client.post(
            f"/api/analytics/{analytics['id']}/configuration",
            json={"payload": config},
            headers=headers,
        )
        assert response.status_code == 422
