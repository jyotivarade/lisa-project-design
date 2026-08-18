"""Streaming CSV parsing (spec sections 5 and 32).

Reads row by row and never holds the file in memory. The header is captured
verbatim and in order, because the PASSED output has to reproduce it exactly.

Two policies matter here and both come from spec section 5:
  * a completely empty row is skipped, counted and warned about — never a failure
  * a malformed row is flagged and carried forward to the exception report — one
    bad row must not end the run
"""

import csv
import io
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import BinaryIO

from app.core.errors import ErrorCode, LisaError

# UTF-8 first, then the BOM-prefixed form Excel writes, then a byte-preserving
# fallback so an unexpected encoding degrades to readable text instead of failing.
ENCODINGS = ("utf-8", "utf-8-sig", "cp1252", "latin-1")
SNIFF_BYTES = 65_536
MAX_HEADER_COLUMNS = 512


class CsvInvalid(LisaError):
    status_code = 400
    error_code = ErrorCode.INVALID_CSV


@dataclass
class ParsedRow:
    source_row_number: int
    values: dict[str, str]
    is_malformed: bool = False
    warnings: list[str] = field(default_factory=list)


@dataclass
class ParseSummary:
    columns: list[str] = field(default_factory=list)
    encoding: str = "utf-8"
    delimiter: str = ","
    total_rows: int = 0
    empty_rows: int = 0
    malformed_rows: int = 0
    warnings: list[str] = field(default_factory=list)


def detect_encoding(sample: bytes) -> str:
    for encoding in ENCODINGS:
        try:
            sample.decode(encoding)
        except UnicodeDecodeError:
            continue
        return encoding
    # latin-1 decodes any byte sequence, so this is unreachable in practice.
    raise CsvInvalid("The file could not be decoded as text.")


def detect_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        # A single-column file gives the sniffer nothing to work with; a comma is
        # the right assumption for an instrument export.
        return ","


def _normalise_header(raw: list[str]) -> list[str]:
    """Trim headers and make blank or duplicate names addressable.

    Renaming a duplicate is not cosmetic: the row dict would otherwise silently
    drop one of the two columns, losing data the operator can see in the file.
    """
    seen: dict[str, int] = {}
    columns: list[str] = []
    for index, name in enumerate(raw):
        cleaned = (name or "").strip().lstrip("﻿")
        if not cleaned:
            cleaned = f"Column {index + 1}"
        if cleaned in seen:
            seen[cleaned] += 1
            cleaned = f"{cleaned} ({seen[cleaned]})"
        else:
            seen[cleaned] = 1
        columns.append(cleaned)
    return columns


def parse(stream: BinaryIO) -> tuple[ParseSummary, Iterator[ParsedRow]]:
    """Return the summary and a lazy row iterator.

    The summary's counters are filled in as the iterator is consumed, so read the
    rows first and the totals afterwards.
    """
    head = stream.read(SNIFF_BYTES)
    if not head.strip():
        raise CsvInvalid("The file is empty.")

    encoding = detect_encoding(head)
    stream.seek(0)
    text = io.TextIOWrapper(stream, encoding=encoding, newline="")
    delimiter = detect_delimiter(head.decode(encoding, errors="replace"))

    reader = csv.reader(text, delimiter=delimiter)
    try:
        raw_header = next(reader)
    except StopIteration as exc:
        raise CsvInvalid("The file has no header row.") from exc

    if len(raw_header) > MAX_HEADER_COLUMNS:
        raise CsvInvalid(
            f"The file has {len(raw_header)} columns, more than the {MAX_HEADER_COLUMNS} "
            "supported."
        )

    columns = _normalise_header(raw_header)
    summary = ParseSummary(columns=columns, encoding=encoding, delimiter=delimiter)
    if len(set(raw_header)) != len(raw_header):
        summary.warnings.append("Duplicate column names were renamed to keep both readable.")

    def rows() -> Iterator[ParsedRow]:
        number = 0
        for raw in reader:
            number += 1
            # A blank spacer row is a formatting artefact, not a sample. It is
            # counted and reported, never routed to the exception report.
            if not any(cell.strip() for cell in raw):
                summary.empty_rows += 1
                continue

            summary.total_rows += 1
            warnings: list[str] = []
            malformed = False

            if len(raw) != len(columns):
                malformed = True
                summary.malformed_rows += 1
                warnings.append(
                    f"Row has {len(raw)} fields but the header declares {len(columns)}."
                )

            values = {name: (raw[i] if i < len(raw) else "") for i, name in enumerate(columns)}
            if len(raw) > len(columns):
                values["__extra__"] = delimiter.join(raw[len(columns) :])

            yield ParsedRow(
                source_row_number=number,
                values=values,
                is_malformed=malformed,
                warnings=warnings,
            )

    return summary, rows()
