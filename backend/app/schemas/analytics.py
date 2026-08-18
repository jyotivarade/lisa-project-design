"""Analytics DTOs."""

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

CODE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class AnalyticsCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=2000)
    analyte_name: str = Field(min_length=1, max_length=200)

    @field_validator("code")
    @classmethod
    def _slug(cls, value: str) -> str:
        code = value.strip().lower()
        if not CODE_PATTERN.match(code):
            raise ValueError(
                "Must start with a letter or digit and contain only lowercase letters, "
                "digits, hyphens and underscores."
            )
        return code

    @field_validator("name", "analyte_name")
    @classmethod
    def _trim(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Must not be blank.")
        return trimmed


class AnalyticsUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    analyte_name: str | None = Field(default=None, min_length=1, max_length=200)
    is_active: bool | None = None


class AnalyticsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    code: str
    description: str | None
    analyte_name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    created_by_id: uuid.UUID | None
    updated_by_id: uuid.UUID | None
    configuration_version: int | None = None


class AnalyticsListItem(AnalyticsRead):
    """The Analytics list columns (spec section 17).

    Counts are zero on a fresh analytics and stay zero until a file is uploaded —
    nothing here is simulated.
    """

    file_count: int = 0
    session_count: int = 0
    last_uploaded_at: datetime | None = None
    last_session_state: str | None = None
    calibration_status: str | None = None
    control_status: str | None = None
    patient_processing_status: str | None = None
