"""File management endpoints (spec sections 4 and 24)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import StreamingResponse

from app.api.deps import DbSession, RequestCtx, require_permission
from app.audit import record
from app.auth.permissions import Perm
from app.core.errors import NotFoundError
from app.core.pagination import Page, PageParams
from app.models import User
from app.models.enums import AuditAction, SampleStream
from app.processing.column_mapper import resolve
from app.repositories import analytics_repository as analytics_repo
from app.repositories import file_repository as repo
from app.schemas.file import (
    FilePreview,
    PreviewRow,
    SessionSummary,
    UploadedFileDetail,
    UploadedFileRead,
    UploadResponse,
    UploadResult,
)
from app.services import analytics_service, file_service

router = APIRouter(tags=["files"])

FileReader = Annotated[User, Depends(require_permission(Perm.FILES_READ))]
FileUploader = Annotated[User, Depends(require_permission(Perm.FILES_UPLOAD))]
FileDownloader = Annotated[User, Depends(require_permission(Perm.FILES_DOWNLOAD))]

MAX_PREVIEW_ROWS = 200


@router.post(
    "/analytics/{analytics_id}/files",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload one or more CSV files",
)
def upload_files(
    analytics_id: uuid.UUID,
    actor: FileUploader,
    db: DbSession,
    context: RequestCtx,
    files: Annotated[list[UploadFile], File()],
) -> UploadResponse:
    """Unlimited uploads per analytics. Nothing is ever overwritten (section 4)."""
    analytics = analytics_service.get(db, analytics_id)
    results: list[UploadResult] = []

    for upload in files:
        outcome = file_service.upload(
            db,
            analytics=analytics,
            filename=upload.filename or "upload.csv",
            content_type=upload.content_type,
            stream=upload.file,
            actor_id=actor.id,
            context=context,
        )
        warnings = list(outcome.parse.warnings) if outcome.parse else []
        if outcome.duplicate_of is not None:
            # Flagged, not refused: a lab may legitimately reprocess identical bytes.
            warnings.insert(
                0,
                f"Identical content was already uploaded as "
                f"'{outcome.duplicate_of.original_filename}'.",
            )
        results.append(
            UploadResult(
                file=UploadedFileRead.model_validate(outcome.uploaded_file),
                session=SessionSummary.model_validate(outcome.session),
                warnings=warnings,
                duplicate_of_id=outcome.duplicate_of.id if outcome.duplicate_of else None,
            )
        )

    db.commit()
    return UploadResponse(results=results)


@router.get(
    "/analytics/{analytics_id}/files",
    response_model=Page[UploadedFileRead],
    summary="Files uploaded to an analytics",
)
def list_analytics_files(
    analytics_id: uuid.UUID,
    _: FileReader,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Page[UploadedFileRead]:
    analytics_service.get(db, analytics_id)
    params = PageParams(page=page, page_size=page_size)
    rows, total = repo.list_files(
        db, limit=params.page_size, offset=params.offset, analytics_id=analytics_id
    )
    return Page[UploadedFileRead].build(
        [UploadedFileRead.model_validate(row) for row in rows], total, params
    )


@router.get("/files", response_model=Page[UploadedFileDetail], summary="All uploaded files")
def list_files(
    _: FileReader,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Page[UploadedFileDetail]:
    params = PageParams(page=page, page_size=page_size)
    rows, total = repo.list_files(db, limit=params.page_size, offset=params.offset)
    items = []
    for row in rows:
        detail = UploadedFileDetail.model_validate(row)
        analytics = analytics_repo.get(db, row.analytics_id)
        detail.analytics_name = analytics.name if analytics else None
        detail.sessions = [SessionSummary.model_validate(s) for s in row.sessions]
        items.append(detail)
    return Page[UploadedFileDetail].build(items, total, params)


@router.get("/files/{file_id}", response_model=UploadedFileDetail, summary="File detail")
def get_file(file_id: uuid.UUID, _: FileReader, db: DbSession) -> UploadedFileDetail:
    uploaded = file_service.get_file(db, file_id)
    detail = UploadedFileDetail.model_validate(uploaded)
    analytics = analytics_repo.get(db, uploaded.analytics_id)
    detail.analytics_name = analytics.name if analytics else None
    detail.sessions = [SessionSummary.model_validate(s) for s in uploaded.sessions]
    return detail


@router.get("/files/{file_id}/preview", response_model=FilePreview, summary="File preview")
def preview_file(
    file_id: uuid.UUID,
    _: FileReader,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=MAX_PREVIEW_ROWS)] = 50,
    stream: str | None = None,
) -> FilePreview:
    uploaded = file_service.get_file(db, file_id)
    session = repo.latest_session(db, file_id)
    if session is None:
        raise NotFoundError("This file has not been parsed yet.")

    snapshot = session.config_snapshot
    columns = uploaded.header_columns or []
    mapping = resolve(
        columns, snapshot["column_role_patterns"], snapshot.get("column_mappings")
    )

    counts = {
        member.value: repo.count_rows(db, session.id, member.value) for member in SampleStream
    }
    warnings: list[str] = []
    if uploaded.empty_rows:
        warnings.append(f"{uploaded.empty_rows} completely blank row(s) were skipped.")
    if uploaded.malformed_rows:
        warnings.append(f"{uploaded.malformed_rows} malformed row(s) were flagged.")
    for role in mapping.unmapped:
        warnings.append(f"No column matched the '{role}' role in this file.")
    if uploaded.is_duplicate:
        warnings.append("Identical content was uploaded before.")

    rows = repo.preview_rows(db, session.id, limit=limit, stream=stream)
    return FilePreview(
        file=UploadedFileRead.model_validate(uploaded),
        session=SessionSummary.model_validate(session),
        columns=columns,
        column_mappings=mapping.roles,
        unmapped_roles=mapping.unmapped,
        stream_counts={k: v for k, v in counts.items() if v},
        warnings=warnings,
        rows=[
            PreviewRow(
                source_row_number=row.source_row_number,
                stream=row.stream,
                sample_id=row.sample_id,
                sample_type=row.sample_type,
                analyte_name=row.analyte_name,
                classification_reason=row.classification_reason,
                is_malformed=row.is_malformed,
                values=row.raw,
            )
            for row in rows
        ],
        row_limit=limit,
    )


@router.get("/files/{file_id}/download", summary="Download the original file")
def download_original(
    file_id: uuid.UUID, actor: FileDownloader, db: DbSession, context: RequestCtx
) -> StreamingResponse:
    uploaded = file_service.get_file(db, file_id)
    handle = file_service.open_original(uploaded)

    record(
        db,
        action=AuditAction.FILE_DOWNLOADED,
        actor_id=actor.id,
        entity_type="uploaded_file",
        entity_id=uploaded.id,
        analytics_id=uploaded.analytics_id,
        metadata={"kind": "original"},
        context=context,
    )
    db.commit()

    def chunks():
        with handle:
            while chunk := handle.read(65_536):
                yield chunk

    # The stored bytes, untouched — never regenerated (spec section 18).
    return StreamingResponse(
        chunks(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{uploaded.original_filename}"',
            "Content-Length": str(uploaded.size_bytes),
        },
    )
