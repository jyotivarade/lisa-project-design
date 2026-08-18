"""Parse one uploaded file into one processing session's rows.

Memory stays O(batch), not O(file): the parser yields rows lazily and they are
persisted in batches, so a 500 000-row export costs the same as a 129-row one.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.criteria.values import TokenSet
from app.models import ProcessingRow, ProcessingSession, UploadedFile
from app.models.enums import ProcessingState, SampleStream, UploadStatus
from app.processing.classifier import classify, compile_rules
from app.processing.column_mapper import ColumnMapping, resolve
from app.processing.csv_parser import CsvInvalid, ParseSummary, parse
from app.services import state_machine
from app.storage import FileStorage

logger = logging.getLogger(__name__)

BATCH_SIZE = 1_000


@dataclass
class ParseResult:
    summary: ParseSummary
    mapping: ColumnMapping
    stream_counts: dict[str, int] = field(default_factory=dict)
    detected_analytes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def parse_session(
    db: Session,
    *,
    session: ProcessingSession,
    uploaded_file: UploadedFile,
    storage: FileStorage,
    analyte_name: str,
) -> ParseResult:
    """Parse, classify and persist. Moves the session to CALIBRATION_REVIEW."""
    state_machine.transition(db, session, ProcessingState.VALIDATING, reason="Parsing started")
    db.flush()

    snapshot: dict[str, Any] = session.config_snapshot
    rules = compile_rules(snapshot["classification"])
    tokens = TokenSet.from_config(snapshot.get("value_tokens", {}))
    scope_policy = snapshot.get("analyte_scope_policy", "STRICT")

    try:
        with storage.open(uploaded_file.stored_filename) as handle:
            summary, rows = parse(handle)
            mapping = resolve(
                summary.columns,
                snapshot["column_role_patterns"],
                snapshot.get("column_mappings"),
            )
            counts, analytes = _persist_rows(
                db,
                session=session,
                rows=rows,
                mapping=mapping,
                rules=rules,
                tokens=tokens,
                analyte_name=analyte_name,
                scope_policy=scope_policy,
            )
    except CsvInvalid as exc:
        session.error_code = exc.error_code
        session.error_message = exc.message
        uploaded_file.status = UploadStatus.INVALID.value
        uploaded_file.validation_errors = [{"issue": exc.message}]
        state_machine.transition(
            db, session, ProcessingState.PROCESSING_FAILED, reason=exc.message
        )
        db.flush()
        raise

    warnings = list(summary.warnings)
    if summary.empty_rows:
        # Counted and reported, never silently dropped and never a failed record.
        warnings.append(
            f"{summary.empty_rows} completely blank row(s) were skipped."
        )
    if summary.malformed_rows:
        warnings.append(
            f"{summary.malformed_rows} malformed row(s) were flagged for the exception report."
        )
    for role in mapping.unmapped:
        warnings.append(f"No column matched the '{role}' role in this file.")

    uploaded_file.status = UploadStatus.PARSED.value
    uploaded_file.header_columns = summary.columns
    uploaded_file.total_rows = summary.total_rows
    uploaded_file.empty_rows = summary.empty_rows
    uploaded_file.malformed_rows = summary.malformed_rows
    uploaded_file.detected_analytes = analytes

    session.total_rows = summary.total_rows
    session.calibrator_rows = counts.get(SampleStream.CALIBRATOR.value, 0)
    session.control_rows = counts.get(SampleStream.CONTROL.value, 0)
    session.patient_rows = counts.get(SampleStream.PATIENT.value, 0)
    session.other_rows = counts.get(SampleStream.OTHER.value, 0) + counts.get(
        SampleStream.NOT_IN_SCOPE.value, 0
    )
    session.skipped_rows = summary.empty_rows

    state_machine.transition(
        db,
        session,
        ProcessingState.CALIBRATION_REVIEW,
        reason=f"Parsed {summary.total_rows} rows",
    )
    db.flush()

    logger.info(
        "session parsed",
        extra={"session_id": str(session.id), "rows": summary.total_rows, **counts},
    )
    return ParseResult(
        summary=summary,
        mapping=mapping,
        stream_counts=counts,
        detected_analytes=analytes,
        warnings=warnings,
    )


def _persist_rows(
    db: Session,
    *,
    session: ProcessingSession,
    rows,  # Iterator[ParsedRow]
    mapping: ColumnMapping,
    rules,
    tokens: TokenSet,
    analyte_name: str,
    scope_policy: str,
) -> tuple[dict[str, int], list[str]]:
    counts: dict[str, int] = {}
    analytes: dict[str, None] = {}
    batch: list[dict[str, Any]] = []
    wanted = analyte_name.strip().casefold()

    for row in rows:
        sample_id = mapping.value(row.values, "sample_id").strip()
        sample_type = mapping.value(row.values, "sample_type").strip()
        row_analyte = mapping.value(row.values, "analyte_name").strip()
        if row_analyte:
            analytes.setdefault(row_analyte, None)

        classification = classify(sample_id, sample_type, rules)
        stream = classification.stream
        reason = classification.reason

        # D-13: under STRICT, a row for a different analyte is counted and listed
        # but never processed. Silently evaluating it against this assay's
        # calibration would be the dangerous alternative.
        if (
            scope_policy == "STRICT"
            and row_analyte
            and row_analyte.casefold() != wanted
            and stream is not SampleStream.OTHER
        ):
            stream = SampleStream.NOT_IN_SCOPE
            reason = f"Analyte '{row_analyte}' is not '{analyte_name}' for this analytics."

        counts[stream.value] = counts.get(stream.value, 0) + 1
        batch.append(
            {
                "session_id": session.id,
                "source_row_number": row.source_row_number,
                "raw": row.values,
                "stream": stream.value,
                "sample_id": sample_id or None,
                "sample_type": sample_type or None,
                "analyte_name": row_analyte or None,
                "classification_reason": reason,
                "is_malformed": row.is_malformed,
                "parse_warnings": row.warnings or None,
            }
        )

        if len(batch) >= BATCH_SIZE:
            db.bulk_insert_mappings(ProcessingRow, batch)
            batch.clear()

    if batch:
        db.bulk_insert_mappings(ProcessingRow, batch)
    db.flush()
    return counts, list(analytes)
