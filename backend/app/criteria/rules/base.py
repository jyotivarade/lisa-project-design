"""Rule protocol and shared result helpers."""

from decimal import Decimal
from typing import Protocol

from app.criteria.models import (
    ErrorCode,
    EvaluationContext,
    RowData,
    RuleConfig,
    RuleResult,
    RuleStatus,
    Stream,
)
from app.criteria.values import Value


class CriteriaRule(Protocol):
    rule_id: str
    name: str
    stream: Stream

    def evaluate(
        self, row: RowData, config: RuleConfig, context: EvaluationContext
    ) -> RuleResult: ...


class BaseRule:
    rule_id: str = ""
    name: str = ""
    stream: Stream = Stream.PATIENT

    def _result(
        self,
        config: RuleConfig,
        status: RuleStatus,
        message: str,
        **fields,
    ) -> RuleResult:
        return RuleResult(
            rule_id=self.rule_id,
            rule_name=self.name,
            status=status,
            message=message,
            priority=config.priority,
            **fields,
        )

    def passed(self, config: RuleConfig, message: str, **fields) -> RuleResult:
        return self._result(config, RuleStatus.PASS, message, **fields)

    def failed(
        self, config: RuleConfig, message: str, error_code: ErrorCode, **fields
    ) -> RuleResult:
        return self._result(
            config, RuleStatus.FAIL, message, error_code=error_code, **fields
        )

    def skipped(self, config: RuleConfig, message: str, **fields) -> RuleResult:
        """The rule could not run.

        A skip is never a pass: if every rule skips, the engine marks the row
        NOT_EVALUABLE rather than letting an unchecked row look verified.
        """
        return self._result(config, RuleStatus.SKIPPED, message, **fields)

    def non_numeric(self, config: RuleConfig, label: str, value: Value) -> RuleResult:
        return self.failed(
            config,
            f"{label} '{value.raw}' is not a number.",
            ErrorCode.NON_NUMERIC_VALUE,
            original_value=value.raw,
        )


def fmt(value: Decimal | None, places: int = 4) -> str:
    """Format for display without inventing precision."""
    if value is None:
        return "—"
    quantised = round(value, places)
    text = format(quantised, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"
