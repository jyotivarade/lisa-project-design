"""The engine's four guarantees (spec sections 13 and 14)."""

from decimal import Decimal

import pytest

from app.criteria.derivations import CALIBRATION_RANGE, CUTOFF, ION_RATIO_RANGE, RT_WINDOW
from app.criteria.engine import CriteriaEngine, not_evaluable
from app.criteria.models import ErrorCode, FinalResult, RuleStatus, Stream
from app.criteria.registry import REGISTRY
from app.tests.unit.criteria.factories import config, context, row, trace

ENGINE = CriteriaEngine()

TRACES = [
    trace(CUTOFF, formula="Std. Conc. of WCS1", result=Decimal("1.5")),
    trace(
        ION_RATIO_RANGE,
        formula="SPAN",
        lower_limit=Decimal("24.45"),
        upper_limit=Decimal("34.77"),
    ),
    trace(
        RT_WINDOW,
        formula="mean x (1 +/- 20%)",
        result=Decimal("4.3484"),
        lower_limit=Decimal("3.4787"),
        upper_limit=Decimal("5.2181"),
    ),
    trace(CALIBRATION_RANGE, lower_limit=Decimal(1), upper_limit=Decimal(100)),
]


def patient_rules(**overrides):
    defaults = {
        "istd": {"priority": 30, "suppression_enabled": False},
        "concentration_cutoff": {"priority": 40},
        "ion_ratio": {"priority": 50},
        "retention_time": {"priority": 60},
        "calibration_range": {"priority": 70},
    }
    return [
        config(rule_id, **{**params, **overrides.get(rule_id, {})})
        for rule_id, params in defaults.items()
    ]


def evaluate(**cells):
    cells.setdefault("istd_area", "13395265")
    return ENGINE.evaluate(row(**cells), context(traces=TRACES), patient_rules())


class TestVerdict:
    def test_a_clean_row_passes(self) -> None:
        result = evaluate(
            concentration="1.2163", ion_ratio="31.18", retention_time="4.355"
        )
        assert result.final_result is FinalResult.PASSED
        assert result.failure_codes == ()

    def test_one_failing_mandatory_rule_fails_the_row(self) -> None:
        # Spec section 13's worked example: cut-off fails, everything else passes.
        result = evaluate(
            concentration="0.6582", ion_ratio="31.18", retention_time="4.355"
        )
        assert result.final_result is FinalResult.FAILED
        assert result.failure_codes == (ErrorCode.CONCENTRATION_BELOW_CUTOFF.value,)

    def test_a_failing_non_mandatory_rule_does_not_fail_the_row(self) -> None:
        result = ENGINE.evaluate(
            row(istd_area="13395265", concentration="1.2163", ion_ratio="72.5",
                retention_time="4.355"),
            context(traces=TRACES),
            patient_rules(ion_ratio={"mandatory": False}),
        )
        assert result.final_result is FinalResult.PASSED
        # The failure is still recorded — not failing the row is not the same as
        # pretending it did not happen.
        assert ErrorCode.ION_RATIO_OUT_OF_RANGE.value in result.failure_codes


class TestAllFailuresCollected:
    def test_every_failure_is_reported_not_just_the_first(self) -> None:
        """Spec section 13: do not stop at the first failure."""
        result = evaluate(
            concentration="0.6582",     # below cut-off
            ion_ratio="72.5",           # outside the ratio range
            retention_time="9.9",       # outside the RT window
        )
        assert result.final_result is FinalResult.FAILED
        assert set(result.failure_codes) == {
            ErrorCode.CONCENTRATION_BELOW_CUTOFF.value,
            ErrorCode.ION_RATIO_OUT_OF_RANGE.value,
            ErrorCode.RT_OUT_OF_RANGE.value,
        }

    def test_passing_rules_are_retained_alongside_failing_ones(self) -> None:
        # Spec section 14 wants the full evaluation, so a reviewer can see
        # "PASS - Internal Standard" next to "FAIL - Ion Ratio".
        result = evaluate(
            concentration="1.2163", ion_ratio="72.5", retention_time="4.355"
        )
        statuses = {r.rule_id: r.status for r in result.rules}
        assert statuses["istd"] is RuleStatus.PASS
        assert statuses["retention_time"] is RuleStatus.PASS
        assert statuses["ion_ratio"] is RuleStatus.FAIL

    def test_rules_run_in_configured_priority_order(self) -> None:
        result = evaluate(concentration="5", ion_ratio="30", retention_time="4.3")
        assert [r.rule_id for r in result.rules] == [
            "istd",
            "concentration_cutoff",
            "ion_ratio",
            "retention_time",
            "calibration_range",
        ]

    def test_reordering_priorities_reorders_execution(self) -> None:
        result = ENGINE.evaluate(
            row(istd_area="1", concentration="5", ion_ratio="30", retention_time="4.3"),
            context(traces=TRACES),
            patient_rules(retention_time={"priority": 1}),
        )
        assert result.rules[0].rule_id == "retention_time"


class TestConcentrationHandling:
    def test_the_original_concentration_is_never_overwritten(self) -> None:
        """Spec section 9: the original must survive every adjustment path."""
        result = evaluate(concentration="0.6582", ion_ratio="30", retention_time="4.3")
        assert result.original_concentration == Decimal("0.6582")
        assert result.adjusted_concentration == Decimal(0)
        assert result.cutoff_value == Decimal("1.5")

    def test_a_passing_row_keeps_its_concentration(self) -> None:
        result = evaluate(concentration="1.2163", ion_ratio="30", retention_time="4.3")
        assert result.original_concentration == result.adjusted_concentration

    def test_only_the_cutoff_rule_zeroes_the_concentration(self) -> None:
        # D-17: spec v2 zeroes for the cut-off only. An ion-ratio failure fails the
        # row and reports the measured value unchanged.
        result = evaluate(concentration="50", ion_ratio="72.5", retention_time="4.3")
        assert result.final_result is FinalResult.FAILED
        assert result.adjusted_concentration == Decimal(50)

    def test_a_missing_concentration_leaves_both_values_unset(self) -> None:
        result = evaluate(concentration="----", ion_ratio="30", retention_time="4.3")
        assert result.original_concentration is None


class TestContainment:
    def test_a_raising_rule_fails_only_that_row_and_names_the_rule(self, monkeypatch) -> None:
        """Spec section 5: one bad row — or one bad rule — never ends the run."""

        def explode(self, row, config, context):
            raise ZeroDivisionError("synthetic defect")

        monkeypatch.setattr(type(REGISTRY["ion_ratio"]), "evaluate", explode)

        result = evaluate(concentration="5", ion_ratio="30", retention_time="4.3")
        failing = next(r for r in result.rules if r.rule_id == "ion_ratio")
        assert failing.status is RuleStatus.FAIL
        assert failing.error_code is ErrorCode.RULE_ERROR
        assert "ZeroDivisionError" in failing.message
        # Every other rule still ran.
        assert len(result.rules) == 5
        assert next(r for r in result.rules if r.rule_id == "retention_time").passed

    def test_an_unregistered_rule_is_skipped_rather_than_crashing(self) -> None:
        result = ENGINE.evaluate(
            row(concentration="5"),
            context(traces=TRACES),
            [config("no_such_rule", priority=1)],
        )
        assert result.rules[0].status is RuleStatus.SKIPPED
        # Nothing was actually evaluated, so the row cannot be PASSED.
        assert result.final_result is FinalResult.FAILED


class TestNotEvaluable:
    def test_a_row_nothing_could_check_is_failed_never_passed(self) -> None:
        """An unchecked row must never be indistinguishable from a verified one."""
        result = ENGINE.evaluate(
            row(),  # no values at all
            context(columns={role: None for role in ("concentration", "ion_ratio")}),
            patient_rules(),
        )
        assert result.final_result is FinalResult.FAILED
        assert result.evaluated_count == 0

    def test_the_helper_produces_a_reasoned_failure(self) -> None:
        result = not_evaluable(row(), "Row is out of scope for this analytics.")
        assert result.final_result is FinalResult.FAILED
        assert result.rules[0].error_code is ErrorCode.NOT_EVALUABLE
        assert "out of scope" in result.rules[0].message


class TestStreamAndEnablement:
    def test_a_rule_for_another_stream_does_not_run(self) -> None:
        result = ENGINE.evaluate(
            row(Stream.PATIENT, percent_diff="99"),
            context(traces=TRACES),
            [config("calibration_accuracy", Stream.CALIBRATOR, tolerance_percent=25)],
        )
        assert result.rules == ()

    def test_a_disabled_rule_contributes_nothing_at_all(self) -> None:
        result = ENGINE.evaluate(
            row(concentration="0.1"),
            context(traces=TRACES),
            patient_rules(concentration_cutoff={"enabled": False}),
        )
        assert all(r.rule_id != "concentration_cutoff" for r in result.rules)
        assert ErrorCode.CONCENTRATION_BELOW_CUTOFF.value not in result.failure_codes

    def test_calibrator_rows_run_the_calibrator_rule(self) -> None:
        result = ENGINE.evaluate(
            row(Stream.CALIBRATOR, percent_diff="27.87"),
            context(),
            [config("calibration_accuracy", Stream.CALIBRATOR, tolerance_percent=25)],
        )
        assert result.final_result is FinalResult.FAILED
        assert result.failure_codes == (ErrorCode.CALIBRATION_TOLERANCE_EXCEEDED.value,)


class TestDeterminism:
    def test_the_same_inputs_always_give_the_same_verdict(self) -> None:
        # Replaying a stored result depends on this (spec section 43).
        data = row(istd_area="13395265", concentration="0.6582", ion_ratio="72.5",
                   retention_time="4.355")
        ctx = context(traces=TRACES)
        rules = patient_rules()

        first = ENGINE.evaluate(data, ctx, rules)
        for _ in range(50):
            again = ENGINE.evaluate(data, ctx, rules)
            assert again.final_result == first.final_result
            assert again.failure_codes == first.failure_codes
            assert again.adjusted_concentration == first.adjusted_concentration

    def test_evaluation_does_not_mutate_its_inputs(self) -> None:
        data = row(istd_area="1", concentration="5", ion_ratio="30", retention_time="4.3")
        before = dict(data.values)
        ENGINE.evaluate(data, context(traces=TRACES), patient_rules())
        assert dict(data.values) == before

    def test_the_engine_version_is_stamped_on_the_result(self) -> None:
        result = evaluate(concentration="5", ion_ratio="30", retention_time="4.3")
        assert result.engine_version == CriteriaEngine.VERSION


class TestResultShape:
    def test_the_evaluation_carries_the_section_14_fields(self) -> None:
        result = evaluate(concentration="0.6582", ion_ratio="30", retention_time="4.3")
        assert result.source_row_number == 1
        assert result.sample_id == "2606251021"
        assert result.analyte == "Cocaine"
        for rule in result.rules:
            assert rule.rule_id and rule.rule_name and rule.status and rule.message

    def test_results_are_immutable(self) -> None:
        result = evaluate(concentration="5", ion_ratio="30", retention_time="4.3")
        with pytest.raises(AttributeError):
            result.final_result = FinalResult.PASSED  # type: ignore[misc]
