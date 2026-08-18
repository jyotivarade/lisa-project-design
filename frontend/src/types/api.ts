/**
 * Wire types.
 *
 * From Phase 3 these are generated from the API's OpenAPI schema
 * (`openapi-typescript`), so the client cannot silently drift from the contract.
 */

/** Every 4xx/5xx from LISA has this shape (spec section 25). */
export interface ApiErrorPayload {
  error_code: string;
  message: string;
  details: Array<Record<string, unknown>>;
  request_id?: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface HealthReady {
  status: "ready" | "degraded";
  environment: string;
  checks: Record<string, string>;
}

export type RoleName = "ADMIN" | "ANALYST" | "VIEWER";

export interface Role {
  id: string;
  name: RoleName;
  description: string | null;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
  role: Role;
  /** Granted permission codes, read from the database — never assumed from the role. */
  permissions: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface RoleDetail extends Role {
  permissions: string[];
}

/** Processing states (spec section 16). Mirrors app/models/enums.py. */
export type ProcessingState =
  | "UPLOADED"
  | "VALIDATING"
  | "CALIBRATION_REVIEW"
  | "CALIBRATION_FAILED"
  | "CONTROL_REVIEW"
  | "CONTROL_FAILED"
  | "READY"
  | "PROCESSING_PATIENTS"
  | "COMPLETED"
  | "PROCESSING_FAILED";

/** Why the gate refused patient processing. Returned with HTTP 409 (AD-2). */
export type GateBlockedReason =
  | "CALIBRATION_FAILED"
  | "CONTROL_FAILED"
  | "CALIBRATION_NOT_REVIEWED"
  | "CONTROL_NOT_REVIEWED"
  | "INVALID_STATE";

// --- analytics ---------------------------------------------------------------

export interface Analytics {
  id: string;
  name: string;
  code: string;
  description: string | null;
  analyte_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by_id: string | null;
  updated_by_id: string | null;
  configuration_version: number | null;
}

export interface AnalyticsListItem extends Analytics {
  file_count: number;
  session_count: number;
  last_uploaded_at: string | null;
  last_session_state: ProcessingState | null;
  calibration_status: string | null;
  control_status: string | null;
  patient_processing_status: string | null;
}

export interface AnalyticsCreate {
  name: string;
  code: string;
  description?: string | null;
  analyte_name: string;
}

// --- configuration -----------------------------------------------------------

/**
 * A rule parameter as the catalogue describes it. Type, bounds, choices and units
 * all come from the server, which is why the Configuration UI can render a form
 * for a rule it has never heard of — and why no threshold lives in this codebase.
 */
export interface ParameterSpec {
  type: "number" | "choice" | "boolean" | "string";
  label: string;
  help: string;
  default: unknown;
  unit: string | null;
  minimum: number | null;
  maximum: number | null;
  choices: string[] | null;
}

export interface RuleDefinition {
  rule_key: string;
  name: string;
  description: string;
  stream: string;
  default_enabled: boolean;
  default_mandatory: boolean;
  default_priority: number;
  parameter_schema: Record<string, ParameterSpec>;
  error_codes: string[];
}

export interface RuleSetting {
  rule_key: string;
  enabled: boolean;
  mandatory: boolean;
  priority: number;
  parameters: Record<string, unknown>;
}

export interface ConfigurationPayload {
  schema_version: number;
  calibration: {
    enabled: boolean;
    sample_type: string;
    required_calibrators: string[];
    minimum_required: number;
  };
  controls: {
    enabled: boolean;
    sample_type: string;
    required_controls: string[];
    discovered_optional: string[];
    minimum_required: number;
  };
  value_tokens: { missing: string[]; over_range: string[]; under_range: string[] };
  classification: Array<{
    priority: number;
    stream: string;
    match_mode: "both" | "id_only" | "type_only";
    sample_id_pattern: string;
    sample_type_pattern: string;
    label: string;
  }>;
  column_role_patterns: Record<string, string[]>;
  column_mappings: Record<string, string | null>;
  analyte_scope_policy: "STRICT" | "ALL";
  rules: RuleSetting[];
  corrections: {
    enabled: boolean;
    allowed_streams: string[];
    allowed_roles: string[];
    reason_required: boolean;
  };
  output: { passed_includes_warnings: boolean; exception_includes_original_row: boolean };
  limits: { max_upload_bytes: number };
}

export interface Configuration {
  analytics_id: string;
  version: number;
  payload: ConfigurationPayload;
  change_note: string | null;
  created_at: string;
  created_by_id: string | null;
}

export interface ConfigurationVersionSummary {
  id: string;
  version: number;
  change_note: string | null;
  created_at: string;
  created_by_id: string | null;
  is_active: boolean;
}

export interface ConfigurationDiffEntry {
  path: string;
  from_value: unknown;
  to_value: unknown;
  change: "added" | "removed" | "changed";
}

export interface ConfigurationUpdateResult {
  version: number;
  diff: ConfigurationDiffEntry[];
  affected_sessions: number;
}

// --- files -------------------------------------------------------------------

export interface SessionSummary {
  id: string;
  session_number: number;
  state: ProcessingState;
  calibration_verdict: "NOT_REVIEWED" | "PASS" | "FAIL";
  control_verdict: "NOT_REVIEWED" | "PASS" | "FAIL";
  total_rows: number;
  calibrator_rows: number;
  control_rows: number;
  patient_rows: number;
  other_rows: number;
  skipped_rows: number;
  passed_count: number;
  failed_count: number;
  engine_version: string;
  created_at: string;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface UploadedFile {
  id: string;
  analytics_id: string;
  original_filename: string;
  file_hash: string;
  size_bytes: number;
  content_type: string | null;
  uploaded_at: string;
  uploaded_by_id: string | null;
  status: "STORED" | "PARSED" | "INVALID";
  total_rows: number | null;
  empty_rows: number | null;
  malformed_rows: number | null;
  header_columns: string[] | null;
  detected_analytes: string[] | null;
  is_duplicate: boolean;
  duplicate_of_id: string | null;
  validation_errors: Array<Record<string, unknown>> | null;
}

export interface UploadedFileDetail extends UploadedFile {
  analytics_name: string | null;
  sessions: SessionSummary[];
}

export interface UploadResult {
  file: UploadedFile;
  session: SessionSummary;
  warnings: string[];
  duplicate_of_id: string | null;
}

export interface UploadResponse {
  results: UploadResult[];
}

export interface PreviewRow {
  source_row_number: number;
  stream: SampleStream;
  sample_id: string | null;
  sample_type: string | null;
  analyte_name: string | null;
  classification_reason: string | null;
  is_malformed: boolean;
  values: Record<string, string>;
}

export type SampleStream =
  | "CALIBRATOR"
  | "CONTROL"
  | "PATIENT"
  | "OTHER"
  | "SKIPPED"
  | "NOT_IN_SCOPE";

export interface FilePreview {
  file: UploadedFile;
  session: SessionSummary;
  columns: string[];
  column_mappings: Record<string, string | null>;
  unmapped_roles: string[];
  stream_counts: Partial<Record<SampleStream, number>>;
  warnings: string[];
  rows: PreviewRow[];
  row_limit: number;
}
