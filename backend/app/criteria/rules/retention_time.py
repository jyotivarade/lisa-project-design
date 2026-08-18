"""Retention time against the calibrator average window (spec section 11)."""

from app.criteria.derivations import RT_WINDOW
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


class RetentionTimeRule(BaseRule):
    rule_id = "retention_time"
    name = "Retention Time"
    stream = Stream.PATIENT

    def evaluate(
        self, row: RowData, config: RuleConfig, context: EvaluationContext
    ) -> RuleResult:
        if not context.has_column("retention_time"):
            return self.skipped(config, "This file has no retention-time column.")

        trace = context.trace(RT_WINDOW)
        if trace is None or not trace.available:
            reason = trace.unavailable_reason if trace else "No retention-time window derived."
            return self.skipped(config, f"Retention-time window unavailable. {reason}".strip())

        value = context.value(row, "retention_time")
        if value.kind is ValueKind.MISSING:
            return self.skipped(config, "No retention time reported.")
        if value.number is None:
            return self.non_numeric(config, "Retention time", value)

        lower, upper = trace.lower_limit, trace.upper_limit
        shared = {
            "original_value": value.raw,
            "calculated_value": fmt(value.number, 3),
            "threshold": f"{fmt(lower, 3)} – {fmt(upper, 3)} min",
            "lower_limit": lower,
            "upper_limit": upper,
            "metadata": {
                "formula": trace.formula,
                "average_rt": str(trace.result) if trace.result is not None else None,
            },
        }
        outside = (lower is not None and value.number < lower) or (
            upper is not None and value.number > upper
        )
        if outside:
            return self.failed(
                config,
                f"Retention time {fmt(value.number, 3)} min is outside the window "
                f"{fmt(lower, 3)} – {fmt(upper, 3)} min "
                f"(average {fmt(trace.result, 4)}).",
                ErrorCode.RT_OUT_OF_RANGE,
                **shared,
            )
        return self.passed(
            config,
            f"Retention time {fmt(value.number, 3)} min is within "
            f"{fmt(lower, 3)} – {fmt(upper, 3)} min.",
            **shared,
        )
