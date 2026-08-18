"""Calibrator and control accuracy (spec sections 6 and 7)."""

from decimal import Decimal

import pytest

from app.criteria.models import ErrorCode, RuleStatus, Stream
from app.criteria.rules.calibration import CalibrationAccuracyRule
from app.criteria.rules.control import ControlAccuracyRule
from app.tests.unit.criteria.factories import config, context, row

CAL = CalibrationAccuracyRule()
CTL = ControlAccuracyRule()


def run_cal(percent_diff: str, **params):
    params.setdefault("tolerance_percent", 25)
    return CAL.evaluate(
        row(Stream.CALIBRATOR, percent_diff=percent_diff),
        config("calibration_accuracy", Stream.CALIBRATOR, **params),
        context(),
    )


def run_ctl(percent_diff: str, **params):
    params.setdefault("tolerance_percent", 25)
    return CTL.evaluate(
        row(Stream.CONTROL, percent_diff=percent_diff),
        config("control_accuracy", Stream.CONTROL, **params),
        context(),
    )


class TestCalibratorAccuracy:
    @pytest.mark.parametrize(
        "percent_diff", ["-0.22", "-7.70", "9.39", "6.08", "-1.65", "-11.46", "11.25"]
    )
    def test_the_real_passing_run(self, percent_diff: str) -> None:
        # Every calibrator in Cocaine_2026_08_01 passes at the default tolerance.
        assert run_cal(percent_diff).status is RuleStatus.PASS

    def test_the_real_failing_calibrator(self) -> None:
        # Cocaine_2026_08_02, Cal_4: 27.87% against a 25% tolerance.
        result = run_cal("27.87")
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.CALIBRATION_TOLERANCE_EXCEEDED
        assert result.original_value == "27.87"
        assert result.calculated_value == "27.87"
        assert "25" in result.threshold

    def test_the_same_value_passes_at_a_wider_tolerance(self) -> None:
        # The run's outcome is a configuration decision the laboratory owns (D-03).
        assert run_cal("27.87", tolerance_percent=30).status is RuleStatus.PASS

    def test_negative_deviations_use_the_absolute_value(self) -> None:
        assert run_cal("-27.87").status is RuleStatus.FAIL
        assert run_cal("-11.46").status is RuleStatus.PASS

    @pytest.mark.parametrize(
        ("value", "operator", "expected"),
        [
            ("25", "lte", RuleStatus.PASS),
            ("25", "lt", RuleStatus.FAIL),
            ("24.99", "lte", RuleStatus.PASS),
            ("25.01", "lte", RuleStatus.FAIL),
            ("-25", "lte", RuleStatus.PASS),
        ],
    )
    def test_the_boundary_is_configuration_not_an_accident(
        self, value: str, operator: str, expected: RuleStatus
    ) -> None:
        assert run_cal(value, tolerance_operator=operator).status is expected

    def test_a_missing_percent_diff_is_skipped_not_passed(self) -> None:
        # A skip is never a pass; the engine treats an all-skipped row as FAILED.
        assert run_cal("----").status is RuleStatus.SKIPPED
        assert run_cal("").status is RuleStatus.SKIPPED

    def test_a_non_numeric_percent_diff_fails_with_the_raw_token(self) -> None:
        result = run_cal("bad")
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.NON_NUMERIC_VALUE
        assert result.original_value == "bad"

    def test_no_percent_diff_column_skips(self) -> None:
        result = CAL.evaluate(
            row(Stream.CALIBRATOR),
            config("calibration_accuracy", Stream.CALIBRATOR, tolerance_percent=25),
            context(columns={"percent_diff": None}),
        )
        assert result.status is RuleStatus.SKIPPED

    def test_an_unconfigured_tolerance_skips_rather_than_inventing_one(self) -> None:
        result = CAL.evaluate(
            row(Stream.CALIBRATOR, percent_diff="10"),
            config("calibration_accuracy", Stream.CALIBRATOR),
            context(),
        )
        assert result.status is RuleStatus.SKIPPED

    def test_zero_percent_diff_is_a_perfect_result(self) -> None:
        assert run_cal("0").status is RuleStatus.PASS

    def test_the_result_reports_the_limits(self) -> None:
        result = run_cal("10")
        assert result.lower_limit == Decimal(-25)
        assert result.upper_limit == Decimal(25)


class TestControlAccuracy:
    @pytest.mark.parametrize("percent_diff", ["-7.16", "-2.30", "12.08"])
    def test_the_real_passing_controls(self, percent_diff: str) -> None:
        assert run_ctl(percent_diff).status is RuleStatus.PASS

    @pytest.mark.parametrize(("percent_diff", "run"), [("61.22", "02"), ("73.90", "03")])
    def test_the_real_failing_controls(self, percent_diff: str, run: str) -> None:
        result = run_ctl(percent_diff)
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.CONTROL_TOLERANCE_EXCEEDED

    def test_uc_with_the_missing_token_is_skipped(self) -> None:
        """D-09: UC cannot be validated. Skipping is neither a false failure nor a
        silent pass — it is the honest outcome, and the run is not gated on it."""
        result = run_ctl("----")
        assert result.status is RuleStatus.SKIPPED
        assert "No % Diff" in result.message

    def test_the_tolerance_is_independent_of_the_calibration_tolerance(self) -> None:
        # Spec section 7: control tolerance is its own configured value (D-04).
        assert run_ctl("27", tolerance_percent=30).status is RuleStatus.PASS
        assert run_cal("27", tolerance_percent=25).status is RuleStatus.FAIL

    def test_the_boundary(self) -> None:
        assert run_ctl("25").status is RuleStatus.PASS
        assert run_ctl("25", tolerance_operator="lt").status is RuleStatus.FAIL
