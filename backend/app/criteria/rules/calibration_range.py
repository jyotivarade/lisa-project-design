"""Calibrated measuring range, including N.I. High / N.I. Low (spec section 12)."""

from typing import Any

from app.criteria.derivations import CALIBRATION_RANGE
from app.criteria.models import (
    ErrorCode,
    EvaluationContext,
    RowData,
    RuleConfig,
    RuleResult,
    Stream,
)
from app.criteria.rules.base import BaseRule, fmt
from app.criteria.values import ValueKind

FLAG_ONLY = "FLAG_ONLY"


class CalibrationRangeRule(BaseRule):
    rule_id = "calibration_range"
    name = "Calibration Range"
    stream = Stream.PATIENT

    def evaluate(
        self, row: RowData, config: RuleConfig, context: EvaluationContext
    ) -> RuleResult:
        if not context.has_column("concentration"):
            return self.skipped(config, "This file has no concentration column.")

        value = context.value(row, "concentration")
        over_action = config.text("over_range_action", "FAIL")
        under_action = config.text("under_range_action", "FAIL")

        # The instrument's own verdict needs no calibrated range to act on.
        if value.kind is ValueKind.OVER_RANGE:
            return self._outcome(
                config,
                over_action,
                f"The instrument reported {value.raw}: the result is over the "
                "calibrated range and needs dilution.",
                ErrorCode.OVER_CALIBRATION_RANGE,
                original_value=value.raw,
            )
        if value.kind is ValueKind.UNDER_RANGE:
            return self._outcome(
                config,
                under_action,
                f"The instrument reported {value.raw}: the result is under the "
                "calibrated range.",
                ErrorCode.UNDER_CALIBRATION_RANGE,
                original_value=value.raw,
            )

        trace = context.trace(CALIBRATION_RANGE)
        if trace is None or not trace.available:
            reason = trace.unavailable_reason if trace else "No calibrated range was derived."
            return self.skipped(config, f"Calibrated range unavailable. {reason}".strip())

        if value.kind is ValueKind.MISSING:
            return self.skipped(config, "No concentration reported.")
        if value.number is None:
            return self.non_numeric(config, "Concentration", value)

        lower, upper = trace.lower_limit, trace.upper_limit
        shared = {
            "original_value": value.raw,
            "calculated_value": fmt(value.number),
            "threshold": f"{fmt(lower)} – {fmt(upper)} ng/mL",
            "lower_limit": lower,
            "upper_limit": upper,
        }
        if upper is not None and value.number > upper:
            return self._outcome(
                config,
                over_action,
                f"Concentration {fmt(value.number)} ng/mL exceeds the highest calibrator "
                f"({fmt(upper)} ng/mL) and needs dilution.",
                ErrorCode.OVER_CALIBRATION_RANGE,
                **shared,
            )
        if lower is not None and value.number < lower:
            # A reported zero is a negative result, not a range excursion: flagging
            # it here would double-count what the cut-off rule already decided.
            if value.number == 0:
                return self.passed(
                    config, "Concentration is zero; not a range excursion.", **shared
                )
            return self._outcome(
                config,
                under_action,
                f"Concentration {fmt(value.number)} ng/mL is below the lowest calibrator "
                f"({fmt(lower)} ng/mL).",
                ErrorCode.UNDER_CALIBRATION_RANGE,
                **shared,
            )
        return self.passed(
            config,
            f"Concentration {fmt(value.number)} ng/mL is within the calibrated range "
            f"{fmt(lower)} – {fmt(upper)} ng/mL.",
            **shared,
        )

    def _outcome(
        self,
        config: RuleConfig,
        action: str,
        message: str,
        code: ErrorCode,
        **fields: Any,
    ) -> RuleResult:
        if action == FLAG_ONLY:
            # Recorded and visible, but it does not fail the row (D-12).
            return self.passed(
                config,
                f"{message} Flagged only, per configuration.",
                metadata={"flag": code.value},
                **fields,
            )
        return self.failed(config, message, code, **fields)
