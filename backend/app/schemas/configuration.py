"""Configuration DTOs.

The payload shape here mirrors `app/core/rule_catalog.default_configuration_payload`
and is what gets copied verbatim into `processing_sessions.config_snapshot` (AD-1).
Structure is validated by these models; *values* are validated against the rule
catalogue in `services/configuration_validator.py`, because the bounds live in the
database, not in code.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import SampleStream

MatchMode = Literal["both", "id_only", "type_only"]
AnalyteScopePolicy = Literal["STRICT", "ALL"]


class CalibrationSettings(BaseModel):
    enabled: bool = True
    sample_type: str = Field(min_length=1, max_length=100)
    required_calibrators: list[str] = Field(min_length=0)
    minimum_required: int = Field(ge=0)


class ControlSettings(BaseModel):
    enabled: bool = True
    sample_type: str = Field(min_length=1, max_length=100)
    required_controls: list[str] = Field(min_length=0)
    discovered_optional: list[str] = Field(default_factory=list)
    minimum_required: int = Field(ge=0)


class ValueTokens(BaseModel):
    """Instrument tokens. `----` is MISSING, never numeric zero (spec section 28)."""

    missing: list[str]
    over_range: list[str]
    under_range: list[str]


class ClassificationRule(BaseModel):
    priority: int = Field(ge=0)
    stream: SampleStream
    match_mode: MatchMode
    sample_id_pattern: str
    sample_type_pattern: str
    label: str


class RuleSetting(BaseModel):
    rule_key: str
    enabled: bool
    mandatory: bool
    priority: int = Field(ge=0)
    parameters: dict[str, Any]


class CorrectionSettings(BaseModel):
    enabled: bool
    allowed_streams: list[SampleStream]
    allowed_roles: list[str]
    reason_required: bool


class OutputSettings(BaseModel):
    passed_includes_warnings: bool
    exception_includes_original_row: bool


class LimitSettings(BaseModel):
    max_upload_bytes: int = Field(gt=0)


class ConfigurationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int
    calibration: CalibrationSettings
    controls: ControlSettings
    value_tokens: ValueTokens
    classification: list[ClassificationRule]
    column_role_patterns: dict[str, list[str]]
    column_mappings: dict[str, str | None] = Field(default_factory=dict)
    analyte_scope_policy: AnalyteScopePolicy
    rules: list[RuleSetting]
    corrections: CorrectionSettings
    output: OutputSettings
    limits: LimitSettings


class ConfigurationUpdate(BaseModel):
    """A configuration edit. Always creates a new version — never an in-place update."""

    payload: ConfigurationPayload
    change_note: str | None = Field(default=None, max_length=500)


class ConfigurationRead(BaseModel):
    analytics_id: uuid.UUID
    version: int
    payload: ConfigurationPayload
    change_note: str | None
    created_at: datetime
    created_by_id: uuid.UUID | None


class ConfigurationVersionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    change_note: str | None
    created_at: datetime
    created_by_id: uuid.UUID | None
    is_active: bool = False


class ConfigurationDiffEntry(BaseModel):
    path: str
    from_value: Any = None
    to_value: Any = None
    change: Literal["added", "removed", "changed"]


class ConfigurationUpdateResult(BaseModel):
    version: int
    diff: list[ConfigurationDiffEntry]
    # Deliberately always 0: existing sessions hold their own snapshot and cannot be
    # changed by editing configuration (AD-1, spec section 35).
    affected_sessions: int = 0


class ParameterSpec(BaseModel):
    type: Literal["number", "choice", "boolean", "string"]
    label: str
    help: str = ""
    default: Any = None
    unit: str | None = None
    minimum: float | None = None
    maximum: float | None = None
    choices: list[str] | None = None


class RuleDefinitionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rule_key: str
    name: str
    description: str
    stream: str
    default_enabled: bool
    default_mandatory: bool
    default_priority: int
    parameter_schema: dict[str, ParameterSpec]
    error_codes: list[str]
