"""Configuration validation (spec section 39).

Runs on every configuration write **and again before processing starts**. The
numeric bounds are not written here: they come from `rule_definitions.parameter_schema`
in the database, so the same definition drives the Configuration UI, the client-side
form and this validator. A threshold cannot be acceptable on one side of the wire
and rejected on the other.
"""

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ErrorCode, LisaError
from app.models import RuleDefinition
from app.schemas.configuration import ConfigurationPayload


class ConfigurationInvalid(LisaError):
    status_code = 422
    error_code = ErrorCode.INVALID_CONFIGURATION


Problem = dict[str, Any]


def _check_parameters(
    rule_key: str, parameters: dict[str, Any], schema: dict[str, Any]
) -> list[Problem]:
    problems: list[Problem] = []
    prefix = f"rules.{rule_key}.parameters"

    unknown = set(parameters) - set(schema)
    for name in sorted(unknown):
        problems.append(
            {"field": f"{prefix}.{name}", "issue": "Not a parameter of this rule."}
        )
    missing = set(schema) - set(parameters)
    for name in sorted(missing):
        problems.append({"field": f"{prefix}.{name}", "issue": "Required parameter is missing."})

    for name, spec in schema.items():
        if name not in parameters:
            continue
        value = parameters[name]
        field = f"{prefix}.{name}"
        kind = spec.get("type")

        if kind == "number":
            if isinstance(value, bool) or not isinstance(value, int | float):
                problems.append({"field": field, "issue": "Must be a number."})
                continue
            minimum, maximum = spec.get("minimum"), spec.get("maximum")
            if minimum is not None and value < minimum:
                problems.append(
                    {
                        "field": field,
                        "issue": f"Must be at least {minimum}.",
                        "minimum": minimum,
                        "actual": value,
                    }
                )
            if maximum is not None and value > maximum:
                problems.append(
                    {
                        "field": field,
                        "issue": f"Must be at most {maximum}.",
                        "maximum": maximum,
                        "actual": value,
                    }
                )
        elif kind == "choice":
            choices = spec.get("choices") or []
            if value not in choices:
                problems.append(
                    {"field": field, "issue": f"Must be one of: {', '.join(choices)}."}
                )
        elif kind == "boolean" and not isinstance(value, bool):
            problems.append({"field": field, "issue": "Must be true or false."})
        elif kind == "string" and not isinstance(value, str):
            problems.append({"field": field, "issue": "Must be text."})

    return problems


def validate_payload(db: Session, payload: ConfigurationPayload) -> list[Problem]:
    """Return every problem found. Empty means the configuration may be saved."""
    problems: list[Problem] = []
    catalogue = {r.rule_key: r for r in db.scalars(select(RuleDefinition))}

    # --- rules ---------------------------------------------------------------
    seen_keys: set[str] = set()
    priorities: dict[int, str] = {}
    for rule in payload.rules:
        if rule.rule_key in seen_keys:
            problems.append(
                {"field": f"rules.{rule.rule_key}", "issue": "Rule appears more than once."}
            )
            continue
        seen_keys.add(rule.rule_key)

        definition = catalogue.get(rule.rule_key)
        if definition is None:
            problems.append(
                {"field": f"rules.{rule.rule_key}", "issue": "No such rule in the catalogue."}
            )
            continue

        # Execution order must be unambiguous: two rules sharing a priority would
        # run in whatever order the database happened to return them.
        if rule.priority in priorities:
            problems.append(
                {
                    "field": f"rules.{rule.rule_key}.priority",
                    "issue": f"Priority {rule.priority} is already used by "
                    f"{priorities[rule.priority]}.",
                }
            )
        else:
            priorities[rule.priority] = rule.rule_key

        problems.extend(
            _check_parameters(rule.rule_key, rule.parameters, definition.parameter_schema)
        )

    for missing_key in sorted(set(catalogue) - seen_keys):
        problems.append(
            {"field": f"rules.{missing_key}", "issue": "Rule is missing from the configuration."}
        )

    # --- calibration ---------------------------------------------------------
    cal = payload.calibration
    if cal.enabled:
        if not cal.required_calibrators:
            problems.append(
                {
                    "field": "calibration.required_calibrators",
                    "issue": "At least one calibrator is required when calibration is enabled.",
                }
            )
        if cal.minimum_required > len(cal.required_calibrators):
            problems.append(
                {
                    "field": "calibration.minimum_required",
                    "issue": (
                        f"Cannot require {cal.minimum_required} calibrators when only "
                        f"{len(cal.required_calibrators)} are configured."
                    ),
                }
            )
        if cal.minimum_required < 1:
            problems.append(
                {
                    "field": "calibration.minimum_required",
                    "issue": "At least one calibrator must be required when enabled.",
                }
            )
        if len(set(cal.required_calibrators)) != len(cal.required_calibrators):
            problems.append(
                {
                    "field": "calibration.required_calibrators",
                    "issue": "Duplicate calibrator identifiers.",
                }
            )

    # --- controls ------------------------------------------------------------
    ctl = payload.controls
    if ctl.enabled:
        if ctl.minimum_required > len(ctl.required_controls):
            problems.append(
                {
                    "field": "controls.minimum_required",
                    "issue": (
                        f"Cannot require {ctl.minimum_required} controls when only "
                        f"{len(ctl.required_controls)} are configured."
                    ),
                }
            )
        if ctl.minimum_required < 1:
            problems.append(
                {
                    "field": "controls.minimum_required",
                    "issue": "At least one control must be required when enabled.",
                }
            )
        if len(set(ctl.required_controls)) != len(ctl.required_controls):
            problems.append(
                {"field": "controls.required_controls", "issue": "Duplicate control identifiers."}
            )
        overlap = set(ctl.required_controls) & set(ctl.discovered_optional)
        if overlap:
            problems.append(
                {
                    "field": "controls.discovered_optional",
                    "issue": f"Also listed as required: {', '.join(sorted(overlap))}.",
                }
            )

    # --- the cut-off source must actually be one of the run's controls -------
    cutoff = next((r for r in payload.rules if r.rule_key == "concentration_cutoff"), None)
    if cutoff is not None and cutoff.enabled:
        source = cutoff.parameters.get("source")
        sample_id = cutoff.parameters.get("source_sample_id")
        if source == "CONTROL_STD_CONC":
            known = set(ctl.required_controls) | set(ctl.discovered_optional)
            if sample_id not in known:
                problems.append(
                    {
                        "field": "rules.concentration_cutoff.parameters.source_sample_id",
                        "issue": (
                            f"'{sample_id}' is not a configured control, so no cut-off "
                            "could be derived."
                        ),
                    }
                )
        elif source == "FIXED_VALUE":
            value = cutoff.parameters.get("fixed_value")
            if not isinstance(value, int | float) or value <= 0:
                problems.append(
                    {
                        "field": "rules.concentration_cutoff.parameters.fixed_value",
                        "issue": "A fixed cut-off must be greater than zero.",
                    }
                )

    # --- retention time: an absolute window needs an actual window ----------
    rt = next((r for r in payload.rules if r.rule_key == "retention_time"), None)
    if rt is not None and rt.enabled and rt.parameters.get("mode") == "ABSOLUTE":
        window = rt.parameters.get("absolute_window_minutes")
        if not isinstance(window, int | float) or window <= 0:
            problems.append(
                {
                    "field": "rules.retention_time.parameters.absolute_window_minutes",
                    "issue": "An absolute retention-time window must be greater than zero.",
                }
            )

    # --- classification ------------------------------------------------------
    if not payload.classification:
        problems.append(
            {"field": "classification", "issue": "At least one classification rule is required."}
        )
    seen_priorities: set[int] = set()
    for index, rule in enumerate(payload.classification):
        for attribute in ("sample_id_pattern", "sample_type_pattern"):
            pattern = getattr(rule, attribute)
            try:
                re.compile(pattern)
            except re.error as exc:
                problems.append(
                    {
                        "field": f"classification[{index}].{attribute}",
                        "issue": f"Not a valid regular expression: {exc}",
                    }
                )
        if rule.priority in seen_priorities:
            problems.append(
                {
                    "field": f"classification[{index}].priority",
                    "issue": f"Priority {rule.priority} is used by more than one rule.",
                }
            )
        seen_priorities.add(rule.priority)

    # --- column role patterns -----------------------------------------------
    for role, patterns in payload.column_role_patterns.items():
        for index, pattern in enumerate(patterns):
            try:
                re.compile(pattern)
            except re.error as exc:
                problems.append(
                    {
                        "field": f"column_role_patterns.{role}[{index}]",
                        "issue": f"Not a valid regular expression: {exc}",
                    }
                )

    # --- limits --------------------------------------------------------------
    if payload.limits.max_upload_bytes <= 0:
        problems.append(
            {"field": "limits.max_upload_bytes", "issue": "Must be greater than zero."}
        )

    return problems


def require_valid(db: Session, payload: ConfigurationPayload) -> None:
    problems = validate_payload(db, payload)
    if problems:
        raise ConfigurationInvalid(
            "The configuration is not valid.", details=problems
        )
