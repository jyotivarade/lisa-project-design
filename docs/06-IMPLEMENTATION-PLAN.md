# LISA — Q. Phase-by-Phase Implementation Plan

Phases follow §40. After **every** phase I will report: what was implemented · changed files ·
database migrations · APIs added · tests added · remaining work · **exact commands to run and
test**. No phase begins until the previous one is structurally complete, and no phase removes
functionality delivered earlier. `REQUIREMENTS.md` and `CHANGELOG.md` are updated at each gate.

---

### PHASE 0 — Architecture & planning ✅ *(this deliverable)*
Docs `00`–`07`, `REQUIREMENTS.md`, `DECISIONS.md`, `CHANGELOG.md`.
**Exit:** approval, and answers to the blocking items in §R.

---

### PHASE 1 — Project skeleton & database
Repo restructure (prototype → `prototype/`, unchanged and still runnable); `backend/`,
`frontend/`, `docker-compose.yml`, `.env.example`; FastAPI app factory, settings, structured
logging, error handler emitting `{error_code, message, details}`, health endpoints;
SQLAlchemy 2.0 base + Alembic; **one initial migration creating every table in
`docs/01-DATA-MODEL.md`**; `rule_definitions`, `roles` and `permissions` seeded; Vite + TS
skeleton with AppShell and the API client.
Fixtures restored from git history into `backend/app/tests/fixtures/`.
**Tests:** migration up/down clean; seed idempotent; health endpoints.
**Exit:** `docker compose up` → API and DB alive, schema complete, empty UI shell.

### PHASE 2 — Authentication & RBAC
Argon2id hashing and password policy; JWT access; refresh rotation with family revocation and
reuse detection; login rate limit and lockout; `roles`/`permissions`/`role_permissions` with
`require_permission`; `/api/auth/*`, `/api/admin/users`, `/api/admin/roles`; audit for
`LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `USER_*`; frontend LoginPage, ProtectedRoute,
`usePermission`, ProfilePage, change-password.
**Tests:** login success/failure/lockout; rotation; **reuse of a rotated token revokes the
family**; permission matrix per role × endpoint; expired/tampered token rejection.
**Exit:** a real user logs in and sees an empty, permission-filtered shell.

### PHASE 3 — Analytics & configuration
Analytics CRUD; versioned configuration service (append-only); `rule_definitions` catalogue
API; configuration validator; version history and diff; frontend AnalyticsListPage,
AnalyticsDetailPage tabs, and the Configuration UI rendered entirely from the catalogue.
**Tests:** creating analytics yields a complete v1; every edit creates v2 and leaves v1 byte-
identical; out-of-range values rejected with `INVALID_CONFIGURATION`; a repo-wide grep proves
no business constant exists under `frontend/src/features/`.
**Exit:** an assay is fully configurable without touching code.

### PHASE 4 — File upload & CSV parsing
`FileStorage` protocol + local backend; streamed upload with SHA-256, size/type/MIME guards,
duplicate flagging; `csv_parser` (encoding ladder, delimiter sniff, verbatim header,
`source_row_number`, value tokens `----`/`N.I. High`/`N.I. Low`, empty-row skip + warning,
malformed-row flagging); classifier; scope filter; batched persistence; session `UPLOADED →
VALIDATING → CALIBRATION_REVIEW`; preview API; frontend drag-and-drop, FilesPage, preview.
**Tests:** all four real Cocaine files parse to the expected stream counts (run 01: 7
calibrators, 4 controls of which 3 required + `UC` discovered, 118 patients, 0 empty);
`----` never becomes 0; malformed and empty rows behave per §5; a 500 000-row synthetic file
parses within the memory budget.
**Exit:** upload → preview → classified rows. Nothing evaluated yet.

### PHASE 5 — Criteria engine (pure)
`app/criteria/` complete: models, context, derivations, registry, all seven rules,
`CriteriaEngine.VERSION`. **Zero database or framework imports** — enforced by an import-lint
test. Built and unit-tested entirely against constructed objects, before any wiring.
**Tests:** the full matrix in `docs/07-TESTING.md` §1 — every rule, every boundary, every
token, both ion-ratio formulas, all three zero-ratio policies, both RT modes.
**Exit:** the engine is provably correct and provably independent.

### PHASE 6 — Calibration/control validation & the processing gate
`context_builder`; calibration and control validation services; `calibrator_selections`,
`control_selections`, `row_corrections`; `calculation_traces`; the state machine; **the
three-layer gate** with `SELECT … FOR UPDATE` (§36); validate/select/correction APIs;
frontend calibration and control screens, correction dialog, GateCard.
**Tests:** run 01 → READY; run 02 → `CALIBRATION_FAILED` (`Cal_4 27.87`) and
`CONTROL_FAILED` (`WCS1 61.22`); run 03 → `CONTROL_FAILED` (`WCS2 73.90`);
**`POST /process` on a blocked session returns 409 and `processing_results` stays empty** —
asserted at the API, not at the button; verdict resets to `NOT_REVIEWED` on any change;
corrections preserve the original and are audited.
**Exit:** the safety property is enforced and independently proven.

### PHASE 7 — Patient processing
Orchestrator: sequential row-by-row evaluation, batching, progress counters, Celery task with
an inline runner for tests; `processing_results` + `rule_results` (passes included);
original/adjusted concentration; `PROCESSING_PATIENTS → COMPLETED / PROCESSING_FAILED`;
results and detail APIs; frontend patient table, drill-down, progress panel.
**Tests:** run 01 evaluates all 118 patient rows; a row failing two rules records both;
an injected rule exception fails only that row and the run completes; `PASSED` requires every
mandatory rule; `original_concentration` survives every path.
**Exit:** every patient row has an independent, fully explained verdict.

### PHASE 8 — Output files & reports
PASSED writer (original headers, order and values) and EXCEPTIONS writer (session, source row,
sample, analyte, rule, code, description, original, calculated, threshold, original row);
CSV-injection guard; `output_files` with hashes; streamed downloads; rerun creating a new
session with lineage; processing summary, calibration, control and exception reports.
**Tests:** golden-file byte equality across repeated runs; injection test (`=HYPERLINK(...)`
written as `'=HYPERLINK(...)`); **rerun leaves the parent session's results and files
unchanged**; passed-file row count equals the PASSED count.
**Exit:** auditability is real, not aspirational.

### PHASE 9 — Dashboard & complete frontend
`/api/dashboard` from real aggregates; empty-state `has_data: false`; DashboardPage with
summary cards, pass/fail chart, calibration/control failure counts, recent activity, analytics
summary; remaining polish, toasts, confirmations, empty and error states.
**Tests:** empty database → zeros and "No analytics data available"; aggregates cross-checked
against direct row counts (§27).

### PHASE 10 — Audit logging
Complete the action catalogue; same-transaction writes; audit API and UI with filters;
retention policy.
**Tests:** every mutating endpoint writes exactly one audit row; a rolled-back mutation writes
none; correction and selection history is fully reconstructable.

### PHASE 11 — Testing
Complete `docs/07-TESTING.md`: integration suites over the real fixtures, the §35
historical-immutability suite, the replay/reproducibility test, Playwright journeys (happy
path and the blocked path), edge-case corpus, 500 000-row performance gate, coverage gates
(`criteria` ≥ 95 %, services/processing ≥ 85 %).

### PHASE 12 — Docker, deployment, documentation
Production compose, multi-stage images, migration init job, nginx config and CSP, healthchecks,
CI pipeline (lint · mypy strict on `criteria` · unit · integration · frontend · e2e ·
dependency and secret scan), `README.md`, `RUNBOOK.md`, `.env.example`, backup/restore notes.

---

## Sequencing

Phases 5 → 6 → 7 are strictly serial. Phase 5 is deliberately placed **before** any wiring:
the engine is the part that must be provably correct, and building it against pure fixtures
prevents database convenience from leaking into rule logic. Frontend work for phases 3, 4 and
6 can run in parallel with their backends once the OpenAPI contract is frozen.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Specification conflicts resolved silently | Every one is configuration with a documented default (§R/§S); the UI shows formula, inputs and percentage for each limit. **Lab sign-off required before clinical use.** |
| R2 | `% Recovery` columns absent from real exports | Configurable `basis_method` with `AUTO`; the basis used is recorded on every ISTD result. **Open — D-05.** |
| R3 | Mitragynine/Temazepam fixtures not supplied | Cocaine files used as the structural fixture; parser is layout-agnostic. **Blocking B-1 — please supply the files.** |
| R4 | Float boundaries (`27.87` vs `25`) | `NUMERIC`/`Decimal` end to end; explicit at/just-below/just-above tests per threshold; operator configurable |
| R5 | Large files exhaust memory | Streaming parse, batched inserts, Celery workers, 500 000-row release gate |
| R6 | Config drift corrupting history | Append-only versions + per-session snapshot + the §35 test suite |
| R7 | Corrections used to force a passing run | Corrections limited by configuration to calibrator/control rows, reason mandatory, fully audited, and they reset the verdict. **Patient-row corrections disabled by default (D-14).** |
| R8 | Scope: 43 sections, 13 phases | Phase gates with explicit exit criteria; nothing marked COMPLETED without a referenced test |
