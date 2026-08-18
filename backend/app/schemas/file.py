"""File and processing-session DTOs."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_number: int
    state: str
    calibration_verdict: str
    control_verdict: str
    total_rows: int
    calibrator_rows: int
    control_rows: int
    patient_rows: int
    other_rows: int
    skipped_rows: int
    passed_count: int
    failed_count: int
    engine_version: str
    created_at: datetime
    completed_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None


class UploadedFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    analytics_id: uuid.UUID
    original_filename: str
    file_hash: str
    size_bytes: int
    content_type: str | None
    uploaded_at: datetime
    uploaded_by_id: uuid.UUID | None
    status: str
    total_rows: int | None
    empty_rows: int | None
    malformed_rows: int | None
    header_columns: list[str] | None
    detected_analytes: list[str] | None
    is_duplicate: bool
    duplicate_of_id: uuid.UUID | None
    validation_errors: list[dict[str, Any]] | None = None


class UploadedFileDetail(UploadedFileRead):
    analytics_name: str | None = None
    sessions: list[SessionSummary] = []


class UploadResult(BaseModel):
    file: UploadedFileRead
    session: SessionSummary
    warnings: list[str] = []
    duplicate_of_id: uuid.UUID | None = None


class UploadResponse(BaseModel):
    results: list[UploadResult]


class PreviewRow(BaseModel):
    source_row_number: int
    stream: str
    sample_id: str | None
    sample_type: str | None
    analyte_name: str | None
    classification_reason: str | None
    is_malformed: bool
    values: dict[str, Any]


class FilePreview(BaseModel):
    """Everything the preview screen needs, computed on the server.

    The browser never parses the CSV, so a 129-row file and a 500 000-row file
    behave identically in the client (spec section 32).
    """

    file: UploadedFileRead
    session: SessionSummary
    columns: list[str]
    column_mappings: dict[str, str | None]
    unmapped_roles: list[str]
    stream_counts: dict[str, int]
    warnings: list[str]
    rows: list[PreviewRow]
    row_limit: int
