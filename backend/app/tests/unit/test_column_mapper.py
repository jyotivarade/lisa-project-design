"""Column role resolution (spec section 5)."""

from app.core.rule_catalog import DEFAULT_COLUMN_ROLE_PATTERNS
from app.processing.column_mapper import resolve

REAL_HEADER = [
    "Analyte Name", "Flags", "Data Filename", "Sample ID", "Sample Type", "Level",
    "Area", "ISTD Area", "Found RT", "Ref 1 Set Ratio", "Ref 1 Actual Ratio",
    "Cal Point", "Std. Conc. (ng/mL)", "Conc. (ng/mL)", "%Diff", "S/N",
    "Acquired Date", "Sample Name", "Width(50%)",
]


class TestRealInstrumentHeader:
    def test_every_needed_role_binds(self) -> None:
        mapping = resolve(REAL_HEADER, DEFAULT_COLUMN_ROLE_PATTERNS)
        assert mapping.column("sample_id") == "Sample ID"
        assert mapping.column("sample_type") == "Sample Type"
        assert mapping.column("istd_area") == "ISTD Area"
        assert mapping.column("retention_time") == "Found RT"
        assert mapping.column("ion_ratio") == "Ref 1 Actual Ratio"
        assert mapping.column("analyte_name") == "Analyte Name"

    def test_percent_diff_binds_despite_the_spelling_difference(self) -> None:
        # The instrument writes "%Diff"; the specification writes "% Diff". Literal
        # header equality would leave the calibration rule unable to run at all.
        assert resolve(REAL_HEADER, DEFAULT_COLUMN_ROLE_PATTERNS).column("percent_diff") == "%Diff"

    def test_concentration_and_std_concentration_do_not_collide(self) -> None:
        # "Conc. (ng/mL)" and "Std. Conc. (ng/mL)" both look like concentration.
        # Binding both to one role would make the cut-off read the wrong column.
        mapping = resolve(REAL_HEADER, DEFAULT_COLUMN_ROLE_PATTERNS)
        assert mapping.column("concentration") == "Conc. (ng/mL)"
        assert mapping.column("std_concentration") == "Std. Conc. (ng/mL)"

    def test_ion_ratio_prefers_the_actual_over_the_set_ratio(self) -> None:
        mapping = resolve(REAL_HEADER, DEFAULT_COLUMN_ROLE_PATTERNS)
        assert mapping.column("ion_ratio") != "Ref 1 Set Ratio"

    def test_absent_recovery_columns_are_reported_as_unmapped(self) -> None:
        # No real export carries % Recovery — this is D-05, visible in the mapping
        # rather than discovered when a rule silently does nothing.
        mapping = resolve(REAL_HEADER, DEFAULT_COLUMN_ROLE_PATTERNS)
        assert mapping.column("recovery") is None
        assert mapping.column("avg_recovery") is None
        assert "recovery" in mapping.unmapped


class TestBehaviour:
    def test_an_unmapped_role_returns_an_empty_value_rather_than_raising(self) -> None:
        mapping = resolve(["A"], {"sample_id": ["^nothing$"]})
        assert mapping.value({"A": "1"}, "sample_id") == ""

    def test_an_override_wins_over_pattern_matching(self) -> None:
        mapping = resolve(
            REAL_HEADER,
            DEFAULT_COLUMN_ROLE_PATTERNS,
            overrides={"percent_diff": "Ref 1 Set Ratio"},
        )
        assert mapping.column("percent_diff") == "Ref 1 Set Ratio"

    def test_an_override_naming_a_missing_column_is_ignored(self) -> None:
        mapping = resolve(
            REAL_HEADER, DEFAULT_COLUMN_ROLE_PATTERNS, overrides={"percent_diff": "Nope"}
        )
        assert mapping.column("percent_diff") == "%Diff"

    def test_pattern_order_expresses_preference(self) -> None:
        mapping = resolve(["Second", "First"], {"role": ["^First$", "^Second$"]})
        assert mapping.column("role") == "First"

    def test_matching_ignores_case_and_surrounding_space(self) -> None:
        assert resolve(["  sample id  "], {"sample_id": [r"^sample\s*id$"]}).column(
            "sample_id"
        ) == "  sample id  "

    def test_mapped_and_unmapped_are_reported_separately(self) -> None:
        mapping = resolve(["A"], {"found": ["^A$"], "missing": ["^Z$"]})
        assert mapping.mapped == {"found": "A"}
        assert mapping.unmapped == ["missing"]
