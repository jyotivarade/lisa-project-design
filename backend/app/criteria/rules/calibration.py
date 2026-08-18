"""Calibrator accuracy (spec section 6)."""

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


class CalibrationAccuracyRule(BaseRule):
    rule_id = "calibration_accuracy"
    name = "Calibrator Accuracy"
    stream = Stream.CALIBRATOR

    def evaluate(
        self, row: RowData, config: RuleConfig, context: EvaluationContext
    ) -> RuleResult:
        if not context.has_column("percent_diff"):
            return self.skipped(config, "This file has no % Diff column.")

        value = context.value(row, "percent_diff")
        if value.kind is ValueKind.MISSING:
            return self.skipped(config, "No % Diff reported for this calibrator.")
        if value.number is None:
            return self.non_numeric(config, "% Diff", value)

        tolerance = config.number("tolerance_percent")
        if tolerance is None:
            return self.skipped(config, "No calibration tolerance is configured.")

        deviation = abs(value.number)
        operator = config.text("tolerance_operator", "lte")
        # Whether exactly-at-tolerance passes is configuration, not an accident.
        within = deviation < tolerance if operator == "lt" else deviation <= tolerance
        symbol = "<" if operator == "lt" else "<="

        shared = {
            "original_value": value.raw,
            "calculated_value": fmt(deviation, 2),
            "threshold": f"ABS(% Diff) {symbol} {fmt(tolerance, 2)}%",
            "lower_limit": -tolerance,
            "upper_limit": tolerance,
        }
        if within:
            return self.passed(
                config,
                f"% Diff {fmt(value.number, 2)}% is within the "
                f"{fmt(tolerance, 2)}% tolerance.",
                **shared,
            )
        return self.failed(
            config,
            f"% Diff {fmt(value.number, 2)}% exceeds the {fmt(tolerance, 2)}% tolerance.",
            ErrorCode.CALIBRATION_TOLERANCE_EXCEEDED,
            **shared,
        )
