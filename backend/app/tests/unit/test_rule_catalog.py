"""The rule catalogue is the only place default business values are written down.

These tests assert the catalogue matches DECISIONS.md, so a default cannot drift
away from the decision that authorised it without a test failing.
"""

from app.core.rule_catalog import (
    RULE_CATALOG,
    default_configuration_payload,
    default_rule_settings,
)
from app.models.enums import SampleStream


def _rule(key: str) -> dict:
    return next(r for r in RULE_CATALOG if r["rule_key"] == key)


def _default(key: str, param: str):
    return _rule(key)["parameter_schema"][param]["default"]


def test_every_rule_has_a_unique_key_and_priority() -> None:
    keys = [r["rule_key"] for r in RULE_CATALOG]
    priorities = [r["default_priority"] for r in RULE_CATALOG]
    assert len(keys) == len(set(keys))
    assert len(priorities) == len(set(priorities))


def test_the_seven_specified_rules_are_present() -> None:
    assert {r["rule_key"] for r in RULE_CATALOG} == {
        "calibration_accuracy",
        "control_accuracy",
        "istd",
        "concentration_cutoff",
        "ion_ratio",
        "retention_time",
        "calibration_range",
    }


def test_defaults_match_decisions_log() -> None:
    assert _default("calibration_accuracy", "tolerance_percent") == 25   # D-03
    assert _default("control_accuracy", "tolerance_percent") == 25       # D-04
    assert _default("ion_ratio", "formula") == "SPAN"                    # D-01
    assert _default("ion_ratio", "adjustment_percent") == 10             # D-02
    assert _default("ion_ratio", "zero_ratio_policy") == "EXCLUDE_FROM_RANGE"  # D-07
    assert _default("retention_time", "mode") == "PERCENTAGE"            # D-06
    assert _default("retention_time", "adjustment_percent") == 20        # D-06
    assert _default("istd", "suppression_threshold_percent") == 90       # D-05
    assert _default("istd", "basis_method") == "AUTO"                    # D-05
    assert _default("concentration_cutoff", "source_sample_id") == "WCS1"  # D-10
    assert _default("calibration_range", "under_range_action") == "FAIL"  # D-12


def test_multiplicative_ion_ratio_formula_remains_available() -> None:
    # The existing prototype computes the range this way; D-01 keeps it selectable
    # rather than discarding a reading the laboratory may have validated against.
    assert "MULTIPLICATIVE" in _rule("ion_ratio")["parameter_schema"]["formula"]["choices"]


def test_numeric_parameters_declare_bounds() -> None:
    # The Configuration UI, the client-side schema and the server-side validator all
    # read these bounds, so a threshold cannot be accepted on one side and rejected
    # on the other.
    for rule in RULE_CATALOG:
        for name, spec in rule["parameter_schema"].items():
            if spec["type"] == "number":
                assert "minimum" in spec and "maximum" in spec, (rule["rule_key"], name)
                assert spec["minimum"] <= spec["default"] <= spec["maximum"]


def test_default_configuration_is_complete() -> None:
    payload = default_configuration_payload()
    for key in (
        "schema_version",
        "calibration",
        "controls",
        "value_tokens",
        "classification",
        "column_role_patterns",
        "analyte_scope_policy",
        "rules",
        "corrections",
        "output",
    ):
        assert key in payload

    assert payload["calibration"]["required_calibrators"] == [f"Cal_{n}" for n in range(1, 8)]
    assert payload["calibration"]["minimum_required"] == 7          # D-08
    assert payload["controls"]["required_controls"] == ["WCS1", "WCS2", "WCS3"]
    assert payload["analyte_scope_policy"] == "STRICT"              # D-13
    assert len(payload["rules"]) == len(RULE_CATALOG)


def test_missing_token_list_treats_the_instrument_dash_as_missing() -> None:
    # "----" must never be read as numeric zero (spec section 28).
    tokens = default_configuration_payload()["value_tokens"]
    assert "----" in tokens["missing"]
    assert "0" not in tokens["missing"]
    assert any("High" in t for t in tokens["over_range"])
    assert any("Low" in t for t in tokens["under_range"])


def test_patient_values_are_not_correctable_by_default() -> None:
    # D-14: correcting a patient measurement would let a user manufacture a passing
    # run. Only calibrator and control rows may be corrected out of the box.
    corrections = default_configuration_payload()["corrections"]
    assert corrections["reason_required"] is True
    assert SampleStream.PATIENT.value not in corrections["allowed_streams"]
    assert set(corrections["allowed_streams"]) == {
        SampleStream.CALIBRATOR.value,
        SampleStream.CONTROL.value,
    }


def test_classification_never_identifies_a_patient_by_sample_id_alone() -> None:
    # Spec section 5: Sample Type AND Sample ID. A numeric ID with the wrong sample
    # type must not become a patient row.
    rules = default_configuration_payload()["classification"]
    patient = [r for r in rules if r["stream"] == SampleStream.PATIENT.value]
    assert patient, "no patient classification rule"
    for rule in patient:
        assert rule["match_mode"] == "both"
        assert rule["sample_type_pattern"] not in (".*", "")


def test_blank_rows_are_classified_before_patients() -> None:
    rules = default_configuration_payload()["classification"]
    blank = next(r for r in rules if "BLANK" in r["sample_id_pattern"])
    patient = next(r for r in rules if r["stream"] == SampleStream.PATIENT.value)
    assert blank["priority"] < patient["priority"]
    assert blank["stream"] != SampleStream.PATIENT.value


def test_rule_settings_carry_every_parameter_default() -> None:
    for setting in default_rule_settings():
        schema = _rule(setting["rule_key"])["parameter_schema"]
        assert set(setting["parameters"]) == set(schema)
