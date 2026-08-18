"""Derived limits and their traces (spec sections 9–12)."""

from decimal import Decimal

import pytest

from app.criteria.derivations import (
    CALIBRATION_RANGE,
    CUTOFF,
    ION_RATIO_RANGE,
    ISTD_BASIS,
    RT_WINDOW,
    ZERO_EXCLUDE,
    ZERO_INVALID,
    ZERO_VALID,
    derive_calibration_range,
    derive_cutoff,
    derive_ion_ratio_limits,
    derive_istd_basis,
    derive_rt_window,
)
from app.tests.unit.criteria.factories import (
    REAL_CALIBRATORS,
    REAL_CONTROLS,
    calibrator,
)


class TestIonRatioSpan:
    def test_the_specifications_worked_example(self) -> None:
        """Spec section 10: 40 and 62 at 10% must give 37.8 – 64.2."""
        trace = derive_ion_ratio_limits(
            [calibrator("Cal_1", ion_ratio="40"), calibrator("Cal_2", ion_ratio="62")],
            formula="SPAN",
            adjustment_percent=Decimal(10),
        )
        assert trace.result == Decimal(22)              # range
        assert trace.adjustment_value == Decimal("2.2")  # amount
        assert trace.lower_limit == Decimal("37.8")
        assert trace.upper_limit == Decimal("64.2")

    def test_the_real_run(self) -> None:
        # Cocaine_2026_08_01: ratios 25.31 … 33.91, range 8.60, 10% -> 0.86.
        trace = derive_ion_ratio_limits(REAL_CALIBRATORS, adjustment_percent=Decimal(10))
        assert trace.result == Decimal("8.60")
        assert trace.adjustment_value == Decimal("0.8600")
        assert trace.lower_limit == Decimal("24.4500")
        assert trace.upper_limit == Decimal("34.7700")
        assert len(trace.inputs) == 7
        assert trace.excluded == ()

    @pytest.mark.parametrize("percent", [0, 5, 10, 20, 25, 30])
    def test_the_adjustment_comes_from_configuration(self, percent: int) -> None:
        # D-02: the source material states 10%, 25% and 30% in different places, so
        # nothing may be hard-coded.
        trace = derive_ion_ratio_limits(
            [calibrator("Cal_1", ion_ratio="40"), calibrator("Cal_2", ion_ratio="60")],
            adjustment_percent=Decimal(percent),
        )
        expected = Decimal(20) * Decimal(percent) / Decimal(100)
        assert trace.adjustment_value == expected
        assert trace.lower_limit == Decimal(40) - expected


class TestIonRatioMultiplicative:
    def test_the_prototypes_reading_is_still_selectable(self) -> None:
        """D-01: the existing prototype widens multiplicatively. Same inputs, a
        materially different answer — which is why it stays explicit."""
        points = [calibrator("Cal_1", ion_ratio="40"), calibrator("Cal_2", ion_ratio="62")]
        span = derive_ion_ratio_limits(points, formula="SPAN", adjustment_percent=Decimal(10))
        mult = derive_ion_ratio_limits(
            points, formula="MULTIPLICATIVE", adjustment_percent=Decimal(10)
        )
        assert (span.lower_limit, span.upper_limit) == (Decimal("37.8"), Decimal("64.2"))
        assert (mult.lower_limit, mult.upper_limit) == (Decimal("36.0"), Decimal("68.2"))
        assert "x (1" in mult.formula


class TestZeroRatioPolicy:
    """Spec section 10's data hazard: a zero must not silently become the low bound."""

    POINTS = [
        calibrator("Cal_1", ion_ratio="0"),
        calibrator("Cal_2", ion_ratio="30"),
        calibrator("Cal_3", ion_ratio="40"),
    ]

    def test_exclude_from_range_is_the_default_behaviour(self) -> None:
        trace = derive_ion_ratio_limits(
            self.POINTS, zero_ratio_policy=ZERO_EXCLUDE, adjustment_percent=Decimal(10)
        )
        assert len(trace.inputs) == 2
        assert trace.excluded[0]["calibrator_id"] == "Cal_1"
        assert "zero" in trace.excluded[0]["reason"].lower()
        # Computed from 30 and 40 — the zero did not move the bound.
        assert trace.lower_limit == Decimal("29.0")

    def test_invalid_also_excludes_but_says_so_differently(self) -> None:
        trace = derive_ion_ratio_limits(self.POINTS, zero_ratio_policy=ZERO_INVALID)
        assert len(trace.inputs) == 2
        assert "invalid" in trace.excluded[0]["reason"].lower()

    def test_valid_lets_the_laboratory_keep_a_real_zero(self) -> None:
        trace = derive_ion_ratio_limits(
            self.POINTS, zero_ratio_policy=ZERO_VALID, adjustment_percent=Decimal(10)
        )
        assert len(trace.inputs) == 3
        assert trace.lower_limit == Decimal("-4.0")  # 0 - (40-0)*10%

    def test_an_invalid_cal_1_cannot_move_the_range_unnoticed(self) -> None:
        clean = derive_ion_ratio_limits(self.POINTS[1:], adjustment_percent=Decimal(10))
        with_zero = derive_ion_ratio_limits(self.POINTS, adjustment_percent=Decimal(10))
        assert clean.lower_limit == with_zero.lower_limit
        assert with_zero.excluded  # and the exclusion is visible, not silent


class TestExclusions:
    def test_unselected_calibrators_are_excluded_with_a_reason(self) -> None:
        points = [
            calibrator("Cal_1", ion_ratio="10", is_selected=False),
            calibrator("Cal_2", ion_ratio="30"),
            calibrator("Cal_3", ion_ratio="40"),
        ]
        trace = derive_ion_ratio_limits(points, adjustment_percent=Decimal(10))
        assert len(trace.inputs) == 2
        assert trace.excluded[0] == {
            "calibrator_id": "Cal_1",
            "value": "10",
            "reason": "Unselected by the user",
        }

    def test_missing_and_non_numeric_values_are_excluded(self) -> None:
        points = [
            calibrator("Cal_1", ion_ratio="----"),
            calibrator("Cal_2", ion_ratio="oops"),
            calibrator("Cal_3", ion_ratio="30"),
            calibrator("Cal_4", ion_ratio="40"),
        ]
        trace = derive_ion_ratio_limits(points)
        assert len(trace.inputs) == 2
        assert {e["calibrator_id"] for e in trace.excluded} == {"Cal_1", "Cal_2"}

    def test_no_usable_calibrator_makes_the_limit_unavailable(self) -> None:
        trace = derive_ion_ratio_limits([calibrator("Cal_1", ion_ratio="----")])
        assert trace.available is False
        assert trace.lower_limit is None
        assert "No selected calibrator" in trace.unavailable_reason

    def test_an_empty_calibrator_set_is_unavailable(self) -> None:
        assert derive_ion_ratio_limits([]).available is False


class TestRetentionTime:
    def test_the_real_run_average_and_window(self) -> None:
        # Real average 4.3484 min; +/-20% gives roughly 3.479 – 5.218.
        trace = derive_rt_window(REAL_CALIBRATORS, adjustment_percent=Decimal(20))
        assert trace.result == pytest.approx(Decimal("4.34842857"), abs=Decimal("0.0001"))
        assert trace.lower_limit == pytest.approx(Decimal("3.4787"), abs=Decimal("0.001"))
        assert trace.upper_limit == pytest.approx(Decimal("5.2181"), abs=Decimal("0.001"))

    def test_absolute_mode(self) -> None:
        trace = derive_rt_window(
            [calibrator("Cal_1", found_rt="4.000"), calibrator("Cal_2", found_rt="4.200")],
            mode="ABSOLUTE",
            absolute_window_minutes=Decimal("0.1"),
        )
        assert trace.result == Decimal("4.1")
        assert trace.lower_limit == Decimal("4.0")
        assert trace.upper_limit == Decimal("4.2")
        assert "min" in trace.formula

    def test_median_method(self) -> None:
        points = [
            calibrator("Cal_1", found_rt="4.0"),
            calibrator("Cal_2", found_rt="4.1"),
            calibrator("Cal_3", found_rt="9.0"),  # an outlier the mean would follow
        ]
        mean = derive_rt_window(points, average_method="MEAN")
        median = derive_rt_window(points, average_method="MEDIAN")
        assert median.result == Decimal("4.1")
        assert mean.result > median.result

    def test_median_of_an_even_count(self) -> None:
        points = [
            calibrator(f"Cal_{i}", found_rt=rt)
            for i, rt in enumerate(["4.0", "4.2", "4.4", "5.0"])
        ]
        assert derive_rt_window(points, average_method="MEDIAN").result == Decimal("4.3")

    def test_zero_and_negative_retention_times_are_excluded(self) -> None:
        points = [
            calibrator("Cal_1", found_rt="0"),
            calibrator("Cal_2", found_rt="4.0"),
            calibrator("Cal_3", found_rt="4.2"),
        ]
        trace = derive_rt_window(points)
        assert len(trace.inputs) == 2
        assert trace.result == Decimal("4.1")


class TestCutoff:
    def test_the_cutoff_comes_from_wcs1_std_conc(self) -> None:
        trace = derive_cutoff(REAL_CONTROLS, source_sample_id="WCS1")
        assert trace.result == Decimal("1.5")
        assert "WCS1" in trace.formula

    def test_the_source_control_is_configurable(self) -> None:
        trace = derive_cutoff(REAL_CONTROLS, source_sample_id="WCS2")
        assert trace.result == Decimal("2.5")

    def test_matching_is_case_insensitive(self) -> None:
        assert derive_cutoff(REAL_CONTROLS, source_sample_id="wcs1").result == Decimal("1.5")

    def test_a_missing_control_makes_the_cutoff_unavailable(self) -> None:
        trace = derive_cutoff(REAL_CONTROLS, source_sample_id="WCS9")
        assert trace.available is False
        assert "not present" in trace.unavailable_reason

    def test_a_control_with_no_usable_std_conc_is_unavailable(self) -> None:
        # UC reports "----" for Std. Conc.
        trace = derive_cutoff(REAL_CONTROLS, source_sample_id="UC")
        assert trace.available is False
        assert "no usable" in trace.unavailable_reason.lower()

    def test_a_fixed_cutoff(self) -> None:
        trace = derive_cutoff([], source="FIXED_VALUE", fixed_value=Decimal("2.0"))
        assert trace.result == Decimal("2.0")

    def test_a_fixed_cutoff_of_zero_is_unavailable(self) -> None:
        assert derive_cutoff([], source="FIXED_VALUE", fixed_value=Decimal(0)).available is False


class TestCalibrationRange:
    def test_the_real_calibrated_range(self) -> None:
        trace = derive_calibration_range(REAL_CALIBRATORS)
        assert trace.lower_limit == Decimal(1)
        assert trace.upper_limit == Decimal(100)

    def test_unselected_calibrators_do_not_define_the_range(self) -> None:
        points = list(REAL_CALIBRATORS)
        points[-1] = calibrator("Cal_7", std_concentration="100", is_selected=False)
        assert derive_calibration_range(points).upper_limit == Decimal(40)

    def test_no_usable_standard_makes_it_unavailable(self) -> None:
        assert derive_calibration_range(
            [calibrator("Cal_1", std_concentration="----")]
        ).available is False


class TestIstdBasis:
    def test_the_mean_of_usable_areas(self) -> None:
        trace = derive_istd_basis(
            [Decimal(10), Decimal(20), Decimal(30)], method="mean", source="patient rows"
        )
        assert trace.result == Decimal(20)
        assert trace.inputs[0]["count"] == 3

    def test_zero_and_negative_areas_are_ignored(self) -> None:
        trace = derive_istd_basis(
            [Decimal(0), Decimal(-5), Decimal(10), Decimal(20)],
            method="mean",
            source="patient rows",
        )
        assert trace.result == Decimal(15)

    def test_no_usable_area_makes_the_basis_unavailable(self) -> None:
        assert derive_istd_basis([Decimal(0)], method="mean", source="x").available is False


def test_trace_keys_are_stable() -> None:
    # Persisted per session and matched by key, so renaming one silently would
    # orphan every stored trace.
    assert (ION_RATIO_RANGE, RT_WINDOW, CUTOFF, CALIBRATION_RANGE, ISTD_BASIS) == (
        "ION_RATIO_RANGE",
        "RT_WINDOW",
        "CUTOFF",
        "CALIBRATION_RANGE",
        "ISTD_BASIS",
    )
