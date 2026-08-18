"""Builders for criteria tests. Plain objects — no database anywhere in this suite."""

from decimal import Decimal
from typing import Any

from app.criteria.derivations import build_context
from app.criteria.models import (
    CalculationTrace,
    CalibratorPoint,
    ControlPoint,
    EvaluationContext,
    RowData,
    RuleConfig,
    Stream,
)
from app.criteria.values import TokenSet, interpret

TOKENS = TokenSet.from_config(
    {
        "missing": ["----", "", "N/A", "NA"],
        "over_range": ["N.I. High", "N.I.(High)"],
        "under_range": ["N.I. Low"],
    }
)

# The real instrument header (Cocaine_2026_08_01.csv).
COLUMNS: dict[str, str | None] = {
    "analyte_name": "Analyte Name",
    "sample_id": "Sample ID",
    "sample_type": "Sample Type",
    "percent_diff": "%Diff",
    "istd_area": "ISTD Area",
    "recovery": None,      # absent from every real export (D-05)
    "avg_recovery": None,
    "concentration": "Conc. (ng/mL)",
    "std_concentration": "Std. Conc. (ng/mL)",
    "ion_ratio": "Ref 1 Actual Ratio",
    "retention_time": "Found RT",
}


def value(raw: str):
    return interpret(raw, TOKENS)


def row(stream: Stream = Stream.PATIENT, number: int = 1, **cells: str) -> RowData:
    values = {COLUMNS[role]: raw for role, raw in cells.items() if COLUMNS.get(role)}
    return RowData(
        source_row_number=number,
        stream=stream,
        values=values,
        sample_id=cells.get("sample_id", "2606251021"),
        sample_type=cells.get("sample_type", ""),
        analyte_name=cells.get("analyte_name", "Cocaine"),
    )


def config(rule_id: str, stream: Stream = Stream.PATIENT, **parameters: Any) -> RuleConfig:
    return RuleConfig(
        rule_id=rule_id,
        enabled=parameters.pop("enabled", True),
        mandatory=parameters.pop("mandatory", True),
        priority=parameters.pop("priority", 10),
        stream=stream,
        parameters=parameters,
    )


def calibrator(
    calibrator_id: str,
    *,
    ion_ratio: str = "30",
    found_rt: str = "4.350",
    std_concentration: str = "10",
    percent_diff: str = "0",
    concentration: str = "10",
    istd_area: str = "18000000",
    is_selected: bool = True,
) -> CalibratorPoint:
    return CalibratorPoint(
        calibrator_id=calibrator_id,
        ion_ratio=value(ion_ratio),
        found_rt=value(found_rt),
        std_concentration=value(std_concentration),
        percent_diff=value(percent_diff),
        concentration=value(concentration),
        istd_area=value(istd_area),
        is_selected=is_selected,
    )


def control(
    control_id: str,
    *,
    percent_diff: str = "0",
    std_concentration: str = "1.5",
    concentration: str = "1.5",
    is_required: bool = True,
    is_selected: bool = True,
) -> ControlPoint:
    return ControlPoint(
        control_id=control_id,
        percent_diff=value(percent_diff),
        std_concentration=value(std_concentration),
        concentration=value(concentration),
        is_selected=is_selected,
        is_required=is_required,
    )


def trace(key: str, **fields) -> CalculationTrace:
    fields.setdefault("formula", "test")
    return CalculationTrace(key=key, **fields)


def context(
    *,
    columns: dict[str, str | None] | None = None,
    calibrators=(),
    controls=(),
    traces=(),
) -> EvaluationContext:
    return build_context(
        columns=columns if columns is not None else COLUMNS,
        tokens=TOKENS,
        calibrators=calibrators,
        controls=controls,
        traces=traces,
    )


def dec(text: str) -> Decimal:
    return Decimal(text)


# The seven real calibrators from Cocaine_2026_08_01.csv.
REAL_CALIBRATORS = [
    calibrator("Cal_1", ion_ratio="25.31", found_rt="4.348",
               std_concentration="1", percent_diff="-0.22"),
    calibrator("Cal_2", ion_ratio="33.91", found_rt="4.341",
               std_concentration="2", percent_diff="-7.70"),
    calibrator("Cal_3", ion_ratio="29.30", found_rt="4.367",
               std_concentration="5", percent_diff="9.39"),
    calibrator("Cal_4", ion_ratio="31.16", found_rt="4.342",
               std_concentration="10", percent_diff="6.08"),
    calibrator("Cal_5", ion_ratio="32.15", found_rt="4.339",
               std_concentration="20", percent_diff="-1.65"),
    calibrator("Cal_6", ion_ratio="32.68", found_rt="4.364",
               std_concentration="40", percent_diff="-11.46"),
    calibrator("Cal_7", ion_ratio="27.84", found_rt="4.338",
               std_concentration="100", percent_diff="11.25"),
]

# The real controls, including UC whose %Diff is the missing token.
REAL_CONTROLS = [
    control("WCS1", percent_diff="-7.16", std_concentration="1.5", concentration="1.3926"),
    control("WCS2", percent_diff="-2.30", std_concentration="2.5", concentration="2.4426"),
    control("WCS3", percent_diff="12.08", std_concentration="50", concentration="56.0384"),
    control("UC", percent_diff="----", std_concentration="----", concentration="0.5656",
            is_required=False),
]
