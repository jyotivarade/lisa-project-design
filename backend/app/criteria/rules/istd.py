"""Internal standard: missing peak and suppression (spec section 8, D-05)."""

from decimal import Decimal

from app.criteria.derivations import ISTD_BASIS
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


class InternalStandardRule(BaseRule):
    rule_id = "istd"
    name = "Internal Standard"
    stream = Stream.PATIENT

    def evaluate(
        self, row: RowData, config: RuleConfig, context: EvaluationContext
    ) -> RuleResult:
        if not context.has_column("istd_area"):
            return self.skipped(config, "This file has no ISTD Area column.")

        area = context.value(row, "istd_area")

        if config.flag("missing_peak_fails", True):
            # "----" means the instrument reported no peak. That is a failure, and
            # it is emphatically not an area of zero (spec section 8).
            if area.kind is ValueKind.MISSING:
                return self.failed(
                    config,
                    "No internal-standard peak was reported.",
                    ErrorCode.ISTD_MISSING,
                    original_value=area.raw or "----",
                    threshold="a peak must be present",
                )
            if area.number is None:
                return self.failed(
                    config,
                    f"Internal-standard area '{area.raw}' is not a peak area.",
                    ErrorCode.ISTD_MISSING,
                    original_value=area.raw,
                    threshold="a peak must be present",
                )
        elif area.number is None:
            return self.skipped(config, "No internal-standard area to evaluate.")

        if not config.flag("suppression_enabled", True):
            return self.passed(
                config,
                "Internal-standard peak is present.",
                original_value=area.raw,
            )

        threshold = config.number("suppression_threshold_percent")
        if threshold is None:
            return self.passed(
                config, "Internal-standard peak is present.", original_value=area.raw
            )

        measured, basis, basis_name = self._recovery_basis(row, config, context)
        if measured is None or basis is None or basis == 0:
            # The basis could not be established, so suppression is unknown. Saying
            # so beats reporting a pass nobody computed.
            return self.passed(
                config,
                "Internal-standard peak is present; suppression could not be assessed "
                f"({basis_name} unavailable).",
                original_value=area.raw,
                metadata={"suppression_basis": basis_name, "assessed": False},
            )

        recovery = measured / basis * Decimal(100)
        shared = {
            "original_value": area.raw,
            "calculated_value": f"{fmt(recovery, 1)}%",
            "threshold": f"recovery >= {fmt(threshold, 1)}% of {basis_name}",
            "lower_limit": threshold,
            "metadata": {
                "suppression_basis": basis_name,
                "basis_value": str(basis),
                "assessed": True,
            },
        }
        if recovery < threshold:
            return self.failed(
                config,
                f"Internal standard is suppressed: recovery {fmt(recovery, 1)}% is below "
                f"the {fmt(threshold, 1)}% threshold ({basis_name}).",
                ErrorCode.ISTD_SUPPRESSED,
                **shared,
            )
        return self.passed(
            config,
            f"Internal-standard recovery {fmt(recovery, 1)}% meets the "
            f"{fmt(threshold, 1)}% threshold.",
            **shared,
        )

    def _recovery_basis(
        self, row: RowData, config: RuleConfig, context: EvaluationContext
    ) -> tuple[Decimal | None, Decimal | None, str]:
        """Choose the suppression basis (D-05).

        The specification names `% Recovery` and `Average % Recovery`, but no real
        instrument export in this repository carries either column, so the basis is
        configurable and the one actually used is reported on every result.
        """
        method = config.text("basis_method", "AUTO")

        if method in ("AUTO", "RECOVERY_COLUMNS"):
            recovery = context.value(row, "recovery")
            average = context.value(row, "avg_recovery")
            if recovery.number is not None and average.number is not None:
                return recovery.number, average.number, "% Recovery / Average % Recovery"
            if method == "RECOVERY_COLUMNS":
                return None, None, "% Recovery / Average % Recovery"

        trace = context.trace(ISTD_BASIS)
        if trace is not None and trace.available and trace.result is not None:
            area = context.value(row, "istd_area")
            return area.number, trace.result, trace.formula
        return None, None, "internal-standard basis"
