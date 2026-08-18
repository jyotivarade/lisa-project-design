"""Row classification (spec sections 5 and 28)."""

import pytest

from app.core.rule_catalog import DEFAULT_CLASSIFICATION_RULES
from app.models.enums import SampleStream
from app.processing.classifier import classify, compile_rules

RULES = compile_rules(DEFAULT_CLASSIFICATION_RULES)


def stream(sample_id: str, sample_type: str) -> SampleStream:
    return classify(sample_id, sample_type, RULES).stream


class TestRealData:
    @pytest.mark.parametrize("identifier", [f"Cal_{n}" for n in range(1, 8)])
    def test_calibrators(self, identifier: str) -> None:
        assert stream(identifier, "Standard") is SampleStream.CALIBRATOR

    @pytest.mark.parametrize("identifier", ["WCS1", "WCS2", "WCS3"])
    def test_required_controls(self, identifier: str) -> None:
        assert stream(identifier, "Control") is SampleStream.CONTROL

    def test_uc_is_a_control_not_a_patient(self) -> None:
        # Real files carry UC with Sample Type = Control and %Diff = "----".
        # Treating it as a patient row would be a safety defect (D-09).
        assert stream("UC", "Control") is SampleStream.CONTROL

    @pytest.mark.parametrize("identifier", ["2606251021", "2606251037", "2606262003"])
    def test_patients(self, identifier: str) -> None:
        assert stream(identifier, "Unknown") is SampleStream.PATIENT


class TestSampleTypeAndIdTogether:
    def test_a_numeric_id_with_the_wrong_type_is_not_a_patient(self) -> None:
        """Spec section 5 requires Sample Type AND Sample ID.

        Classifying on the id alone would let a mislabelled standard be processed
        as a patient result.
        """
        assert stream("2606251021", "Standard") is not SampleStream.PATIENT
        assert stream("2606251021", "") is not SampleStream.PATIENT

    def test_a_calibrator_id_with_the_wrong_type_is_not_a_calibrator(self) -> None:
        assert stream("Cal_1", "Unknown") is not SampleStream.CALIBRATOR

    def test_a_control_id_with_the_wrong_type_is_not_a_control(self) -> None:
        assert stream("WCS1", "Unknown") is not SampleStream.CONTROL


class TestNonPatientRows:
    @pytest.mark.parametrize("identifier", ["BLANK", "Double Blank", "DBLK", "blank"])
    def test_blanks_are_never_patients_whatever_their_type(self, identifier: str) -> None:
        # These match id_only at the highest priority precisely so a blank labelled
        # "Unknown" cannot fall through to the patient rule.
        for sample_type in ("Unknown", "Standard", "Control", ""):
            assert stream(identifier, sample_type) is SampleStream.OTHER

    def test_an_unrecognised_row_is_other_not_patient(self) -> None:
        assert stream("MYSTERY-42", "Something") is SampleStream.OTHER

    def test_an_empty_row_identity_is_other(self) -> None:
        assert stream("", "") is SampleStream.OTHER


class TestOrdering:
    def test_first_match_wins_by_priority(self) -> None:
        rules = compile_rules(
            [
                {
                    "priority": 1, "stream": "OTHER", "match_mode": "id_only",
                    "sample_id_pattern": r"^\d+$", "sample_type_pattern": ".*", "label": "first",
                },
                {
                    "priority": 2, "stream": "PATIENT", "match_mode": "both",
                    "sample_id_pattern": r"^\d+$", "sample_type_pattern": "^Unknown$",
                    "label": "second",
                },
            ]
        )
        result = classify("123", "Unknown", rules)
        assert result.stream is SampleStream.OTHER
        assert result.reason == "first"

    def test_the_matching_rule_is_reported(self) -> None:
        # The UI must be able to answer "why is this a control?" with the reason
        # rather than leaving a reviewer to guess.
        assert classify("WCS1", "Control", RULES).reason == "Quality control"
        assert "not required" in classify("UC", "Control", RULES).reason

    def test_no_match_falls_back_to_other_with_a_reason(self) -> None:
        rules = compile_rules(
            [
                {
                    "priority": 1, "stream": "PATIENT", "match_mode": "both",
                    "sample_id_pattern": "^never$", "sample_type_pattern": "^never$",
                    "label": "unreachable",
                }
            ]
        )
        result = classify("anything", "at all", rules)
        assert result.stream is SampleStream.OTHER
        assert "No classification rule matched" in result.reason


class TestConfigurability:
    def test_classification_is_data_not_code(self) -> None:
        # A laboratory using "STD_1" and "QC-A" must be able to express that in
        # configuration alone.
        rules = compile_rules(
            [
                {
                    "priority": 10, "stream": "CALIBRATOR", "match_mode": "both",
                    "sample_id_pattern": r"^STD_\d+$", "sample_type_pattern": "^Calibrator$",
                    "label": "House calibrator",
                },
                {
                    "priority": 20, "stream": "CONTROL", "match_mode": "id_only",
                    "sample_id_pattern": r"^QC-[A-Z]$", "sample_type_pattern": ".*",
                    "label": "House control",
                },
            ]
        )
        assert classify("STD_3", "Calibrator", rules).stream is SampleStream.CALIBRATOR
        assert classify("QC-A", "whatever", rules).stream is SampleStream.CONTROL
        # And the shipped defaults then mean nothing for that lab.
        assert classify("Cal_1", "Standard", rules).stream is SampleStream.OTHER

    def test_matching_is_case_insensitive(self) -> None:
        assert stream("cal_1", "standard") is SampleStream.CALIBRATOR

    def test_surrounding_whitespace_is_ignored(self) -> None:
        assert stream("  Cal_1  ", " Standard ") is SampleStream.CALIBRATOR
