"""Criteria engine data model. PURE — plain dataclasses, no ORM, no I/O (AD-3).

Everything a rule needs arrives in its `EvaluationContext`. A rule that reached for
a database would be a rule whose result depended on something outside the six
reproducibility inputs of spec section 43.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from typing import Any

from app.criteria.values import TokenSet, Value, ValueKind, interpret


class Stream(StrEnum):
    CALIBRATOR = "CALIBRATOR"
    CONTROL = "CONTROL"
    PATIENT = "PATIENT"
    OTHER = "OTHER"
    SKIPPED = "SKIPPED"
    NOT_IN_SCOPE = "NOT_IN_SCOPE"


class RuleStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    SKIPPED = "SKIPPED"


class FinalResult(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"


class ErrorCode(StrEnum):
    """Stable per-rule failure codes. Reports and the UI branch on these."""

    CALIBRATION_TOLERANCE_EXCEEDED = "CALIBRATION_TOLERANCE_EXCEEDED"
    CONTROL_TOLERANCE_EXCEEDED = "CONTROL_TOLERANCE_EXCEEDED"
    ISTD_MISSING = "ISTD_MISSING"
    ISTD_SUPPRESSED = "ISTD_SUPPRESSED"
    CONCENTRATION_BELOW_CUTOFF = "CONCENTRATION_BELOW_CUTOFF"
    ION_RATIO_OUT_OF_RANGE = "ION_RATIO_OUT_OF_RANGE"
    RT_OUT_OF_RANGE = "RT_OUT_OF_RANGE"
    OVER_CALIBRATION_RANGE = "OVER_CALIBRATION_RANGE"
    UNDER_CALIBRATION_RANGE = "UNDER_CALIBRATION_RANGE"
    NON_NUMERIC_VALUE = "NON_NUMERIC_VALUE"
    NOT_EVALUABLE = "NOT_EVALUABLE"
    RULE_ERROR = "RULE_ERROR"


@dataclass(frozen=True)
class RowData:
    """One parsed row, exactly as it came out of the file."""

    source_row_number: int
    stream: Stream
    values: Mapping[str, str]
    sample_id: str = ""
    sample_type: str = ""
    analyte_name: str = ""


@dataclass(frozen=True)
class RuleConfig:
    """One rule's settings, taken from the session's configuration snapshot."""

    rule_id: str
    enabled: bool
    mandatory: bool
    priority: int
    stream: Stream
    parameters: Mapping[str, Any] = field(default_factory=dict)

    def number(self, name: str, default: Decimal | None = None) -> Decimal | None:
        raw = self.parameters.get(name)
        if raw is None or isinstance(raw, bool):
            return default
        try:
            return Decimal(str(raw))
        except (ArithmeticError, ValueError):
            return default

    def text(self, name: str, default: str = "") -> str:
        raw = self.parameters.get(name)
        return default if raw is None else str(raw)

    def flag(self, name: str, default: bool = False) -> bool:
        raw = self.parameters.get(name)
        return default if raw is None else bool(raw)


@dataclass(frozen=True)
class RuleResult:
    """The structured outcome spec section 14 requires — never a bare boolean."""

    rule_id: str
    rule_name: str
    status: RuleStatus
    message: str
    error_code: ErrorCode | None = None
    original_value: str | None = None
    calculated_value: str | None = None
    threshold: str | None = None
    lower_limit: Decimal | None = None
    upper_limit: Decimal | None = None
    priority: int = 0
    metadata: Mapping[str, Any] = field(default_factory=dict)
    # Only the concentration cut-off sets this today (spec section 9). See D-17.
    zero_concentration: bool = False

    @property
    def passed(self) -> bool:
        return self.status is RuleStatus.PASS

    @property
    def failed(self) -> bool:
        return self.status is RuleStatus.FAIL


@dataclass(frozen=True)
class RowEvaluation:
    """The complete verdict for one row, with every rule's outcome retained."""

    source_row_number: int
    sample_id: str
    analyte: str
    final_result: FinalResult
    rules: tuple[RuleResult, ...]
    original_concentration: Decimal | None = None
    adjusted_concentration: Decimal | None = None
    cutoff_value: Decimal | None = None
    engine_version: str = ""

    @property
    def failure_codes(self) -> tuple[str, ...]:
        return tuple(
            r.error_code.value for r in self.rules if r.failed and r.error_code is not None
        )

    @property
    def failed_rules(self) -> tuple[RuleResult, ...]:
        return tuple(r for r in self.rules if r.failed)

    @property
    def evaluated_count(self) -> int:
        return sum(1 for r in self.rules if r.status is not RuleStatus.SKIPPED)


@dataclass(frozen=True)
class CalculationTrace:
    """How a derived limit was computed (spec sections 10, 11 and 17).

    Stored per session and rendered in the UI, so a reviewer can see where a limit
    came from instead of reverse-engineering it from the CSV.
    """

    key: str
    formula: str
    inputs: tuple[Mapping[str, Any], ...] = ()
    excluded: tuple[Mapping[str, Any], ...] = ()
    adjustment_percent: Decimal | None = None
    adjustment_value: Decimal | None = None
    lower_limit: Decimal | None = None
    upper_limit: Decimal | None = None
    result: Decimal | None = None
    available: bool = True
    unavailable_reason: str = ""


@dataclass(frozen=True)
class CalibratorPoint:
    """A discovered calibrator, with the user's selection and its value quality."""

    calibrator_id: str
    ion_ratio: Value
    found_rt: Value
    std_concentration: Value
    percent_diff: Value
    concentration: Value
    istd_area: Value
    is_selected: bool = True


@dataclass(frozen=True)
class ControlPoint:
    control_id: str
    percent_diff: Value
    std_concentration: Value
    concentration: Value
    is_selected: bool = True
    is_required: bool = False


@dataclass(frozen=True)
class EvaluationContext:
    """Everything a rule may read. Built once per session, immutable thereafter."""

    columns: Mapping[str, str | None]
    tokens: TokenSet
    traces: Mapping[str, CalculationTrace]
    calibrators: Sequence[CalibratorPoint] = ()
    controls: Sequence[ControlPoint] = ()

    def value(self, row: RowData, role: str) -> Value:
        """Interpret one cell by role. Returns MISSING when the role has no column."""
        column = self.columns.get(role)
        if column is None:
            return Value(raw="", kind=ValueKind.MISSING)
        return interpret(row.values.get(column, ""), self.tokens)

    def has_column(self, role: str) -> bool:
        return self.columns.get(role) is not None

    def trace(self, key: str) -> CalculationTrace | None:
        return self.traces.get(key)
