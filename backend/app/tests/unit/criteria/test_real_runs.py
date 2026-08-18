"""The engine against the real instrument exports — still with no database.

The parser is used to read the fixtures, but the engine is fed plain objects. This
is the end-to-end shape Phase 6 and 7 will wire up, proven first in isolation.
"""

from decimal import Decimal
from pathlib import Path

import pytest

from app.core.rule_catalog import DEFAULT_CLASSIFICATION_RULES, DEFAULT_COLUMN_ROLE_PATTERNS
from app.criteria.derivations import (
    CALIBRATION_RANGE,
    CUTOFF,
    ION_RATIO_RANGE,
    ISTD_BASIS,
    RT_WINDOW,
    derive_calibration_range,
    derive_cutoff,
    derive_ion_ratio_limits,
    derive_istd_basis,
    derive_rt_window,
)
from app.criteria.engine import CriteriaEngine
from app.criteria.models import (
    CalibratorPoint,
    ControlPoint,
    FinalResult,
    RowData,
    RuleConfig,
    Stream,
)
from app.criteria.values import interpret
from app.processing.classifier import classify, compile_rules
from app.processing.column_mapper import resolve
from app.processing.csv_parser import parse
from app.tests.unit.criteria.factories import TOKENS

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
ENGINE = CriteriaEngine()


def load(name: str):
    """Parse a fixture into calibrators, controls and patient rows."""
    with (FIXTURES / name).open("rb") as handle:
        summary, rows = parse(handle)
        rows = list(rows)

    mapping = resolve(summary.columns, DEFAULT_COLUMN_ROLE_PATTERNS)
    rules = compile_rules(DEFAULT_CLASSIFICATION_RULES)

    calibrators: list[CalibratorPoint] = []
    controls: list[ControlPoint] = []
    patients: list[RowData] = []

    def cell(values, role):
        return interpret(mapping.value(values, role), TOKENS)

    for parsed in rows:
        sample_id = mapping.value(parsed.values, "sample_id").strip()
        sample_type = mapping.value(parsed.values, "sample_type").strip()
        stream = classify(sample_id, sample_type, rules).stream

        if stream.value == "CALIBRATOR":
            calibrators.append(
                CalibratorPoint(
                    calibrator_id=sample_id,
                    ion_ratio=cell(parsed.values, "ion_ratio"),
                    found_rt=cell(parsed.values, "retention_time"),
                    std_concentration=cell(parsed.values, "std_concentration"),
                    percent_diff=cell(parsed.values, "percent_diff"),
                    concentration=cell(parsed.values, "concentration"),
                    istd_area=cell(parsed.values, "istd_area"),
                )
            )
        elif stream.value == "CONTROL":
            controls.append(
                ControlPoint(
                    control_id=sample_id,
                    percent_diff=cell(parsed.values, "percent_diff"),
                    std_concentration=cell(parsed.values, "std_concentration"),
                    concentration=cell(parsed.values, "concentration"),
                    is_required=sample_id.upper().startswith("WCS"),
                )
            )
        elif stream.value == "PATIENT":
            patients.append(
                RowData(
                    source_row_number=parsed.source_row_number,
                    stream=Stream.PATIENT,
                    values=parsed.values,
                    sample_id=sample_id,
                    sample_type=sample_type,
                    analyte_name=mapping.value(parsed.values, "analyte_name"),
                )
            )

    return mapping.roles, calibrators, controls, patients


def build(name: str):
    from app.criteria.derivations import build_context

    columns, calibrators, controls, patients = load(name)
    areas = [
        interpret(row.values.get(columns["istd_area"], ""), TOKENS).number
        for row in patients
    ]
    traces = [
        derive_ion_ratio_limits(calibrators, adjustment_percent=Decimal(10)),
        derive_rt_window(calibrators, adjustment_percent=Decimal(20)),
        derive_cutoff(controls, source_sample_id="WCS1"),
        derive_calibration_range(calibrators),
        derive_istd_basis(
            [a for a in areas if a is not None], method="mean", source="patient rows"
        ),
    ]
    context = build_context(
        columns=columns,
        tokens=TOKENS,
        calibrators=calibrators,
        controls=controls,
        traces=traces,
    )
    return context, patients, {t.key: t for t in traces}


PATIENT_RULES = [
    RuleConfig("istd", True, True, 30, Stream.PATIENT,
               {"missing_peak_fails": True, "suppression_enabled": True,
                "suppression_threshold_percent": 90, "basis_method": "AUTO"}),
    RuleConfig("concentration_cutoff", True, True, 40, Stream.PATIENT,
               {"source": "CONTROL_STD_CONC", "source_sample_id": "WCS1",
                "fixed_value": 0, "zero_on_fail": True}),
    RuleConfig("ion_ratio", True, True, 50, Stream.PATIENT, {}),
    RuleConfig("retention_time", True, True, 60, Stream.PATIENT, {}),
    RuleConfig("calibration_range", True, True, 70, Stream.PATIENT,
               {"over_range_action": "FAIL", "under_range_action": "FAIL"}),
]


class TestDerivedLimitsFromRealRuns:
    def test_run_01_limits(self) -> None:
        _, _, traces = build("Cocaine_2026_08_01.csv")
        ratio = traces[ION_RATIO_RANGE]
        assert (ratio.lower_limit, ratio.upper_limit) == (
            Decimal("24.4500"),
            Decimal("34.7700"),
        )
        rt = traces[RT_WINDOW]
        assert rt.result == pytest.approx(Decimal("4.34842857"), abs=Decimal("0.0001"))
        assert traces[CUTOFF].result == Decimal("1.5")
        assert (traces[CALIBRATION_RANGE].lower_limit, traces[CALIBRATION_RANGE].upper_limit) == (
            Decimal(1),
            Decimal(100),
        )
        assert traces[ISTD_BASIS].available is True

    def test_every_real_run_derives_all_five_limits(self) -> None:
        for name in (
            "Cocaine_2026_08_01.csv",
            "Cocaine_2026_08_02.csv",
            "Cocaine_2026_08_03.csv",
            "Cocaine_2026_08_04.csv",
        ):
            _, _, traces = build(name)
            assert all(t.available for t in traces.values()), name


class TestPatientProcessingOnRealData:
    def test_every_patient_row_is_evaluated_independently(self) -> None:
        context, patients, _ = build("Cocaine_2026_08_01.csv")
        assert len(patients) == 118

        results = [ENGINE.evaluate(row, context, PATIENT_RULES) for row in patients]
        assert len(results) == 118
        # Every row got a verdict — a failing row never stopped the run.
        assert all(r.final_result in (FinalResult.PASSED, FinalResult.FAILED) for r in results)
        assert all(r.evaluated_count > 0 for r in results)

    def test_the_run_produces_both_passes_and_failures(self) -> None:
        context, patients, _ = build("Cocaine_2026_08_01.csv")
        results = [ENGINE.evaluate(row, context, PATIENT_RULES) for row in patients]

        passed = [r for r in results if r.final_result is FinalResult.PASSED]
        failed = [r for r in results if r.final_result is FinalResult.FAILED]
        assert passed and failed, "a real run should discriminate, not pass everything"

    def test_the_known_retention_time_outliers_are_caught(self) -> None:
        # Rows at 5.660 and 5.662 min sit outside the 3.479–5.218 window.
        context, patients, _ = build("Cocaine_2026_08_01.csv")
        results = {
            r.sample_id: r for r in (ENGINE.evaluate(p, context, PATIENT_RULES) for p in patients)
        }
        outliers = [
            sample_id
            for sample_id, result in results.items()
            if "RT_OUT_OF_RANGE" in result.failure_codes
        ]
        assert len(outliers) >= 2

    def test_below_cutoff_rows_keep_their_original_concentration(self) -> None:
        context, patients, _ = build("Cocaine_2026_08_01.csv")
        results = [ENGINE.evaluate(p, context, PATIENT_RULES) for p in patients]
        adjusted = [
            r for r in results if "CONCENTRATION_BELOW_CUTOFF" in r.failure_codes
        ]
        assert adjusted, "run 01 contains results below the 1.5 ng/mL cut-off"
        for result in adjusted:
            assert result.adjusted_concentration == Decimal(0)
            assert result.original_concentration != Decimal(0)
            assert result.cutoff_value == Decimal("1.5")

    def test_low_istd_rows_are_flagged_as_suppressed(self) -> None:
        # Rows with an ISTD area near 4.4M against a batch mean around 14M.
        context, patients, _ = build("Cocaine_2026_08_01.csv")
        results = [ENGINE.evaluate(p, context, PATIENT_RULES) for p in patients]
        suppressed = [r for r in results if "ISTD_SUPPRESSED" in r.failure_codes]
        assert suppressed

    def test_processing_the_same_run_twice_gives_identical_verdicts(self) -> None:
        context, patients, _ = build("Cocaine_2026_08_01.csv")
        first = [ENGINE.evaluate(p, context, PATIENT_RULES) for p in patients]
        second = [ENGINE.evaluate(p, context, PATIENT_RULES) for p in patients]
        assert [r.final_result for r in first] == [r.final_result for r in second]
        assert [r.failure_codes for r in first] == [r.failure_codes for r in second]

    @pytest.mark.parametrize(
        "name",
        [
            "Cocaine_2026_08_01.csv",
            "Cocaine_2026_08_02.csv",
            "Cocaine_2026_08_03.csv",
            "Cocaine_2026_08_04.csv",
        ],
    )
    def test_every_real_run_processes_without_an_engine_error(self, name: str) -> None:
        context, patients, _ = build(name)
        results = [ENGINE.evaluate(p, context, PATIENT_RULES) for p in patients]
        assert results
        assert all("RULE_ERROR" not in r.failure_codes for r in results)
