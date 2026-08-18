# Changelog

All notable changes to LISA. Format follows Keep a Changelog; versions are semantic.

## [Unreleased]

### Added — 2026-08-19 — Architecture & design (Phase 0 documentation)
- `docs/00-ARCHITECTURE.md` — system architecture, layering, key decisions (AD-1 … AD-7),
  security architecture, non-functional targets, deployment, relationship to the existing prototype.
- `docs/01-DATA-MODEL.md` — PostgreSQL schema, entity relationships, enumerations, index plan.
- `docs/02-PROCESSING-ENGINE.md` — end-to-end flow, processing state machine, sample
  classification, derived-limit formulas with worked examples from the real exports, criteria
  engine design, output generation, error handling.
- `docs/03-API-CONTRACT.md` — REST surface, conventions, contract guarantees.
- `docs/04-FRONTEND.md` — React/TypeScript structure, routes, processing wizard, state management.
- `docs/05-IMPLEMENTATION-PLAN.md` — phases 0–10 with dependencies, exit criteria, and a risk register.
- `docs/06-TESTING.md` — testing strategy grounded in the four real Cocaine exports.
- `REQUIREMENTS.md` — traceability for all 49 specification sections.
- `DECISIONS.md` — DEC-001 … DEC-014 covering every identified specification conflict.

### Notes
- No application code has been written. The existing vanilla-JS prototype is unchanged and
  remains the behavioural reference.
- Four decisions are marked OPEN and need laboratory confirmation before production use:
  DEC-003 (ISTD suppression basis and direction), DEC-011 (multi-analyte gating), and the open
  questions within DEC-001 (ion-ratio formula), DEC-005 (RT window width) and DEC-007
  (over-range handling).

### Changed — 2026-08-19 — Architecture v2 (revised specification)
Realigned the entire design set to the revised specification:
- Roles reduced to **ADMIN / ANALYST / VIEWER**, RBAC made table-driven
  (`roles`, `permissions`, `role_permissions`) rather than an enum.
- State machine renamed and reshaped to `UPLOADED → VALIDATING → CALIBRATION_REVIEW →
  CONTROL_REVIEW → READY → PROCESSING_PATIENTS → COMPLETED`, with failure states
  `CALIBRATION_FAILED`, `CONTROL_FAILED`, `PROCESSING_FAILED`.
- Added explicit **review verdicts** (`NOT_REVIEWED` / `PASS` / `FAIL`) so a verdict cannot
  survive a selection, correction or configuration change — this is what the new gate codes
  `CALIBRATION_NOT_REVIEWED` / `CONTROL_NOT_REVIEWED` protect.
- Added **`row_corrections`** as a first-class entity (§19) with original/corrected/actor/
  reason, never touching the uploaded file.
- Added `engine_version` to processing sessions and a replay test for §43 reproducibility.
- Error envelope changed to `{error_code, message, details}`.
- API paths aligned to `/api/...` as specified; folder structures aligned to §39.
- Implementation plan restructured into phases 0–12 per §40.
- `docs/05-CONFIGURATION.md` added (configuration model + snapshot strategy).
- Decisions renumbered D-01 … D-16 with B-1/B-2 blocking inputs; several earlier open
  questions are now settled by the revised specification (ion-ratio formula = SPAN,
  zero-ratio policy = EXCLUDE_FROM_RANGE, below-cut-off rows fail).

## [0.1.0] — 2026-08-19 — Phase 1: project skeleton and database

### Added — repository
- Restructured into `backend/`, `frontend/`, `docs/`, `prototype/`.
  The vanilla-JS prototype moved to `prototype/` **unchanged and still runnable**; the
  GitHub Pages workflow now publishes that directory instead of the repository root.
- Real LC-MS/MS exports restored from git history into `backend/app/tests/fixtures/`
  as **test-only** fixtures (never seeded — spec section 27).
- `docker-compose.yml` (postgres · migrate · api · frontend), Dockerfiles, `.env.example`,
  root and backend `README.md`.

### Added — backend
- FastAPI application factory with a single error contract: every failure is
  `{error_code, message, details, request_id}`; raw exception text is logged, never returned.
- Structured JSON logging with a request id propagated on every line and response header.
- Settings via pydantic-settings, including a validator that rejects a non-psycopg
  database URL rather than failing obscurely at first connection.
- SQLAlchemy 2.0 models for **all 21 tables** in `docs/01-DATA-MODEL.md`, and one reversible
  Alembic migration creating them. `alembic check` reports no drift.
- Domain enumerations stored as TEXT with CHECK constraints — adding a value later is a
  constraint change, not a non-transactional `ALTER TYPE`.
- All analytical values are `NUMERIC(18,6)`, never float, so `27.87` compares against a
  tolerance of `25` identically on every machine and every rerun.
- Table-driven RBAC: `roles`, `permissions`, `role_permissions` with a 17-permission
  catalogue and the ADMIN / ANALYST / VIEWER matrix.
- Rule catalogue (`app/core/rule_catalog.py`) seeded into `rule_definitions`: the seven
  criteria rules with parameter schemas carrying type, unit, bounds, default and help — the
  single source the Configuration UI will render, so no threshold ever needs to live in React.
- Idempotent seeder and `python -m app.cli seed | check-db`.
- Health endpoints reporting each dependency separately.

### Added — frontend
- Vite + React 18 + TypeScript (strict) + Tailwind v4 + TanStack Query + React Router.
- `AppShell` with the specified navigation, `ErrorBoundary`, `StatusBadge` (icon **and**
  text — never colour alone), `EmptyState`.
- Typed API client mapping the server's error envelope to an `ApiError`, with `isGateBlocked`
  so a 409 is presented as a workflow state to explain rather than a failure to retry.
- Dashboard rendering the real system state and an honest "No analytics data available";
  every other route is an explicit "arrives in Phase N" placeholder rather than an empty
  table that looks like a working screen.

### Tests
- 51 backend tests (21 unit, 30 integration) and 6 frontend tests, all passing.
- Integration tests migrate a real PostgreSQL database with Alembic — the same path a
  deployment takes — and roll back per test.
- Notable assertions: the CHECK constraints actually reject an invented processing state, a
  blank correction reason and a mixed-case email; the seed is idempotent and creates **no**
  business data; a permission removed from the catalogue is genuinely revoked; the rule
  catalogue defaults match `DECISIONS.md` (so a default cannot drift from the decision that
  authorised it); patient values are not correctable by default (D-14); classification never
  identifies a patient by Sample ID alone.
- Backend coverage 94% on shipped modules; ruff clean; frontend `tsc --noEmit` clean.

### Notes
- Seeded defaults for the still-open decisions D-12, D-13 and D-14 use the recommended
  values from `DECISIONS.md` §S. They are seed values only: every one is per-Analytics
  configuration from Phase 3 onward, and changing them needs no migration.
- Docker Compose files are written but **unverified** — Docker is not installed on this
  machine. The stack was verified locally instead: PostgreSQL 17, Alembic, uvicorn and the
  Vite dev proxy, end to end.

## [0.2.0] — 2026-08-19 — Phase 2: authentication and RBAC

### Added — backend
- **Argon2id** password hashing with a configurable policy (length, character classes),
  transparent rehash when cost parameters increase, and a constant-work path for unknown
  accounts so response timing cannot be used to enumerate users.
- **JWT access tokens** (15 min, in-memory on the client) with explicit `typ` checking, so a
  refresh token cannot be presented as a bearer credential, and `alg=none` is refused.
- **Refresh-token rotation with family revocation.** Tokens are 384 bits of CSPRNG output
  stored SHA-256-hashed; every use issues a replacement; presenting a rotated token again
  revokes the entire family and is audited. Nobody keeps the session after a replay — the
  honest user re-authenticates and the thief gets nothing.
- **Account lockout** after a configurable number of failures, and a per-IP login throttle.
  Failure bookkeeping commits before the request's exception propagates — otherwise the
  attempt counter would roll back and guessing would be unlimited.
- **Table-driven RBAC**: `require_permission(...)` on every administration route, permissions
  read from the database per request, and deactivation re-checked on every request rather
  than trusted from the token claims.
- `/api/auth/login · refresh · logout · me (GET/PATCH) · change-password` and
  `/api/admin/users · users/{id} · roles`.
- Guard rails: the last active administrator cannot be demoted or deactivated; deactivating a
  user revokes their live sessions immediately; a password change ends every session.
- `python -m app.cli create-admin` — the first administrator is an operator action, not an
  open registration endpoint.
- Audit rows for `LOGIN`, `LOGIN_FAILED` (with reason), `LOGOUT`, `USER_CREATED`,
  `USER_UPDATED`, `ROLE_CHANGED`, written in the caller's transaction.

### Added — frontend
- `AuthProvider` restoring a session from the HttpOnly refresh cookie on load, `useAuth` /
  `usePermission`, `ProtectedRoute` with optional permission, `LoginPage`, `ProfilePage`
  (details + password change), and an Administration page listing users and role grants.
- API client now attaches the access token, refreshes once on 401, and **shares a single
  refresh across concurrent 401s** — with rotation-on-use, parallel refreshes would replay a
  spent token and the server would correctly destroy the family.
- Sidebar entries and routes are filtered by the permissions the server reported.

### Fixed
- The development JWT signing key was 31 bytes, below the RFC 7518 minimum for HS256
  (PyJWT warned). Lengthened, and a 32-byte minimum is now enforced by settings.
- `refresh_cookie_secure` defaulted to `true`, so the cookie was never sent over plain HTTP
  and local development could not refresh at all. It is now derived from the environment,
  and production refuses to boot with it disabled or with the shipped signing key.
- `email-validator` rejected `.local` addresses, which an on-premise laboratory commonly
  uses — and the `create-admin` CLI accepted what the API would have refused. `.local` is now
  accepted; `localhost`, `invalid`, `arpa`, `onion` and `test` remain rejected.
- A non-IP peer address (a unix socket, a test client, a misconfigured proxy) would raise on
  insert into the `INET` audit column and take down the request it was only annotating.
  The address is validated at the boundary and dropped if it is not one.
- `update_user` returned the role it had just replaced, because the relationship was loaded
  before the change.

### Tests
- 138 backend tests (up from 51) and 21 frontend tests, all passing. Backend coverage 95%.
- Security unit tests cover expiry, forged signatures, `alg=none`, tampered payloads,
  wrong token type, and malformed input.
- Integration tests assert the properties that matter: an unknown email and a wrong password
  are **byte-identical** in status, code and message; the attempt counter survives the failed
  request; a replayed refresh token revokes the family and locks out the legitimate holder
  too; a deactivated user's live token stops working immediately; the last administrator
  cannot be removed.
- The permission matrix is asserted at the API per role × endpoint — not by checking that a
  button is disabled.

## [0.3.0] — 2026-08-19 — Phase 3: analytics and versioned configuration

### Added — backend
- **Analytics CRUD** with slug validation, case-insensitive name uniqueness, and creation
  that produces the analytics *and* its configuration version 1 atomically — an analytics
  without configuration could never be processed.
- **Append-only configuration versioning.** An edit inserts version N+1 and repoints the
  active pointer; no UPDATE is ever issued against a stored payload. Version history, a
  historical-version reader, and a structured diff.
- **Path-addressed configuration diff** that treats rule and classification lists as keyed
  collections, so reordering rules reports no change rather than a wholesale rewrite.
- **`ConfigurationValidator`** (spec section 39) reading its numeric bounds from
  `rule_definitions.parameter_schema` rather than from Python — the same definition drives
  the UI form, the client schema and the server check, so a threshold cannot be acceptable
  on one side of the wire and refused on the other. Covers bounds, choices, unknown and
  missing parameters, duplicate priorities, minimum-required arithmetic, the cut-off source
  actually being one of the run's controls, absolute RT mode needing a window, and every
  regular expression compiling.
- **`resolve_snapshot`** — the payload Phase 4 will pin each session to, validated again at
  the moment of taking it, because a snapshot is only worth having if it can be executed.
- `GET /api/rule-definitions`, `GET/POST /api/analytics`, `GET/PUT /api/analytics/{id}`,
  `GET/POST /api/analytics/{id}/configuration`, and the two version endpoints.

### Added — frontend
- Analytics list with an honest empty state and a create form that derives a code from the
  name without preventing an override.
- Analytics detail with the eight specified tabs; Overview, Configuration and Configuration
  History are real, the rest state which phase builds them.
- **A configuration editor that renders entirely from the server's catalogue** — control
  type, bounds, units, choices and help text all arrive from `/api/rule-definitions`. It can
  render a rule it has never heard of, which is the point: adding a rule needs no frontend
  change, and no threshold can live in this codebase.
- Reusable `DataTable`; per-field validation errors from the server shown against the field
  that caused them.

### Tests
- 210 backend tests (up from 138) and 44 frontend tests, all passing. Backend coverage 96%.
- `test_analytics.py` proves version 1 is **byte-identical** after an edit — the mechanism
  behind spec section 35.
- `test_snapshot.py` proves a snapshot is a copy, not a live view: pin at 25%, change the
  configuration to 10%, and the snapshot still reads 25%.
- `test_configuration_validation.py` (34 tests) covers every refusal, including one that
  widens a bound *in the database* and shows the validator follow it — proof the bound is not
  duplicated in code.
- `no-business-constants.test.ts` scans feature source for tolerances, thresholds, cut-offs
  and calibrator/control identities. It was verified to fail on an injected literal and pass
  once removed, so it is enforcement rather than decoration.

## [0.4.0] — 2026-08-19 — Phase 4: upload, storage, CSV parsing and classification

### Added — backend
- **`FileStorage` protocol** with a local filesystem backend (spec section 33). Writes go
  through a temporary file and an atomic rename, so a crash mid-upload leaves a temp file
  rather than a truncated object that looks complete. Size limits are enforced against bytes
  actually read, never a `Content-Length` a client could lie about.
- **Streaming CSV parser**: encoding ladder (UTF-8 → BOM → cp1252 → latin-1), delimiter
  sniffing, header captured verbatim and in order, blank headers made addressable and
  duplicates renamed rather than silently dropped, 1-based `source_row_number` on every row.
  Blank rows are skipped, counted and reported; malformed rows are flagged and carried
  forward — one bad row never ends a run.
- **Pure value interpretation** (`app/criteria/values.py`): `----` is MISSING and never
  numeric zero; `N.I. High` / `N.I. Low` are distinct kinds rather than coerced numbers; all
  numbers are `Decimal`. The raw token is always preserved.
- **Rule-driven classification** using Sample Type **and** Sample ID, first match by
  priority. Every row records the rule that classified it, so the UI can answer "why is this
  a control?" with the actual reason. `BLANK` / `Double Blank` are never patient rows.
- **Column role resolution** by configurable patterns — the instrument writes `%Diff` where
  the specification writes `% Diff`, and literal matching would leave the calibration rule
  unable to run. A column binds to at most one role, so `Conc.` and `Std. Conc.` cannot
  collide.
- **The processing state machine**, closed and tested: the only state that can reach
  `PROCESSING_PATIENTS` is `READY`.
- **Upload service**: SHA-256 during the stream, duplicate detection that flags without
  refusing or deleting, server-generated storage keys (no user string ever reaches a path),
  and a `processing_session` pinned to a configuration snapshot and engine version at the
  moment of upload.
- `POST/GET /api/analytics/{id}/files`, `GET /api/files`, `GET /api/files/{id}`,
  `GET /api/files/{id}/preview`, `GET /api/files/{id}/download`.
- The analytics list now reports **real** file and session counts from a grouped query.

### Added — frontend
- Drag-and-drop `FileDropzone`, `UploadPanel` showing the classified streams and every
  server warning, cross-analytics `FilesPage`, `FileDetailPage` with server-side preview,
  stream filters, the column-role mapping (including roles with no column), and a
  first-50-rows table showing values exactly as uploaded.
- A Files tab on the analytics detail page.

### Tests
- 354 backend tests (up from 210) and 55 frontend tests, all passing. Backend coverage 96%.
- All four real Cocaine exports parse with the expected shape; run 01 gives 7 calibrators,
  4 controls (WCS1–3 plus `UC`) and 118 patient rows.
- Proven: the stored file is byte-identical to the upload and the download returns exactly
  those bytes; `----` survives to the row verbatim; a `../../etc/passwd.csv` filename never
  reaches a storage key; duplicates are flagged and still processable; blank rows are never
  persisted and so can never reach a report.
- **Performance (opt-in, `pytest -m slow`)**: a synthetic 500 000-row / 34 MB export parses
  end to end in 12.5 s with **74 MB** peak RSS growth, and previewing a 50 000-row file
  takes 19 ms — the streaming is real, not asserted.

### Notes
- Parsing currently runs **synchronously inside the upload request**. At 500 000 rows that
  is ~12 s, too long to hold an HTTP request in production. The state machine and service
  boundaries are already shaped for a worker, so Phase 7 moves it to Celery without a
  redesign.
- `recovery` and `avg_recovery` are reported as unmapped for every real export, which is
  D-05 made visible at upload rather than discovered when a rule quietly does nothing.

## [0.5.0] — 2026-08-19 — Phase 5: the pure criteria engine

Built and tested entirely against constructed objects, before any wiring. Nothing in this
phase touches a database, a request or a file — the engine is the part that must be provably
correct, and building it after the persistence layer is how query convenience leaks into rule
logic.

### Added — `app/criteria/`
- **Models**: `RowData`, `RuleConfig`, `RuleResult`, `RowEvaluation`, `CalculationTrace`,
  `CalibratorPoint`, `ControlPoint`, `EvaluationContext` — frozen dataclasses throughout.
- **Derivations** with a trace each: ion-ratio range (SPAN and MULTIPLICATIVE), retention-time
  window (PERCENTAGE and ABSOLUTE, MEAN and MEDIAN), concentration cut-off (control Std. Conc.
  or a fixed value), calibrated range, and the ISTD basis. Every excluded calibrator is
  reported **with its reason**, so an invalid `Cal_1` cannot move a limit unnoticed.
- **All seven rules**, each returning the full section 14 payload rather than a boolean.
- **The engine**, with four guarantees: every applicable rule runs (no short-circuit); PASSED
  only if every enabled mandatory rule passed; an exception inside a rule fails that row and
  the run continues; a row nothing could evaluate is FAILED, never PASSED.

### Verified
- The specification's worked example reproduces exactly: `40, 62 @ 10%` → **37.8 – 64.2**.
- The real run 01 derives ion ratio `24.45 – 34.77`, RT `3.479 – 5.218` (average 4.3484),
  cut-off `1.5`, calibrated range `1 – 100`.
- All four real exports process end to end with no engine error. Run 01: 118 patient rows,
  65 passed, 53 failed, with all seven failure codes represented.
- Determinism: 50 repeated evaluations of the same inputs give identical verdicts, and
  evaluation never mutates its inputs.

### Tests
- 546 backend tests (up from 354). **Criteria coverage 98%**, above the 95% gate.
- `mypy --strict` passes on `app/criteria` (16 files).
- **Purity is enforced, not documented**: `test_purity.py` parses every module's imports and
  rejects FastAPI, SQLAlchemy, psycopg, the app's own I/O layers, and non-deterministic
  stdlib (`random`, `time`, `os`, `io`). Verified to fail on injected `sqlalchemy` and
  `random` imports, then pass once removed.

### Decisions
- **D-17 (new, OPEN)** — which failures zero the concentration. The approved specification
  zeroes in exactly one place (section 9, the cut-off); the earlier version also zeroed on an
  ion-ratio failure. Implemented per the approved text: only the cut-off zeroes, via its
  existing `zero_on_fail` parameter. Not made configurable per rule pre-emptively, because the
  configuration validator requires an exact parameter match and adding one would invalidate
  every stored configuration version.
- **D-12 extended** — a numeric result below the lowest calibrator uses the same
  `UNDER_CALIBRATION_RANGE` code as `N.I. Low`. On real data a below-cut-off result is usually
  also below the lowest calibrator, so such a row reports **two** failures. Both are true and
  section 13 asks for every applicable failure, so they are not collapsed. A reported zero
  stays exempt.
