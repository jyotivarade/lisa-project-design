"""The rule catalogue and the default configuration payload.

This module is the ONLY place default business values are written down, and they are
*seed* values: once an Analytics exists, its configuration lives in the database and
changing a default here has no effect on it. Nothing in the criteria engine, the API
or the frontend reads these constants at runtime (AD-2 / §43).

Every value traces to a decision in DECISIONS.md. Items still marked OPEN there
(D-05, D-12, D-13, D-14, D-15) use the recommended default from that document's §S.
"""

from typing import Any

from app.models.enums import SampleStream

# --------------------------------------------------------------------------------
# Rule catalogue — seeded into `rule_definitions`, rendered by the Configuration UI.
# --------------------------------------------------------------------------------


def _number(
    *, default: float, minimum: float, maximum: float, unit: str, label: str, help_: str
) -> dict[str, Any]:
    return {
        "type": "number",
        "label": label,
        "unit": unit,
        "default": default,
        "minimum": minimum,
        "maximum": maximum,
        "help": help_,
    }


def _choice(*, default: str, choices: list[str], label: str, help_: str) -> dict[str, Any]:
    return {
        "type": "choice",
        "label": label,
        "default": default,
        "choices": choices,
        "help": help_,
    }


def _bool(*, default: bool, label: str, help_: str) -> dict[str, Any]:
    return {"type": "boolean", "label": label, "default": default, "help": help_}


RULE_CATALOG: list[dict[str, Any]] = [
    {
        "rule_key": "calibration_accuracy",
        "name": "Calibrator Accuracy",
        "description": (
            "Flags calibrators whose back-calculated concentration deviates from the "
            "nominal value by more than the configured tolerance."
        ),
        "stream": SampleStream.CALIBRATOR.value,
        "default_enabled": True,
        "default_mandatory": True,
        "default_priority": 10,
        "error_codes": ["CALIBRATION_TOLERANCE_EXCEEDED"],
        "parameter_schema": {
            "tolerance_percent": _number(
                default=25, minimum=0, maximum=100, unit="%", label="Calibration tolerance",
                help_="ABS(% Diff) above this fails the calibrator. D-03.",
            ),
            "tolerance_operator": _choice(
                default="lte", choices=["lte", "lt"], label="Comparison",
                help_="lte: exactly at the tolerance passes. lt: it fails.",
            ),
        },
    },
    {
        "rule_key": "control_accuracy",
        "name": "Control Accuracy",
        "description": (
            "Flags controls whose recovery deviates from the assigned value by more "
            "than the configured tolerance."
        ),
        "stream": SampleStream.CONTROL.value,
        "default_enabled": True,
        "default_mandatory": True,
        "default_priority": 20,
        "error_codes": ["CONTROL_TOLERANCE_EXCEEDED"],
        "parameter_schema": {
            "tolerance_percent": _number(
                default=25, minimum=0, maximum=100, unit="%", label="Control tolerance",
                help_="ABS(% Diff) above this fails the control. D-04.",
            ),
            "tolerance_operator": _choice(
                default="lte", choices=["lte", "lt"], label="Comparison", help_="",
            ),
        },
    },
    {
        "rule_key": "istd",
        "name": "Internal Standard",
        "description": (
            "Fails patient rows with a missing internal-standard peak, and rows whose "
            "internal standard is suppressed relative to the configured basis."
        ),
        "stream": SampleStream.PATIENT.value,
        "default_enabled": True,
        "default_mandatory": True,
        "default_priority": 30,
        "error_codes": ["ISTD_MISSING", "ISTD_SUPPRESSED"],
        "parameter_schema": {
            "missing_peak_fails": _bool(
                default=True, label="Missing peak fails",
                help_="An ISTD Area of '----' or an absent peak fails the row.",
            ),
            "suppression_enabled": _bool(
                default=True, label="Check suppression", help_="",
            ),
            "suppression_threshold_percent": _number(
                default=90, minimum=0, maximum=200, unit="%", label="Suppression threshold",
                help_="Recovery below this percentage of the basis fails the row. D-05.",
            ),
            "basis_method": _choice(
                default="AUTO",
                choices=[
                    "AUTO",
                    "RECOVERY_COLUMNS",
                    "ISTD_AREA_BATCH_MEAN",
                    "ISTD_AREA_CALIBRATOR_MEAN",
                ],
                label="Suppression basis",
                help_=(
                    "AUTO uses the % Recovery columns when the file has them, otherwise "
                    "the batch mean ISTD area. D-05 is OPEN pending laboratory "
                    "confirmation of the intended basis and direction."
                ),
            ),
        },
    },
    {
        "rule_key": "concentration_cutoff",
        "name": "Concentration Cut-off",
        "description": (
            "Fails patient rows whose concentration is below the assay cut-off. The "
            "original value is preserved; the adjusted value is recorded separately."
        ),
        "stream": SampleStream.PATIENT.value,
        "default_enabled": True,
        "default_mandatory": True,
        "default_priority": 40,
        "error_codes": ["CONCENTRATION_BELOW_CUTOFF"],
        "parameter_schema": {
            "source": _choice(
                default="CONTROL_STD_CONC", choices=["CONTROL_STD_CONC", "FIXED_VALUE"],
                label="Cut-off source",
                help_="Std. Conc. of a named control row, or a fixed configured value. D-10.",
            ),
            "source_sample_id": {
                "type": "string", "label": "Source control Sample ID",
                "default": "WCS1",
                "help": "The control whose Std. Conc. (ng/mL) supplies the cut-off.",
            },
            "fixed_value": _number(
                default=0, minimum=0, maximum=1_000_000, unit="ng/mL",
                label="Fixed cut-off", help_="Used only when source = FIXED_VALUE.",
            ),
            "zero_on_fail": _bool(
                default=True, label="Set concentration to 0 on failure",
                help_="The original value is never lost — it is stored alongside.",
            ),
        },
    },
    {
        "rule_key": "ion_ratio",
        "name": "Ion Ratio",
        "description": (
            "Fails patient rows whose qualifier/quantifier ion ratio falls outside the "
            "range established by the selected valid calibrators."
        ),
        "stream": SampleStream.PATIENT.value,
        "default_enabled": True,
        "default_mandatory": True,
        "default_priority": 50,
        "error_codes": ["ION_RATIO_OUT_OF_RANGE"],
        "parameter_schema": {
            "formula": _choice(
                default="SPAN", choices=["SPAN", "MULTIPLICATIVE"], label="Formula",
                help_=(
                    "SPAN: lowest - (range x adj) .. highest + (range x adj). "
                    "MULTIPLICATIVE: lowest x (1-adj) .. highest x (1+adj). D-01."
                ),
            ),
            "adjustment_percent": _number(
                default=10, minimum=0, maximum=100, unit="%", label="Reference ratio adjustment",
                help_="Source material states 10%, 25% and 30% in different places. D-02.",
            ),
            "zero_ratio_policy": _choice(
                default="EXCLUDE_FROM_RANGE",
                choices=["VALID", "INVALID", "EXCLUDE_FROM_RANGE"],
                label="Zero ratio policy",
                help_=(
                    "A calibrator ratio of 0 must not silently become the low bound. D-07."
                ),
            ),
        },
    },
    {
        "rule_key": "retention_time",
        "name": "Retention Time",
        "description": (
            "Fails patient rows whose retention time deviates from the calibrator "
            "average by more than the configured window."
        ),
        "stream": SampleStream.PATIENT.value,
        "default_enabled": True,
        "default_mandatory": True,
        "default_priority": 60,
        "error_codes": ["RT_OUT_OF_RANGE"],
        "parameter_schema": {
            "mode": _choice(
                default="PERCENTAGE", choices=["PERCENTAGE", "ABSOLUTE"], label="Window mode",
                help_="PERCENTAGE: average x (1 +/- adj). ABSOLUTE: average +/- minutes. D-06.",
            ),
            "adjustment_percent": _number(
                default=20, minimum=0, maximum=100, unit="%", label="RT adjustment",
                help_=(
                    "20% of a 4.35 min average is roughly +/- 52 seconds, which is wide "
                    "for LC-MS/MS. Implemented as specified; see D-06."
                ),
            ),
            "absolute_window_minutes": _number(
                default=0.1, minimum=0, maximum=60, unit="min", label="Absolute window",
                help_="Used only when mode = ABSOLUTE.",
            ),
            "average_method": _choice(
                default="MEAN", choices=["MEAN", "MEDIAN"], label="Average method", help_="",
            ),
        },
    },
    {
        "rule_key": "calibration_range",
        "name": "Calibration Range",
        "description": (
            "Fails patient results outside the calibrated measuring range, including "
            "instrument N.I. High / N.I. Low reports."
        ),
        "stream": SampleStream.PATIENT.value,
        "default_enabled": True,
        "default_mandatory": True,
        "default_priority": 70,
        "error_codes": ["OVER_CALIBRATION_RANGE", "UNDER_CALIBRATION_RANGE"],
        "parameter_schema": {
            "over_range_action": _choice(
                default="FAIL", choices=["FAIL", "FLAG_ONLY"], label="Over-range action",
                help_="N.I. High / above the top calibrator. Specification section 12.",
            ),
            "under_range_action": _choice(
                default="FAIL", choices=["FAIL", "FLAG_ONLY"], label="Under-range action",
                help_="N.I. Low / below the lowest calibrator. D-12 is OPEN; FAIL is the "
                      "recommended default and is symmetrical with over-range.",
            ),
        },
    },
]


# --------------------------------------------------------------------------------
# Default configuration payload — copied into version 1 when an Analytics is created
# (Phase 3). Shape is documented in docs/01-DATA-MODEL.md §2.
# --------------------------------------------------------------------------------

CONFIG_SCHEMA_VERSION = 1

DEFAULT_CLASSIFICATION_RULES: list[dict[str, Any]] = [
    # First match wins. Sample Type AND Sample ID — never ID alone (spec section 5).
    {
        "priority": 10, "stream": SampleStream.OTHER.value, "match_mode": "id_only",
        "sample_id_pattern": r"^(BLANK|Double Blank|DBLK)$", "sample_type_pattern": ".*",
        "label": "Blank / double blank — never a patient row",
    },
    {
        "priority": 20, "stream": SampleStream.CALIBRATOR.value, "match_mode": "both",
        "sample_id_pattern": r"^Cal_\d+$", "sample_type_pattern": r"^Standard$",
        "label": "Calibrator",
    },
    {
        "priority": 30, "stream": SampleStream.CONTROL.value, "match_mode": "both",
        "sample_id_pattern": r"^(WCS|WSC)\d+$", "sample_type_pattern": r"^Control$",
        "label": "Quality control",
    },
    {
        "priority": 40, "stream": SampleStream.CONTROL.value, "match_mode": "both",
        "sample_id_pattern": r"^UC$", "sample_type_pattern": r"^Control$",
        "label": "Discovered control — listed, not required (D-09)",
    },
    {
        "priority": 50, "stream": SampleStream.PATIENT.value, "match_mode": "both",
        "sample_id_pattern": r"^\d+$", "sample_type_pattern": r"^Unknown$",
        "label": "Patient / unknown sample",
    },
    {
        "priority": 99, "stream": SampleStream.OTHER.value, "match_mode": "both",
        "sample_id_pattern": ".*", "sample_type_pattern": ".*",
        "label": "Unclassified",
    },
]

# Column ROLES, matched against whatever headers the file actually has. The real
# instrument writes "%Diff" where the specification writes "% Diff", so matching is
# by pattern and is user-overridable — never literal header equality (D-12 note in
# docs/00). `null` means "not present in this layout": dependent rules then report
# NOT_EVALUATED rather than passing.
DEFAULT_COLUMN_ROLE_PATTERNS: dict[str, list[str]] = {
    "analyte_name": [r"^analyte\s*name$", r"^analyte$"],
    "sample_id": [r"^sample\s*id$", r"^sample\s*name$"],
    "sample_type": [r"^sample\s*type$", r"^type$"],
    "percent_diff": [r"^%\s*diff$", r"percent.*diff"],
    "istd_area": [r"^istd\s*area$", r"internal\s*standard.*area"],
    "recovery": [r"^%?\s*recovery$"],
    "avg_recovery": [r"average.*recovery", r"avg.*recovery", r"mean.*recovery"],
    "concentration": [r"^conc\.?\s*\(", r"^concentration"],
    "std_concentration": [r"^std\.?\s*conc", r"^standard\s*conc", r"nominal"],
    "ion_ratio": [r"ref\s*1\s*actual\s*ratio", r"actual\s*ratio", r"ion\s*ratio"],
    "retention_time": [r"^found\s*rt$", r"retention\s*time"],
    "level": [r"^level$"],
    "area": [r"^area$"],
}


def default_rule_settings() -> list[dict[str, Any]]:
    """Per-rule enable/mandatory/priority plus each rule's parameter defaults."""
    settings = []
    for rule in RULE_CATALOG:
        params = {
            key: spec["default"] for key, spec in rule["parameter_schema"].items()
        }
        settings.append(
            {
                "rule_key": rule["rule_key"],
                "enabled": rule["default_enabled"],
                "mandatory": rule["default_mandatory"],
                "priority": rule["default_priority"],
                "parameters": params,
            }
        )
    return settings


def default_configuration_payload() -> dict[str, Any]:
    """Configuration version 1 for a newly created Analytics."""
    return {
        "schema_version": CONFIG_SCHEMA_VERSION,
        "calibration": {
            "enabled": True,
            "sample_type": "Standard",
            "required_calibrators": [f"Cal_{n}" for n in range(1, 8)],
            "minimum_required": 7,
        },
        "controls": {
            "enabled": True,
            "sample_type": "Control",
            "required_controls": ["WCS1", "WCS2", "WCS3"],
            "discovered_optional": ["UC"],
            "minimum_required": 3,
        },
        "value_tokens": {
            # "----" is MISSING, never numeric zero (spec section 28).
            "missing": ["----", "", "N/A", "NA"],
            "over_range": ["N.I. High", "N.I.(High)", "N.I. (High)"],
            "under_range": ["N.I. Low", "N.I.(Low)", "N.I. (Low)"],
        },
        "classification": DEFAULT_CLASSIFICATION_RULES,
        "column_role_patterns": DEFAULT_COLUMN_ROLE_PATTERNS,
        "column_mappings": {},  # resolved per file at parse time, overridable
        # D-13 (OPEN): a session evaluates only rows whose Analyte Name matches this
        # Analytics. Other analytes are counted and listed, never processed.
        "analyte_scope_policy": "STRICT",
        "rules": default_rule_settings(),
        # D-14 (OPEN): patient values are NOT correctable by default. Correcting a
        # patient measurement would let a user manufacture a passing run; correcting a
        # calibrator or control is a documented laboratory action.
        "corrections": {
            "enabled": True,
            "allowed_streams": [SampleStream.CALIBRATOR.value, SampleStream.CONTROL.value],
            "allowed_roles": [
                "percent_diff",
                "ion_ratio",
                "retention_time",
                "std_concentration",
                "concentration",
                "istd_area",
            ],
            "reason_required": True,
        },
        "output": {
            "passed_includes_warnings": False,
            "exception_includes_original_row": True,
        },
        "limits": {"max_upload_bytes": 104_857_600},
    }
