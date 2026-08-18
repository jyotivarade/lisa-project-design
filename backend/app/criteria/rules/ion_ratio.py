"""Ion ratio against the calibrator-derived range (spec section 10)."""

from app.criteria.derivations import ION_RATIO_RANGE
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


class IonRatioRule(BaseRule):
    rule_id = "ion_ratio"
    name = "Ion Ratio"
    stream = Stream.PATIENT

    def evaluate(
        self, row: RowData, config: RuleConfig, context: EvaluationContext
    ) -> RuleResult:
        if not context.has_column("ion_ratio"):
            return self.skipped(config, "This file has no ion-ratio column.")

        trace = context.trace(ION_RATIO_RANGE)
        if trace is None or not trace.available:
            reason = trace.unavailable_reason if trace else "No ion-ratio range was derived."
            return self.skipped(config, f"Ion-ratio range unavailable. {reason}".strip())

        value = context.value(row, "ion_ratio")
        if value.kind is ValueKind.MISSING:
            return self.skipped(config, "No ion ratio reported.")
        if value.number is None:
            return self.non_numeric(config, "Ion ratio", value)

        lower, upper = trace.lower_limit, trace.upper_limit
        shared = {
            "original_value": value.raw,
            "calculated_value": fmt(value.number, 2),
            "threshold": f"{fmt(lower, 2)} – {fmt(upper, 2)}",
            "lower_limit": lower,
            "upper_limit": upper,
            "metadata": {
                "formula": trace.formula,
                "calibrators_used": len(trace.inputs),
                "calibrators_excluded": len(trace.excluded),
            },
        }
        if lower is not None and value.number < lower:
            return self.failed(
                config,
                f"Ion ratio {fmt(value.number, 2)} is below the acceptable range "
                f"{fmt(lower, 2)} – {fmt(upper, 2)}.",
                ErrorCode.ION_RATIO_OUT_OF_RANGE,
                **shared,
            )
        if upper is not None and value.number > upper:
            return self.failed(
                config,
                f"Ion ratio {fmt(value.number, 2)} is above the acceptable range "
                f"{fmt(lower, 2)} – {fmt(upper, 2)}.",
                ErrorCode.ION_RATIO_OUT_OF_RANGE,
                **shared,
            )
        return self.passed(
            config,
            f"Ion ratio {fmt(value.number, 2)} is within {fmt(lower, 2)} – {fmt(upper, 2)}.",
            **shared,
        )
