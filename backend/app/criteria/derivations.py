"""Derived limits, each with the trace that explains it.

Only **selected** calibrators whose value is usable contribute. A calibrator with a
ratio of `0`, a `----`, or a user deselection is excluded and says why — spec
section 10's data hazard is that an invalid Cal_1 must not be able to move the
reference range without anyone noticing.
"""

from collections.abc import Callable, Mapping, Sequence
from decimal import Decimal
from typing import Any

from app.criteria.models import (
    CalculationTrace,
    CalibratorPoint,
    ControlPoint,
    EvaluationContext,
)
from app.criteria.values import TokenSet, Value, ValueKind

ION_RATIO_RANGE = "ION_RATIO_RANGE"
RT_WINDOW = "RT_WINDOW"
CUTOFF = "CUTOFF"
CALIBRATION_RANGE = "CALIBRATION_RANGE"
ISTD_BASIS = "ISTD_BASIS"

# Zero-ratio policy (D-07)
ZERO_VALID = "VALID"
ZERO_INVALID = "INVALID"
ZERO_EXCLUDE = "EXCLUDE_FROM_RANGE"


def _unavailable(
    key: str,
    formula: str,
    reason: str,
    excluded: Sequence[Mapping[str, Any]] = (),
) -> CalculationTrace:
    return CalculationTrace(
        key=key,
        formula=formula,
        excluded=tuple(excluded),
        available=False,
        unavailable_reason=reason,
    )


def _exclusion(point: CalibratorPoint, value: Value, reason: str) -> dict[str, Any]:
    return {"calibrator_id": point.calibrator_id, "value": value.raw, "reason": reason}


def _usable_points(
    calibrators: Sequence[CalibratorPoint],
    getter: Callable[[CalibratorPoint], Value],
    *,
    zero_policy: str | None = None,
    require_positive: bool = False,
) -> tuple[list[tuple[CalibratorPoint, Decimal]], list[dict[str, Any]]]:
    """Split calibrators into contributors and explained exclusions."""
    included: list[tuple[CalibratorPoint, Decimal]] = []
    excluded: list[dict[str, Any]] = []

    for point in calibrators:
        value: Value = getter(point)
        if not point.is_selected:
            excluded.append(_exclusion(point, value, "Unselected by the user"))
            continue
        if value.kind is ValueKind.MISSING:
            excluded.append(_exclusion(point, value, "No value reported"))
            continue
        if value.kind is not ValueKind.NUMERIC or value.number is None:
            excluded.append(_exclusion(point, value, f"Value is {value.kind.value.lower()}"))
            continue

        number = value.number
        if zero_policy is not None and number == 0:
            if zero_policy == ZERO_EXCLUDE:
                excluded.append(
                    _exclusion(point, value, "Ratio is zero (excluded by the zero-ratio policy)")
                )
                continue
            if zero_policy == ZERO_INVALID:
                excluded.append(
                    _exclusion(point, value, "Ratio is zero (treated as invalid)")
                )
                continue
            # ZERO_VALID falls through: the laboratory has said a zero is real.
        if require_positive and number <= 0:
            excluded.append(_exclusion(point, value, "Value must be greater than zero"))
            continue

        included.append((point, number))

    return included, excluded


def derive_ion_ratio_limits(
    calibrators: Sequence[CalibratorPoint],
    *,
    formula: str = "SPAN",
    adjustment_percent: Decimal = Decimal(10),
    zero_ratio_policy: str = ZERO_EXCLUDE,
) -> CalculationTrace:
    """Spec section 10.

    SPAN (the default, and the specification's worked example):
        range  = highest - lowest
        amount = range x adjustment%
        limits = lowest - amount .. highest + amount
        40, 62 at 10% -> range 22 -> amount 2.2 -> 37.8 .. 64.2

    MULTIPLICATIVE (the existing prototype's reading, kept selectable per D-01):
        limits = lowest x (1 - adjustment%) .. highest x (1 + adjustment%)
    """
    included, excluded = _usable_points(
        calibrators, lambda p: p.ion_ratio, zero_policy=zero_ratio_policy
    )
    if not included:
        return _unavailable(
            ION_RATIO_RANGE,
            f"{formula} over selected valid calibrator ion ratios",
            "No selected calibrator has a usable ion ratio.",
            excluded,
        )

    ratios = [number for _, number in included]
    lowest, highest = min(ratios), max(ratios)
    fraction = adjustment_percent / Decimal(100)

    if formula == "MULTIPLICATIVE":
        lower = lowest * (Decimal(1) - fraction)
        upper = highest * (Decimal(1) + fraction)
        amount = None
        description = (
            f"lowest x (1 - {adjustment_percent}%) .. highest x (1 + {adjustment_percent}%)"
        )
    else:
        amount = (highest - lowest) * fraction
        lower = lowest - amount
        upper = highest + amount
        description = (
            f"range = highest - lowest; amount = range x {adjustment_percent}%; "
            "limits = lowest - amount .. highest + amount"
        )

    return CalculationTrace(
        key=ION_RATIO_RANGE,
        formula=description,
        inputs=tuple(
            {"calibrator_id": point.calibrator_id, "ion_ratio": str(number)}
            for point, number in included
        ),
        excluded=tuple(excluded),
        adjustment_percent=adjustment_percent,
        adjustment_value=amount,
        lower_limit=lower,
        upper_limit=upper,
        result=highest - lowest,
    )


def derive_rt_window(
    calibrators: Sequence[CalibratorPoint],
    *,
    mode: str = "PERCENTAGE",
    adjustment_percent: Decimal = Decimal(20),
    absolute_window_minutes: Decimal | None = None,
    average_method: str = "MEAN",
) -> CalculationTrace:
    """Spec section 11: the calibrator average, widened by the configured window."""
    included, excluded = _usable_points(
        calibrators, lambda p: p.found_rt, require_positive=True
    )
    if not included:
        return _unavailable(
            RT_WINDOW,
            "calibrator average retention time, widened by the configured window",
            "No selected calibrator has a usable retention time.",
            excluded,
        )

    times = sorted(number for _, number in included)
    if average_method == "MEDIAN":
        middle = len(times) // 2
        average = (
            times[middle]
            if len(times) % 2
            else (times[middle - 1] + times[middle]) / Decimal(2)
        )
    else:
        average = sum(times) / Decimal(len(times))

    if mode == "ABSOLUTE":
        window = absolute_window_minutes or Decimal(0)
        lower, upper = average - window, average + window
        description = f"{average_method.lower()} retention time +/- {window} min"
        amount = window
        percent = None
    else:
        fraction = adjustment_percent / Decimal(100)
        lower = average * (Decimal(1) - fraction)
        upper = average * (Decimal(1) + fraction)
        description = f"{average_method.lower()} retention time x (1 +/- {adjustment_percent}%)"
        amount = average * fraction
        percent = adjustment_percent

    return CalculationTrace(
        key=RT_WINDOW,
        formula=description,
        inputs=tuple(
            {"calibrator_id": point.calibrator_id, "found_rt": str(number)}
            for point, number in included
        ),
        excluded=tuple(excluded),
        adjustment_percent=percent,
        adjustment_value=amount,
        lower_limit=lower,
        upper_limit=upper,
        result=average,
    )


def derive_cutoff(
    controls: Sequence[ControlPoint],
    *,
    source: str = "CONTROL_STD_CONC",
    source_sample_id: str = "WCS1",
    fixed_value: Decimal | None = None,
) -> CalculationTrace:
    """Spec section 9: the cut-off is the Std. Conc. of a named control row."""
    if source == "FIXED_VALUE":
        if fixed_value is None or fixed_value <= 0:
            return _unavailable(
                CUTOFF, "fixed cut-off from configuration", "No fixed cut-off is configured."
            )
        return CalculationTrace(
            key=CUTOFF,
            formula="fixed cut-off from configuration",
            inputs=({"source": "FIXED_VALUE", "value": str(fixed_value)},),
            result=fixed_value,
        )

    wanted = source_sample_id.strip().casefold()
    match = next((c for c in controls if c.control_id.strip().casefold() == wanted), None)
    if match is None:
        return _unavailable(
            CUTOFF,
            f"Std. Conc. (ng/mL) of {source_sample_id}",
            f"Control '{source_sample_id}' is not present in this run.",
        )
    if not match.std_concentration.is_usable or match.std_concentration.number is None:
        return _unavailable(
            CUTOFF,
            f"Std. Conc. (ng/mL) of {source_sample_id}",
            f"Control '{source_sample_id}' reports no usable Std. Conc.",
        )

    return CalculationTrace(
        key=CUTOFF,
        formula=f"Std. Conc. (ng/mL) of {match.control_id}",
        inputs=(
            {
                "control_id": match.control_id,
                "std_concentration": str(match.std_concentration.number),
            },
        ),
        result=match.std_concentration.number,
    )


def derive_calibration_range(calibrators: Sequence[CalibratorPoint]) -> CalculationTrace:
    """Spec section 12: the calibrated measuring range."""
    included, excluded = _usable_points(
        calibrators, lambda p: p.std_concentration, require_positive=True
    )
    if not included:
        return _unavailable(
            CALIBRATION_RANGE,
            "lowest .. highest calibrator Std. Conc. (ng/mL)",
            "No selected calibrator has a usable Std. Conc.",
            excluded,
        )

    concentrations = [number for _, number in included]
    return CalculationTrace(
        key=CALIBRATION_RANGE,
        formula="lowest .. highest calibrator Std. Conc. (ng/mL)",
        inputs=tuple(
            {"calibrator_id": point.calibrator_id, "std_concentration": str(number)}
            for point, number in included
        ),
        excluded=tuple(excluded),
        lower_limit=min(concentrations),
        upper_limit=max(concentrations),
    )


def derive_istd_basis(
    areas: Sequence[Decimal], *, method: str, source: str
) -> CalculationTrace:
    """Spec section 8 / D-05.

    No real instrument export in this repository carries `% Recovery` or
    `Average % Recovery`, so the basis is configurable and the one actually used is
    recorded on every result rather than left to be inferred.
    """
    usable = [area for area in areas if area > 0]
    if not usable:
        return _unavailable(
            ISTD_BASIS, f"{method} over {source}", "No usable internal-standard values."
        )

    mean = sum(usable) / Decimal(len(usable))
    return CalculationTrace(
        key=ISTD_BASIS,
        formula=f"{method} over {source}",
        inputs=({"count": len(usable), "source": source, "method": method},),
        result=mean,
    )


def build_context(
    *,
    columns: Mapping[str, str | None],
    tokens: TokenSet,
    calibrators: Sequence[CalibratorPoint] = (),
    controls: Sequence[ControlPoint] = (),
    traces: Sequence[CalculationTrace] = (),
) -> EvaluationContext:
    """Assemble a context. Pure: plain data in, immutable context out."""
    return EvaluationContext(
        columns=dict(columns),
        tokens=tokens,
        traces={trace.key: trace for trace in traces},
        calibrators=tuple(calibrators),
        controls=tuple(controls),
    )
