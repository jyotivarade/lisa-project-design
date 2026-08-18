"""The five patient rules (spec sections 8–12)."""

from decimal import Decimal

import pytest

from app.criteria.derivations import (
    CALIBRATION_RANGE,
    CUTOFF,
    ION_RATIO_RANGE,
    ISTD_BASIS,
    RT_WINDOW,
)
from app.criteria.models import ErrorCode, RuleStatus, Stream
from app.criteria.rules.calibration_range import CalibrationRangeRule
from app.criteria.rules.concentration import ConcentrationCutoffRule
from app.criteria.rules.ion_ratio import IonRatioRule
from app.criteria.rules.istd import InternalStandardRule
from app.criteria.rules.retention_time import RetentionTimeRule
from app.tests.unit.criteria.factories import config, context, row, trace

ISTD = InternalStandardRule()
CUT = ConcentrationCutoffRule()
RATIO = IonRatioRule()
RT = RetentionTimeRule()
RANGE = CalibrationRangeRule()


class TestInternalStandard:
    """Spec section 8 / D-05."""

    BASIS = trace(ISTD_BASIS, formula="mean over patient rows", result=Decimal(10_000_000))

    def run(self, istd_area: str, **params):
        params.setdefault("suppression_threshold_percent", 90)
        params.setdefault("basis_method", "AUTO")
        return ISTD.evaluate(
            row(istd_area=istd_area),
            config("istd", **params),
            context(traces=[self.BASIS]),
        )

    def test_a_healthy_peak_passes(self) -> None:
        result = self.run("13395265")  # 134% of the basis
        assert result.status is RuleStatus.PASS
        assert result.metadata["assessed"] is True

    def test_the_missing_token_is_a_missing_peak_not_a_zero_area(self) -> None:
        """`----` means the instrument reported no peak. Treating it as an area of
        zero would silently turn "not measured" into "measured nothing"."""
        result = self.run("----")
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.ISTD_MISSING
        assert result.original_value == "----"

    def test_an_empty_area_is_a_missing_peak(self) -> None:
        assert self.run("").error_code is ErrorCode.ISTD_MISSING

    def test_a_non_numeric_area_is_not_a_peak(self) -> None:
        assert self.run("n/d").error_code is ErrorCode.ISTD_MISSING

    def test_suppression_below_the_threshold_fails(self) -> None:
        result = self.run("4416501")  # 44% of the basis
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.ISTD_SUPPRESSED
        assert "44" in result.calculated_value

    @pytest.mark.parametrize(
        ("area", "expected"),
        [
            ("9000000", RuleStatus.PASS),   # exactly 90%
            ("8999999", RuleStatus.FAIL),   # a hair under
            ("9000001", RuleStatus.PASS),
        ],
    )
    def test_the_threshold_boundary(self, area: str, expected: RuleStatus) -> None:
        assert self.run(area).status is expected

    def test_the_threshold_comes_from_configuration(self) -> None:
        assert self.run("5000000", suppression_threshold_percent=90).status is RuleStatus.FAIL
        assert self.run("5000000", suppression_threshold_percent=40).status is RuleStatus.PASS

    def test_missing_peak_checking_can_be_disabled(self) -> None:
        assert self.run("----", missing_peak_fails=False).status is RuleStatus.SKIPPED

    def test_suppression_checking_can_be_disabled(self) -> None:
        result = self.run("1", suppression_enabled=False)
        assert result.status is RuleStatus.PASS

    def test_the_basis_used_is_always_reported(self) -> None:
        # D-05 is open, so which basis produced a verdict must never be a guess.
        result = self.run("13395265")
        assert result.metadata["suppression_basis"] == "mean over patient rows"

    def test_recovery_columns_are_preferred_when_the_file_has_them(self) -> None:
        columns = {
            "istd_area": "ISTD Area",
            "recovery": "% Recovery",
            "avg_recovery": "Average % Recovery",
        }
        data = row()
        data = type(data)(
            source_row_number=1,
            stream=Stream.PATIENT,
            values={"ISTD Area": "1000", "% Recovery": "45", "Average % Recovery": "90"},
            sample_id="x",
        )
        result = ISTD.evaluate(
            data,
            config("istd", suppression_threshold_percent=90, basis_method="AUTO"),
            context(columns=columns, traces=[self.BASIS]),
        )
        assert result.status is RuleStatus.FAIL  # 45/90 = 50%
        assert "Recovery" in result.metadata["suppression_basis"]

    def test_requiring_recovery_columns_that_do_not_exist_reports_it(self) -> None:
        # No real export carries them, so the rule says the basis was unavailable
        # rather than quietly passing on a check it never made.
        result = self.run("13395265", basis_method="RECOVERY_COLUMNS")
        assert result.status is RuleStatus.PASS
        assert result.metadata["assessed"] is False
        assert "could not be assessed" in result.message

    def test_no_istd_column_skips(self) -> None:
        result = ISTD.evaluate(
            row(), config("istd"), context(columns={"istd_area": None})
        )
        assert result.status is RuleStatus.SKIPPED


class TestConcentrationCutoff:
    """Spec section 9."""

    CUTOFF_TRACE = trace(CUTOFF, formula="Std. Conc. (ng/mL) of WCS1", result=Decimal("1.5"))

    def run(self, concentration: str, **params):
        return CUT.evaluate(
            row(concentration=concentration),
            config("concentration_cutoff", **params),
            context(traces=[self.CUTOFF_TRACE]),
        )

    def test_below_the_cutoff_fails_and_asks_for_zeroing(self) -> None:
        # The real example from the specification: 0.6582 against a 1.5 cut-off.
        result = self.run("0.6582")
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.CONCENTRATION_BELOW_CUTOFF
        assert result.original_value == "0.6582"   # never overwritten
        assert result.zero_concentration is True
        assert result.lower_limit == Decimal("1.5")

    def test_at_or_above_the_cutoff_passes(self) -> None:
        assert self.run("1.5").status is RuleStatus.PASS
        assert self.run("1.3926").status is RuleStatus.FAIL
        assert self.run("2.4426").status is RuleStatus.PASS

    def test_the_zeroing_behaviour_is_configurable(self) -> None:
        assert self.run("0.5", zero_on_fail=False).zero_concentration is False

    def test_an_over_range_result_is_above_any_cutoff(self) -> None:
        assert self.run("N.I. High").status is RuleStatus.PASS

    def test_an_unavailable_cutoff_skips_rather_than_passes(self) -> None:
        """If the cut-off cannot be derived, this row was not checked — and the
        engine must be able to say so rather than report a pass."""
        result = CUT.evaluate(
            row(concentration="0.1"),
            config("concentration_cutoff"),
            context(traces=[trace(CUTOFF, available=False, unavailable_reason="WCS1 absent.")]),
        )
        assert result.status is RuleStatus.SKIPPED
        assert "WCS1 absent" in result.message

    def test_a_missing_concentration_skips(self) -> None:
        assert self.run("----").status is RuleStatus.SKIPPED

    def test_a_non_numeric_concentration_fails(self) -> None:
        assert self.run("oops").error_code is ErrorCode.NON_NUMERIC_VALUE

    def test_zero_is_below_the_cutoff(self) -> None:
        assert self.run("0").status is RuleStatus.FAIL


class TestIonRatio:
    """Spec section 10."""

    RANGE_TRACE = trace(
        ION_RATIO_RANGE,
        formula="SPAN",
        lower_limit=Decimal("24.45"),
        upper_limit=Decimal("34.77"),
        inputs=({"calibrator_id": "Cal_1"},),
    )

    def run(self, ion_ratio: str, ratio_trace=None):
        return RATIO.evaluate(
            row(ion_ratio=ion_ratio),
            config("ion_ratio"),
            context(traces=[ratio_trace or self.RANGE_TRACE]),
        )

    @pytest.mark.parametrize("ratio", ["31.18", "24.45", "34.77", "29.96"])
    def test_inside_the_range_passes_including_the_boundaries(self, ratio: str) -> None:
        assert self.run(ratio).status is RuleStatus.PASS

    @pytest.mark.parametrize("ratio", ["24.44", "34.78", "72.5", "0"])
    def test_outside_the_range_fails(self, ratio: str) -> None:
        result = self.run(ratio)
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.ION_RATIO_OUT_OF_RANGE

    def test_the_failure_reports_the_actual_and_the_allowed_range(self) -> None:
        # Spec section 44's example: actual 72.5, allowed 24.45 – 34.77.
        result = self.run("72.5")
        assert result.original_value == "72.5"
        assert result.threshold == "24.45 – 34.77"
        assert result.lower_limit == Decimal("24.45")
        assert result.upper_limit == Decimal("34.77")

    def test_an_unavailable_range_skips(self) -> None:
        result = self.run(
            "30", trace(ION_RATIO_RANGE, available=False, unavailable_reason="No calibrators.")
        )
        assert result.status is RuleStatus.SKIPPED

    def test_a_missing_ratio_skips(self) -> None:
        assert self.run("----").status is RuleStatus.SKIPPED

    def test_a_non_numeric_ratio_fails(self) -> None:
        assert self.run("bad").error_code is ErrorCode.NON_NUMERIC_VALUE

    def test_the_result_records_how_many_calibrators_were_used(self) -> None:
        assert self.run("30").metadata["calibrators_used"] == 1


class TestRetentionTime:
    """Spec section 11."""

    WINDOW = trace(
        RT_WINDOW,
        formula="mean retention time x (1 +/- 20%)",
        result=Decimal("4.3484"),
        lower_limit=Decimal("3.4787"),
        upper_limit=Decimal("5.2181"),
    )

    def run(self, found_rt: str, window=None):
        return RT.evaluate(
            row(retention_time=found_rt),
            config("retention_time"),
            context(traces=[window or self.WINDOW]),
        )

    @pytest.mark.parametrize("rt", ["4.355", "3.4787", "5.2181", "4.301"])
    def test_inside_the_window_passes(self, rt: str) -> None:
        assert self.run(rt).status is RuleStatus.PASS

    @pytest.mark.parametrize("rt", ["5.662", "5.660", "3.4786", "5.2182"])
    def test_outside_the_window_fails(self, rt: str) -> None:
        # 5.660 and 5.662 are real patient rows in Cocaine_2026_08_01.
        result = self.run(rt)
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.RT_OUT_OF_RANGE

    def test_the_failure_names_the_average_and_the_window(self) -> None:
        result = self.run("5.662")
        assert "4.3484" in result.message
        assert result.threshold == "3.479 – 5.218 min"

    def test_a_missing_retention_time_skips(self) -> None:
        assert self.run("----").status is RuleStatus.SKIPPED

    def test_an_unavailable_window_skips(self) -> None:
        assert self.run("4.3", trace(RT_WINDOW, available=False)).status is RuleStatus.SKIPPED


class TestCalibrationRange:
    """Spec section 12 and D-12."""

    RANGE_TRACE = trace(
        CALIBRATION_RANGE, lower_limit=Decimal(1), upper_limit=Decimal(100)
    )

    def run(self, concentration: str, **params):
        return RANGE.evaluate(
            row(concentration=concentration),
            config("calibration_range", **params),
            context(traces=[self.RANGE_TRACE]),
        )

    def test_inside_the_calibrated_range_passes(self) -> None:
        assert self.run("50").status is RuleStatus.PASS
        assert self.run("1").status is RuleStatus.PASS
        assert self.run("100").status is RuleStatus.PASS

    def test_above_the_top_calibrator_fails_as_over_range(self) -> None:
        result = self.run("150")
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.OVER_CALIBRATION_RANGE
        assert "dilution" in result.message

    def test_the_instrument_over_range_token_needs_no_derived_range(self) -> None:
        result = self.run("N.I. High")
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.OVER_CALIBRATION_RANGE

    def test_the_instrument_under_range_token(self) -> None:
        # D-12: symmetrical with N.I. High, and configurable.
        result = self.run("N.I. Low")
        assert result.status is RuleStatus.FAIL
        assert result.error_code is ErrorCode.UNDER_CALIBRATION_RANGE

    def test_flag_only_records_without_failing(self) -> None:
        result = self.run("150", over_range_action="FLAG_ONLY")
        assert result.status is RuleStatus.PASS
        assert result.metadata["flag"] == "OVER_CALIBRATION_RANGE"
        assert "Flagged only" in result.message

    def test_under_range_flag_only(self) -> None:
        result = self.run("N.I. Low", under_range_action="FLAG_ONLY")
        assert result.status is RuleStatus.PASS

    def test_a_reported_zero_is_not_a_range_excursion(self) -> None:
        # A zero is a negative result; the cut-off rule has already decided it, and
        # failing it twice would double-count one fact.
        assert self.run("0").status is RuleStatus.PASS

    def test_below_the_lowest_calibrator_fails(self) -> None:
        assert self.run("0.5").error_code is ErrorCode.UNDER_CALIBRATION_RANGE
