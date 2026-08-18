"""Streaming CSV parsing (spec sections 5 and 32)."""

import io
from pathlib import Path

import pytest

from app.processing.csv_parser import CsvInvalid, detect_delimiter, detect_encoding, parse

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def parse_bytes(data: bytes):
    summary, rows = parse(io.BytesIO(data))
    return summary, list(rows)


class TestHeader:
    def test_header_is_preserved_verbatim_and_in_order(self) -> None:
        # The PASSED output has to reproduce the source header exactly.
        summary, _ = parse_bytes(b"Analyte Name,Sample ID,%Diff\nCocaine,Cal_1,-0.22\n")
        assert summary.columns == ["Analyte Name", "Sample ID", "%Diff"]

    def test_blank_header_cells_become_addressable(self) -> None:
        summary, rows = parse_bytes(b"A,,C\n1,2,3\n")
        assert summary.columns == ["A", "Column 2", "C"]
        assert rows[0].values["Column 2"] == "2"

    def test_duplicate_headers_are_renamed_rather_than_dropped(self) -> None:
        # A row dict would silently lose one of the two columns otherwise, hiding
        # data the operator can plainly see in the file.
        summary, rows = parse_bytes(b"A,A,B\n1,2,3\n")
        assert summary.columns == ["A", "A (2)", "B"]
        assert rows[0].values == {"A": "1", "A (2)": "2", "B": "3"}
        assert any("Duplicate column" in w for w in summary.warnings)

    def test_a_file_with_no_header_is_refused(self) -> None:
        with pytest.raises(CsvInvalid):
            parse_bytes(b"")

    def test_a_whitespace_only_file_is_refused(self) -> None:
        with pytest.raises(CsvInvalid):
            parse_bytes(b"   \n  \n")


class TestRows:
    def test_source_row_numbers_are_one_based_excluding_the_header(self) -> None:
        _, rows = parse_bytes(b"A\n1\n2\n3\n")
        assert [r.source_row_number for r in rows] == [1, 2, 3]

    def test_blank_rows_are_skipped_counted_and_not_returned(self) -> None:
        # Spec section 5: a blank spacer row is a formatting artefact, not a sample,
        # and must never reach the exception report.
        summary, rows = parse_bytes(b"A,B\n1,2\n,\n   ,  \n3,4\n")
        assert [r.source_row_number for r in rows] == [1, 4]
        assert summary.empty_rows == 2
        assert summary.total_rows == 2
        assert all(not r.is_malformed for r in rows)

    def test_a_short_row_is_flagged_not_fatal(self) -> None:
        summary, rows = parse_bytes(b"A,B,C\n1,2,3\n4,5\n6,7,8\n")
        assert len(rows) == 3
        assert rows[1].is_malformed is True
        assert rows[1].values == {"A": "4", "B": "5", "C": ""}
        assert rows[1].warnings
        assert summary.malformed_rows == 1
        # The rows either side are untouched: one bad row never ends the run.
        assert rows[0].is_malformed is False and rows[2].is_malformed is False

    def test_a_long_row_keeps_its_extra_fields(self) -> None:
        _, rows = parse_bytes(b"A,B\n1,2,3,4\n")
        assert rows[0].is_malformed is True
        assert rows[0].values["__extra__"] == "3,4"

    def test_quoted_fields_with_commas_and_newlines(self) -> None:
        _, rows = parse_bytes(b'A,B\n"one, two","line\nbreak"\n')
        assert rows[0].values["A"] == "one, two"
        assert rows[0].values["B"] == "line\nbreak"

    def test_values_are_returned_verbatim(self) -> None:
        # No trimming, no coercion: "----" stays "----" and " 4.348 " keeps its spaces
        # until a rule interprets it.
        _, rows = parse_bytes(b"A,B\n----, 4.348 \n")
        assert rows[0].values == {"A": "----", "B": " 4.348 "}


class TestEncodingAndDelimiter:
    def test_utf8_bom_is_stripped_from_the_first_header(self) -> None:
        summary, _ = parse_bytes("﻿Sample ID,Value\nCal_1,1\n".encode())
        assert summary.columns[0] == "Sample ID"

    def test_latin1_bytes_do_not_crash_the_parse(self) -> None:
        summary, rows = parse_bytes("Naïve,B\ncafé,2\n".encode("cp1252"))
        assert summary.encoding in ("cp1252", "latin-1")
        assert len(rows) == 1

    @pytest.mark.parametrize(
        ("data", "expected"),
        [
            (b"a,b,c\n1,2,3\n", ","),
            (b"a;b;c\n1;2;3\n", ";"),
            (b"a\tb\tc\n1\t2\t3\n", "\t"),
        ],
    )
    def test_delimiters_are_sniffed(self, data: bytes, expected: str) -> None:
        summary, rows = parse_bytes(data)
        assert summary.delimiter == expected
        assert len(summary.columns) == 3
        assert len(rows) == 1

    def test_a_single_column_file_defaults_to_comma(self) -> None:
        summary, rows = parse_bytes(b"OnlyColumn\nvalue\n")
        assert summary.delimiter == ","
        assert rows[0].values == {"OnlyColumn": "value"}

    def test_detect_helpers(self) -> None:
        assert detect_encoding(b"plain ascii") == "utf-8"
        assert detect_delimiter("a;b\n1;2") == ";"


class TestRealInstrumentFiles:
    @pytest.mark.parametrize(
        ("name", "expected_rows"),
        [
            ("Cocaine_2026_08_01.csv", 129),
            ("Cocaine_2026_08_02.csv", 175),
            ("Cocaine_2026_08_03.csv", 108),
            ("Cocaine_2026_08_04.csv", 152),
        ],
    )
    def test_every_real_export_parses_cleanly(self, name: str, expected_rows: int) -> None:
        with (FIXTURES / name).open("rb") as handle:
            summary, rows = parse(handle)
            rows = list(rows)
        assert summary.total_rows == expected_rows
        assert len(rows) == expected_rows
        assert summary.malformed_rows == 0
        assert summary.empty_rows == 0
        assert summary.columns[:5] == [
            "Analyte Name",
            "Flags",
            "Data Filename",
            "Sample ID",
            "Sample Type",
        ]
        # The instrument writes "%Diff"; the specification writes "% Diff".
        assert "%Diff" in summary.columns

    def test_the_instrument_missing_token_survives_parsing(self) -> None:
        with (FIXTURES / "Cocaine_2026_08_01.csv").open("rb") as handle:
            _, rows = parse(handle)
            uc = next(r for r in rows if r.values["Sample ID"] == "UC")
        assert uc.values["%Diff"] == "----"


class TestLargeFiles:
    def test_memory_stays_bounded_on_a_large_file(self) -> None:
        """Rows are yielded lazily, so the parser never holds the file.

        Consuming 200 000 rows while keeping only a running count must not grow the
        interpreter's allocated blocks — that is the property a 500 000-row export
        depends on (spec section 32).
        """
        import tracemalloc

        header = b"A,B,C\n"
        body = b"1,2,3\n" * 200_000
        stream = io.BytesIO(header + body)

        tracemalloc.start()
        _, rows = parse(stream)
        baseline = tracemalloc.take_snapshot()
        count = sum(1 for _ in rows)
        peak = tracemalloc.take_snapshot()
        tracemalloc.stop()

        assert count == 200_000
        growth = sum(s.size_diff for s in peak.compare_to(baseline, "filename"))
        assert growth < 5_000_000, f"parser retained {growth} bytes"
