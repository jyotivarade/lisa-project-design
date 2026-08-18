# LISA — H. API Design

Base path `/api`. JSON only. OpenAPI at `/api/openapi.json`; frontend types are generated
from it, so the client cannot silently drift from the contract.
All routes except `/api/auth/login`, `/api/auth/refresh` and `/api/health/*` require
`Authorization: Bearer <access_token>` **and** a permission check.

## Error format (§25)

```json
{ "error_code": "CONTROL_FAILED",
  "message": "Patient processing is blocked: control validation failed.",
  "details": [ { "control_id": "WCS2", "percent_diff": 73.90, "tolerance_percent": 25 } ],
  "request_id": "01JB5Z…" }
```
No raw exception text is ever returned. Stack traces are logged against `request_id`.

## Conventions
`?page=1&page_size=50&sort=-created_at&q=` → `{ items, page, page_size, total, total_pages }`.
Status codes: `200/201` · `202` accepted (async processing) · `400` malformed ·
`401` unauthenticated · `403` permission · `404` not found · **`409` state/gate violation** ·
`413` too large · `422` validation · `500` internal.

---

## Authentication & profile — `permissions: none / self`

| method | path | notes |
|---|---|---|
| POST | `/api/auth/login` | `{email, password}` → `{access_token, token_type, expires_in, user}`; refresh token set as HttpOnly/Secure/SameSite cookie. Rate-limited; lockout after N failures; `LOGIN` / `LOGIN_FAILED` audited |
| POST | `/api/auth/refresh` | rotates the token; reuse of a rotated token revokes the family |
| POST | `/api/auth/logout` | revokes the family; audited |
| GET | `/api/auth/me` | user, role, permission codes, `last_login_at` |
| PATCH | `/api/auth/me` | `{full_name}` |
| POST | `/api/auth/change-password` | requires current password; revokes all refresh families |

## Dashboard — `analytics:read`

| method | path | notes |
|---|---|---|
| GET | `/api/dashboard` | §2, entirely from real aggregates: `total_analytics`, `total_files`, `total_sessions`, `total_passed`, `total_failed`, `calibration_failures`, `control_failures`, `patient_rows_processed`, `pass_rate`, `recent_uploads[]`, `recent_sessions[]`, `analytics_summary[]`. Empty database → zeros and `has_data: false`; the UI then renders "No analytics data available" and fabricates nothing (§27) |

## Analytics — `analytics:read` / `analytics:write`

| method | path | notes |
|---|---|---|
| GET | `/api/analytics` | list with `analyte_name`, `file_count`, `last_uploaded_at`, `last_session_state`, `calibration_status`, `control_status`, `patient_processing_status` (§17) |
| POST | `/api/analytics` | creates the analytics **and configuration version 1** seeded from `rule_definitions` |
| GET | `/api/analytics/{id}` | detail + active configuration summary |
| PUT | `/api/analytics/{id}` | metadata only (name, description, analyte, active) |
| GET | `/api/analytics/{id}/sessions` | processing history |

## Configuration — `configuration:read` / `configuration:write`

| method | path | notes |
|---|---|---|
| GET | `/api/analytics/{id}/configuration` | the **active** version, fully resolved |
| POST | `/api/analytics/{id}/configuration` | validated, then **inserts a new version** and repoints active. Response `{version, diff, affected_sessions: 0}` — the zero is deliberate: existing sessions are snapshot-isolated (§35) |
| GET | `/api/analytics/{id}/configuration/versions` | version list with author, timestamp, note |
| GET | `/api/analytics/{id}/configuration/versions/{version}` | historical payload, read-only |
| GET | `/api/rule-definitions` | the rule catalogue with parameter schemas, units and valid ranges — **the only source of thresholds the UI knows about** (§43) |

## Files — `files:*`

| method | path | notes |
|---|---|---|
| POST | `/api/analytics/{id}/files` | `multipart/form-data`, one or many files. Streams to storage, hashes, flags duplicates, creates a session in `UPLOADED`, queues parse. → `201 {files: [{file, session}]}` |
| GET | `/api/analytics/{id}/files` | paginated, filterable |
| GET | `/api/files` | cross-analytics File Management view |
| GET | `/api/files/{id}` | metadata, parse summary, sessions |
| GET | `/api/files/{id}/preview?limit=50` | headers, inferred types, stream counts, warnings, first N rows — **server-side**, so the browser never loads the file (§32) |
| GET | `/api/files/{id}/download` | original, streamed; `FILE_DOWNLOADED` audited |
| POST | `/api/files/{id}/process` | creates session #1 if none exists, else `409` |

## Processing — `processing:read` / `processing:validate` / `processing:execute`

| method | path | notes |
|---|---|---|
| GET | `/api/processing/{id}` | state, both verdicts, gate reason, counters, snapshot, `engine_version`, lineage |
| GET | `/api/processing/{id}/progress` | cheap poll: `{state, rows_processed, total, passed, failed, percent}` |
| GET | `/api/processing/{id}/events` | state-transition history |
| GET | `/api/processing/{id}/rows?stream=PATIENT` | parsed rows with classification reason |
| GET | `/api/processing/{id}/calibrators` | rows + value state + selection + `included_in_range` + verdict + the ion-ratio and RT traces + `{selected}/{required}` summary |
| POST | `/api/processing/{id}/calibrators/{row_id}/select` | `{is_selected}`; resets the calibration verdict to `NOT_REVIEWED`; audited |
| POST | `/api/processing/{id}/validate-calibration` | recomputes, writes verdict + traces, transitions state |
| GET | `/api/processing/{id}/controls` | rows + role + verdict + summary |
| POST | `/api/processing/{id}/controls/{row_id}/select` | as above |
| POST | `/api/processing/{id}/validate-controls` | recomputes, transitions |
| POST | `/api/processing/{id}/corrections` | `{processing_row_id, column_role, corrected_value, reason}` → `row_corrections`; original preserved; verdict reset; audited. `403 CORRECTION_NOT_ALLOWED` outside the configured allow-list (§19) |
| GET | `/api/processing/{id}/corrections` | full correction history |
| GET | `/api/processing/{id}/gate` | `{calibration_verdict, control_verdict, can_process, error_code, blocking_reasons[]}` |
| POST | `/api/processing/{id}/process` | **the only endpoint that creates patient results.** Transactional gate (§36). `202` on success; **`409` with `CALIBRATION_FAILED` / `CONTROL_FAILED` / `CALIBRATION_NOT_REVIEWED` / `CONTROL_NOT_REVIEWED`** otherwise |
| POST | `/api/processing/{id}/rerun` | `{carry_forward_selections: true}` → **new** session with a fresh snapshot and `parent_session_id`; the original is untouched (§20) |

## Results — `results:read`

| method | path | notes |
|---|---|---|
| GET | `/api/processing/{id}/results` | paginated patient results; filter by `final_result`, `sample_id`, `error_code` |
| GET | `/api/processing/{id}/results/{result_id}` | the full §14 evaluation: every rule with status, original value, calculated value, threshold, message — plus the original row |
| GET | `/api/processing/{id}/exceptions` | failed rows with codes and reasons |
| GET | `/api/processing/{id}/summary` | counts by result, by rule, by error code |
| GET | `/api/processing/{id}/traces` | every derived limit with its formula and inputs |
| GET | `/api/processing/{id}/download/passed` | streamed from storage |
| GET | `/api/processing/{id}/download/exceptions` | streamed from storage |

## Administration & audit — `users:*`, `roles:write`, `audit:read`

| method | path |
|---|---|
| GET/POST `/api/admin/users` · PATCH `/api/admin/users/{id}` · POST `/api/admin/users/{id}/deactivate` |
| GET `/api/admin/roles` · PUT `/api/admin/roles/{id}/permissions` |
| GET/PUT `/api/admin/rule-definitions` |
| GET `/api/audit-logs` — filter by actor, action, entity, analytics, session, date range |
| GET `/api/health/live` · `/api/health/ready` — unauthenticated |

---

## Contract guarantees

1. `POST /api/processing/{id}/process` is the **only** path that produces patient results, and
   it verifies the gate inside the transaction that transitions the state.
2. No endpoint mutates a completed session's results. A rerun always creates a new session.
3. `POST /api/analytics/{id}/configuration` cannot change any existing session's numbers.
4. Every threshold the UI shows or edits comes from `/api/rule-definitions` and the analytics
   configuration. The frontend ships no business constants.
5. Downloads always stream stored bytes — never regenerated on the fly.
6. Every mutating endpoint writes an `audit_logs` row in the same transaction.
