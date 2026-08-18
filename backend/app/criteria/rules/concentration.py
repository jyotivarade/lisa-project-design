"""Concentration cut-off (spec section 9)."""

from app.criteria.derivations import CUTOFF
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


class ConcentrationCutoffRule(BaseRule):
    rule_id = "concentration_cutoff"
    name = "Concentration Cut-off"
    stream = Stream.PATIENT

    def evaluate(
        self, row: RowData, config: RuleConfig, context: EvaluationContext
    ) -> RuleResult:
        if not context.has_column("concentration"):
            return self.skipped(config, "This file has no concentration column.")

        trace = context.trace(CUTOFF)
        if trace is None or not trace.available or trace.result is None:
            reason = trace.unavailable_reason if trace else "No cut-off has been derived."
            # Never a silent pass: an unresolvable cut-off means this row was not
            # checked, and the engine must be able to say so.
            return self.skipped(config, f"Cut-off could not be determined. {reason}".strip())

        cutoff = trace.result
        value = context.value(row, "concentration")

        if value.kind is ValueKind.OVER_RANGE:
            return self.passed(
                config,
                "Result is above the calibrated range, so it is above the cut-off.",
                original_value=value.raw,
                threshold=f">= {fmt(cutoff)} ng/mL",
            )
        if value.kind is ValueKind.MISSING:
            return self.skipped(config, "No concentration reported.")
        if value.number is None:
            return self.non_numeric(config, "Concentration", value)

        shared = {
            "original_value": value.raw,
            "calculated_value": fmt(value.number),
            "threshold": f">= {fmt(cutoff)} ng/mL",
            "lower_limit": cutoff,
            "metadata": {"cutoff_source": trace.formula},
        }
        if value.number < cutoff:
            return self.failed(
                config,
                f"Concentration {fmt(value.number)} ng/mL is below the "
                f"{fmt(cutoff)} ng/mL cut-off.",
                ErrorCode.CONCENTRATION_BELOW_CUTOFF,
                # The original is never overwritten; the adjustment is recorded
                # separately by the engine (spec section 9).
                zero_concentration=config.flag("zero_on_fail", True),
                **shared,
            )
        return self.passed(
            config,
            f"Concentration {fmt(value.number)} ng/mL is at or above the "
            f"{fmt(cutoff)} ng/mL cut-off.",
            **shared,
        )
