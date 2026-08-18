# LISA — C. Database Design (PostgreSQL 16)

Every table: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
`created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.

**All analytical numbers are `NUMERIC`, never `float`.** A `%Diff` of `27.87` must compare
against a tolerance of `25` identically on every machine and every rerun; binary floating
point cannot promise that, and this is a system whose entire value is reproducibility.

`JSONB` is used **only** for: `config_snapshot`, `raw` row data, `evaluation_details`,
`metadata`, `details`. Everything queried or aggregated is a real column.

---

## ERD

```
 permissions ──< role_permissions >── roles ──< users ──< refresh_tokens
                                                  │
                                                  ├──< audit_logs
                                                  └──< uploaded_files
                                                          │
  analytics ──1:1── analytics_configurations              │
      │                     │                             │
      │                     └──< analytics_configuration_versions (APPEND-ONLY)
      │                                    │
      ├──< uploaded_files ────────────────┐│
      │         │                         ││
      │         └──< processing_sessions ─┴┴── config_snapshot JSONB (AD-1)
      │                     │                  engine_version
      │                     │
      │      ┌──────────────┼──────────────┬────────────────┬──────────────┐
      │      │              │              │                │              │
      │ processing_rows  calibrator_   control_        row_corrections  output_files
      │      │           selections    selections           │
      │      │              │              │                │
      │      └──< processing_results ──< rule_results       │
      │                                                     │
      └──< rule_definitions (catalogue) ────────────────────┘
                     │
             processing_sessions ──< processing_events (state transitions)
```

Cardinalities that carry the requirements:

* `analytics 1 ──< N uploaded_files` — unlimited, never overwritten (§30).
* `uploaded_files 1 ──< N processing_sessions` — every process **and every rerun** is a new session (§20).
* `processing_sessions 1 ──< N output_files` — outputs are additive, never replaced.
* `processing_results 1 ──< N rule_results` — **every rule outcome including passes** is stored, because §14 requires the full evaluation, not a boolean.

---

## 1. Identity, roles, permissions

### `roles`
`name TEXT UNIQUE NOT NULL` (`ADMIN`, `ANALYST`, `VIEWER`), `description`, `is_system BOOLEAN`.

### `permissions`
`code TEXT UNIQUE NOT NULL`, `description`. Seeded catalogue:
```
analytics:read  analytics:write  configuration:read  configuration:write
files:read  files:upload  files:download  processing:read  processing:validate
processing:execute  processing:rerun  corrections:write  results:read
audit:read  users:read  users:write  roles:write
```
`ADMIN` = all · `ANALYST` = all except `users:*`, `roles:write`, `audit:read` ·
`VIEWER` = `*:read` + `files:download`.

### `role_permissions`
`role_id FK`, `permission_id FK`. UNIQUE(role_id, permission_id).

### `users`
`email CITEXT UNIQUE NOT NULL` (the login identity), `password_hash TEXT` (Argon2id),
`full_name`, `role_id FK roles`, `is_active BOOLEAN`, `last_login_at`,
`failed_login_count INT`, `locked_until TIMESTAMPTZ`, `password_changed_at`.

### `refresh_tokens`
`user_id FK`, `token_hash TEXT UNIQUE`, `family_id UUID`, `expires_at`, `revoked_at`,
`replaced_by_id FK self`, `user_agent`, `ip INET`. INDEX(`family_id`), INDEX(`user_id`).

---

## 2. Analytics & configuration

### `analytics`
| column | notes |
|---|---|
| name TEXT NOT NULL | e.g. `Mitragynine` — never hard-coded anywhere |
| code TEXT UNIQUE NOT NULL | slug |
| description TEXT | |
| analyte_name TEXT NOT NULL | the value expected in the file's `Analyte Name` column (§29) |
| is_active BOOLEAN NOT NULL DEFAULT true | |
| created_by_id / updated_by_id FK users | §3 |

UNIQUE(`lower(name)`). INDEX(`is_active`).

### `analytics_configurations` (1:1 with analytics — the *pointer*)
`analytics_id FK UNIQUE`, `active_version_id FK analytics_configuration_versions`,
`updated_by_id FK users`.

### `analytics_configuration_versions` — **APPEND-ONLY** (AD-1, §18)
| column | notes |
|---|---|
| analytics_id FK | |
| version INT NOT NULL | 1, 2, 3 … |
| payload JSONB NOT NULL | the complete resolved configuration — the exact shape copied into `config_snapshot` |
| change_note TEXT | why this version exists |
| created_by_id FK users | |

UNIQUE(`analytics_id`, `version`). **No UPDATE is ever issued against this table.** Editing
configuration inserts version N+1 and repoints `analytics_configurations.active_version_id`.

`payload` shape (§22) — every value below is configurable, none is hard-coded:

```jsonc
{
  "schema_version": 1,
  "calibration": {
    "enabled": true, "sample_type": "Standard",
    "required_calibrators": ["Cal_1","Cal_2","Cal_3","Cal_4","Cal_5","Cal_6","Cal_7"],
    "minimum_required": 7,
    "tolerance_percent": 25, "tolerance_operator": "lte"
  },
  "controls": {
    "enabled": true, "sample_type": "Control",
    "required_controls": ["WCS1","WCS2","WCS3"],
    "discovered_optional": ["UC"],
    "minimum_required": 3,
    "tolerance_percent": 25, "tolerance_operator": "lte"
  },
  "ion_ratio": {
    "column_role": "ion_ratio",
    "formula": "SPAN",                      // SPAN | MULTIPLICATIVE
    "adjustment_percent": 10,
    "zero_ratio_policy": "EXCLUDE_FROM_RANGE" // VALID | INVALID | EXCLUDE_FROM_RANGE
  },
  "retention_time": {
    "mode": "PERCENTAGE",                    // PERCENTAGE | ABSOLUTE
    "adjustment_percent": 20,
    "absolute_window_minutes": null,
    "average_method": "MEAN"                 // MEAN | MEDIAN
  },
  "istd": {
    "missing_peak_fails": true,
    "suppression_enabled": true,
    "suppression_threshold_percent": 90,
    "basis_method": "AUTO"                   // RECOVERY_COLUMNS | ISTD_AREA_BATCH_MEAN
  },                                         // | ISTD_AREA_CALIBRATOR_MEAN | AUTO
  "concentration_cutoff": {
    "source": "CONTROL_STD_CONC",            // CONTROL_STD_CONC | FIXED_VALUE
    "source_sample_id": "WCS1",
    "fixed_value": null,
    "zero_on_fail": true
  },
  "calibration_range": { "over_range_action": "FAIL", "under_range_action": "FAIL" },
  "value_tokens": { "missing": ["----","","N/A","NA"],
                    "over_range": ["N.I. High","N.I.(High)"],
                    "under_range": ["N.I. Low","N.I.(Low)"] },
  "classification": [ /* ordered rules, see docs/02 §3 */ ],
  "column_mappings": { "sample_id": "Sample ID", "percent_diff": "%Diff", "...": "..." },
  "analyte_scope_policy": "STRICT",          // STRICT | ALL  (D-13)
  "rules": [ { "rule_key": "istd", "enabled": true, "mandatory": true, "priority": 10 }, … ],
  "corrections": { "enabled": true, "allowed_streams": ["CALIBRATOR","CONTROL"],
                   "allowed_roles": ["percent_diff","ion_ratio","retention_time",
                                     "std_concentration","concentration","istd_area"],
                   "reason_required": true },
  "output": { "passed_includes_warnings": false, "exception_includes_original_row": true },
  "limits": { "max_upload_bytes": 104857600 }
}
```

### `rule_definitions` — the rule catalogue (§18, §37)
`rule_key TEXT UNIQUE`, `name`, `description`, `stream`, `default_enabled BOOLEAN`,
`default_mandatory BOOLEAN`, `default_priority INT`, `parameter_schema JSONB`
(field, type, unit, min, max, default, help). This is what the Configuration UI renders —
**so no threshold ever lives in React** (§43). Seeded by migration, editable by ADMIN.

---

## 3. Files

### `uploaded_files`
| column | notes |
|---|---|
| analytics_id FK, uploaded_by_id FK | |
| original_filename TEXT | verbatim, metadata only |
| stored_filename TEXT NOT NULL | server-generated UUID key |
| file_hash TEXT NOT NULL | SHA-256 |
| size_bytes BIGINT, content_type TEXT | |
| uploaded_at TIMESTAMPTZ | |
| status TEXT | `STORED` · `PARSED` · `INVALID` |
| header_columns JSONB, total_rows, empty_rows, malformed_rows INT | |
| detected_analytes JSONB | |
| is_duplicate BOOLEAN, duplicate_of_id FK self | §4 — flagged, **never silently deleted** |
| validation_errors JSONB | |

INDEX(`analytics_id`, `uploaded_at DESC`), INDEX(`file_hash`).

---

## 4. Processing sessions

### `processing_sessions`
| column | notes |
|---|---|
| uploaded_file_id FK, analytics_id FK | |
| session_number INT | sequential per file: 1 = first run, 2+ = rerun |
| parent_session_id FK self | rerun lineage (§20) |
| state TEXT NOT NULL | the state machine — see docs/02 §G |
| **config_snapshot JSONB NOT NULL** | AD-1 — the engine reads only this |
| config_version_id FK | lineage back to the version it was copied from |
| **engine_version TEXT NOT NULL** | §43 reproducibility input |
| calibration_verdict TEXT | `NOT_REVIEWED` · `PASS` · `FAIL` |
| control_verdict TEXT | `NOT_REVIEWED` · `PASS` · `FAIL` |
| calibration_reviewed_at / control_reviewed_at TIMESTAMPTZ | cleared by any selection, correction or config change |
| gate_blocked_reason TEXT | `CALIBRATION_FAILED` · `CONTROL_FAILED` · `CALIBRATION_NOT_REVIEWED` · `CONTROL_NOT_REVIEWED` |
| total_rows, calibrator_rows, control_rows, patient_rows, other_rows, skipped_rows INT | |
| rows_processed, passed_count, failed_count INT | progress + results |
| started_by_id FK, started_at, completed_at, duration_ms | |
| error_code TEXT, error_message TEXT | terminal failure detail |

INDEX(`analytics_id`, `created_at DESC`), INDEX(`uploaded_file_id`, `session_number`),
INDEX(`state`), UNIQUE(`uploaded_file_id`, `session_number`).

### `processing_events`
Append-only: `session_id`, `from_state`, `to_state`, `actor_id`, `reason`, `at`.
Every transition passes through `state_machine.transition()` which writes this row —
so an illegal transition is impossible *and* every legal one is explained.

### `processing_rows`
| column | notes |
|---|---|
| session_id FK | |
| source_row_number INT NOT NULL | 1-based in the source file, header excluded (§5) |
| raw JSONB NOT NULL | the row exactly as read — never mutated |
| stream TEXT | `CALIBRATOR` · `CONTROL` · `PATIENT` · `OTHER` · `SKIPPED` · `NOT_IN_SCOPE` |
| sample_id, sample_type, analyte_name TEXT | extracted through column mappings |
| classification_reason TEXT | which classification rule matched, for "why is this a control?" |
| is_malformed BOOLEAN, parse_warnings JSONB | §5 |

INDEX(`session_id`, `stream`), INDEX(`session_id`, `source_row_number`), INDEX(`sample_id`).
Persisted in 1 000-row batches.

---

## 5. Selections, corrections, verdicts

### `calibrator_selections`
| column | notes |
|---|---|
| session_id FK, processing_row_id FK | |
| calibrator_id TEXT | `Cal_1` … |
| is_selected BOOLEAN NOT NULL | default from configuration, user-changeable (§5) |
| value_state TEXT | `VALID` · `INVALID` · `MISSING` · `ZERO_EXCLUDED` · `UNSELECTED` |
| included_in_range BOOLEAN | shown explicitly in the UI (§10) |
| percent_diff, ion_ratio, found_rt, std_concentration, concentration, istd_area NUMERIC | effective values (after any correction) |
| validation_status TEXT | `PASS` · `FAIL` · `NOT_EVALUATED` |
| validation_reason TEXT, threshold_used NUMERIC | |
| selected_by_id FK, selected_at | audited |

UNIQUE(`session_id`, `calibrator_id`), INDEX(`session_id`).

### `control_selections`
Same shape keyed by `control_id`, plus `role TEXT` (`REQUIRED` · `OPTIONAL` ·
`CUTOFF_SOURCE` · `DISCOVERED`) and `is_required BOOLEAN`.

### `row_corrections` (§19) — corrections never touch the uploaded file
| column | notes |
|---|---|
| session_id FK, processing_row_id FK | |
| column_role TEXT, column_name TEXT | what was corrected |
| original_value TEXT NOT NULL | verbatim from the file |
| corrected_value TEXT NOT NULL | |
| reason TEXT NOT NULL | required by configuration |
| corrected_by_id FK users NOT NULL, corrected_at TIMESTAMPTZ NOT NULL | |
| is_active BOOLEAN | a superseded correction is retained, not deleted |

INDEX(`session_id`), INDEX(`processing_row_id`).
Effective value = latest active correction, else `raw`. The original is always recoverable,
and the correction chain is part of the reproducibility inputs (§43).

---

## 6. Results

### `processing_results` — one row per patient row evaluated
| column | notes |
|---|---|
| session_id FK, processing_row_id FK | |
| source_row_number INT, sample_id TEXT, analyte_name TEXT | |
| final_result TEXT NOT NULL | `PASSED` · `FAILED` |
| original_concentration NUMERIC | **never lost** (§9) |
| adjusted_concentration NUMERIC | after cut-off / rule actions |
| cutoff_value NUMERIC | the value actually applied |
| istd_area, ion_ratio, found_rt NUMERIC | inputs shown in the patient table (§17) |
| rules_evaluated, rules_failed INT | |
| failure_codes TEXT[] | e.g. `{CONCENTRATION_BELOW_CUTOFF, ION_RATIO_OUT_OF_RANGE}` |
| evaluation_details JSONB | the full engine payload, for exact replay |

INDEX(`session_id`, `final_result`), INDEX(`session_id`, `sample_id`), INDEX(`analyte_name`),
INDEX using GIN(`failure_codes`).

### `rule_results` — one row per rule per result, **passes included** (§14)
`processing_result_id FK`, `rule_key`, `rule_name`, `status` (`PASS`·`FAIL`·`SKIPPED`),
`error_code TEXT`, `original_value TEXT`, `calculated_value TEXT`, `threshold TEXT`,
`lower_limit NUMERIC`, `upper_limit NUMERIC`, `message TEXT`, `priority INT`,
`metadata JSONB`. INDEX(`processing_result_id`), INDEX(`rule_key`, `status`).

### `calculation_traces` — how each derived limit was computed (§10, §11, §17)
`session_id`, `key` (`ION_RATIO_RANGE`·`RT_WINDOW`·`CUTOFF`·`CALIBRATION_RANGE`·`ISTD_BASIS`),
`formula TEXT`, `inputs JSONB` (contributing sample IDs and values), `excluded JSONB`
(and why), `adjustment_percent NUMERIC`, `adjustment_value NUMERIC`,
`lower_limit`, `upper_limit`, `result NUMERIC`. UNIQUE(`session_id`, `key`).

### `output_files`
`session_id FK`, `kind` (`PASSED` · `EXCEPTIONS` · `SUMMARY`), `stored_filename`,
`original_filename`, `file_hash`, `size_bytes`, `row_count`, `generated_at`,
`generated_by_id`. INDEX(`session_id`, `kind`). Additive only — a rerun writes new objects
under a new session; nothing is replaced.

---

## 7. Audit

### `audit_logs` (§23)
`actor_id FK users NULL`, `action TEXT NOT NULL`, `entity_type TEXT`, `entity_id UUID`,
`analytics_id UUID`, `session_id UUID`, `old_value JSONB`, `new_value JSONB`,
`metadata JSONB`, `ip INET`, `user_agent TEXT`, `at TIMESTAMPTZ NOT NULL`.

Actions: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `UPLOAD`, `CONFIG_CREATED`, `CONFIG_CHANGED`,
`CALIBRATION_SELECTION`, `CONTROL_SELECTION`, `CALIBRATION_CORRECTION`,
`CONTROL_CORRECTION`, `CALIBRATION_VALIDATED`, `CONTROL_VALIDATED`, `PROCESSING_STARTED`,
`PROCESSING_COMPLETED`, `PROCESSING_FAILED`, `RERUN`, `FILE_DOWNLOADED`, `USER_CREATED`,
`USER_UPDATED`, `ROLE_CHANGED`.

INDEX(`entity_type`, `entity_id`), INDEX(`actor_id`, `at DESC`), INDEX(`session_id`),
INDEX(`analytics_id`, `at DESC`), INDEX(`action`, `at DESC`).

Written by `audit/recorder.py` inside the caller's transaction: an action that commits is
always logged; an action that rolls back is never logged.

---

## 8. Transaction boundaries

| Operation | Transaction |
|---|---|
| Upload | store object → insert `uploaded_files` + `processing_sessions(UPLOADED)` + audit, one commit; the stored object is orphan-swept if the commit fails |
| Parse | rows inserted in batches, each committed; the state transition to `CALIBRATION_REVIEW` is the final commit |
| Selection / correction | update + audit + verdict reset (`*_reviewed_at = NULL`) in one commit |
| Validation | recompute → write selections, traces, verdict, state transition, audit — one commit |
| **Start patient processing** | `SELECT … FOR UPDATE` on the session → verify state → verify both verdicts → verify snapshot present → transition to `PROCESSING_PATIENTS` → audit → commit (§36). **Any failure raises before commit and the API returns 409.** |
| Results | batched inserts; final counters + `COMPLETED` + `output_files` in the closing commit |
