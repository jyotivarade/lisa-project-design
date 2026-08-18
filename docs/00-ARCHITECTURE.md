# LISA — System Architecture

**Laboratory Information System Analysis**
Status: **DESIGN v2 — awaiting approval before Phase 1.** No implementation code written.

---

## A. Architecture diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│  BROWSER — React 18 + TypeScript (Vite)                                   │
│  Router · TanStack Query · TanStack Table · react-hook-form + Zod · Toasts│
│  Dashboard │ Analytics │ Files │ Processing │ Results │ Profile │ Admin   │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │  HTTPS / JSON · Bearer access token
                                │  refresh token in HttpOnly cookie
┌───────────────────────────────▼───────────────────────────────────────────┐
│  FastAPI (ASGI)                                                           │
│                                                                           │
│   api/          routers, status codes, RBAC dependencies, error mapping   │
│        ▼                                                                  │
│   services/     use cases · transactions · STATE MACHINE · THE GATE       │
│        ▼                                                                  │
│   repositories/ the only layer that touches the ORM session               │
│        ▼                                                                  │
│   models/       SQLAlchemy 2.0 declarative                                │
│                                                                           │
│   processing/   CSV stream parse · classification · orchestration         │
│   criteria/     ◄── PURE. no FastAPI, no SQLAlchemy, no I/O, no auth      │
│   storage/      FileStorage protocol → LocalStorage | S3Storage           │
│   audit/        audit writer, same transaction as the mutation            │
│   auth/         Argon2 · JWT · refresh rotation · permissions             │
│   core/         settings · logging · errors · security · pagination       │
└──────┬──────────────────────┬───────────────────────┬─────────────────────┘
       │                      │                       │
┌──────▼────────────┐  ┌──────▼──────────┐  ┌─────────▼──────────┐
│  PostgreSQL 16    │  │  File storage   │  │  Redis + Celery    │
│  metadata         │  │  originals      │  │  parse task        │
│  config versions  │  │  passed CSV     │  │  patient-processing│
│  rows & results   │  │  exception CSV  │  │  task              │
│  audit trail      │  │  (immutable)    │  └─────────┬──────────┘
└───────────────────┘  └─────────────────┘            │
                                            ┌─────────▼──────────┐
                                            │  Worker (same image│
                                            │  same domain code) │
                                            └────────────────────┘
```

**Dependency rule.** `api → services → repositories → models`. `criteria/` imports nothing
above it and nothing with I/O (AD-3). `storage/` is reached only through the `FileStorage`
protocol. A rule that needs a database is a rule that is wrong: everything a rule needs is
placed in its `EvaluationContext` before the engine runs.

---

## Grounding: the real instrument data

Design decisions below are grounded in the LC-MS/MS exports in this repository's git history,
not in an idealised schema.

```
Analyte Name, Flags, Data Filename, Sample ID, Sample Type, Level, Area, ISTD Area,
Found RT, Ref 1 Set Ratio, Ref 1 Actual Ratio, Cal Point, Std. Conc. (ng/mL),
Conc. (ng/mL), %Diff, S/N, Acquired Date, Sample Name, Width(50%)
```

| Observation | Architectural consequence |
|---|---|
| The header is `%Diff`; the specification writes `% Diff` | Column **roles** resolved by configurable patterns, never literal header equality; user-overridable and versioned |
| Missing values are the token `----` | Configurable token list; `----` is MISSING, never numeric `0` (§28) |
| `UC` is `Sample Type = Control` with `%Diff = ----` | Controls carry a role; a discovered-but-not-required control cannot silently pass or fail (D-09) |
| `Cocaine_2026_08_02`: `Cal_4 %Diff = 27.87`, `WCS1 %Diff = 61.22`; `..._03`: `WCS2 = 73.90` | **Two of four real runs must be BLOCKED at the gate.** These are the integration fixtures — the gate is proven against real failures |
| `WCS1 Std. Conc. = 1.5` | The cut-off derives from a data row exactly as §9 specifies |
| **No `% Recovery` / `Average % Recovery` column exists in any real export** | §8's ISTD suppression inputs are absent; basis method must be configurable — **D-05, unresolved** |
| `Mitragynine` / `Temazepam` files are **not present in this repository** | §27 asks for them as fixtures. Only `Cocaine_*.csv` (4 files) and three generic QC exports exist. **Blocking item B-1** |

Fixtures live in `backend/app/tests/fixtures/` and are **never** seeded into any database (§27).

---

## D. Backend folder structure

```
backend/
  alembic/                     versions/ — one migration per phase, reversible
  app/
    main.py                    app factory, router mount, middleware, exception handlers
    api/
      deps.py                  get_db, get_current_user, require_permission
      v1/                      auth · dashboard · analytics · configuration · files
                               processing · calibration · controls · corrections
                               results · exceptions · audit · admin
    core/
      config.py                pydantic-settings, 12-factor
      security.py              Argon2, JWT encode/decode, token families
      errors.py                LisaError hierarchy → {error_code, message, details}
      logging.py               structured JSON, request_id + session_id on every line
      pagination.py            Page[T]
    models/                    SQLAlchemy: user, role, permission, analytics,
                               configuration, file, session, row, selection,
                               correction, rule, result, output, audit
    schemas/                   Pydantic v2 DTOs — the wire contract
    repositories/              one module per aggregate; no business logic
    services/
      auth_service.py  analytics_service.py  configuration_service.py
      file_service.py  processing_service.py  calibration_service.py
      control_service.py  correction_service.py  results_service.py
      dashboard_service.py  state_machine.py  gate.py
    criteria/                  ◄── PURE PACKAGE (AD-3)
      engine.py                CriteriaEngine.evaluate(row, context, rules)
      models.py                RowData, EvaluationContext, RuleResult, RowEvaluation
      context.py               builder inputs — plain data in, plain data out
      derivations.py           ion-ratio limits, RT window, cut-off, calibrated range
      registry.py              rule_key → rule class
      rules/
        base.py  calibration.py  control.py  istd.py  concentration.py
        ion_ratio.py  retention_time.py  calibration_range.py
    processing/
      csv_parser.py            streaming, encoding ladder, tokens, malformed rows
      classifier.py            Sample Type + Sample ID → stream, rule-driven
      context_builder.py       DB rows + snapshot → criteria.EvaluationContext
      orchestrator.py          per-session run, batching, progress
      output_writer.py         PASSED + EXCEPTION generation, CSV-injection guard
      tasks.py                 Celery tasks (thin wrappers over services)
    storage/
      base.py                  FileStorage protocol
      local.py  s3.py
    audit/
      recorder.py              write(actor, action, entity, old, new, metadata)
      actions.py               the action enum
    auth/                      password policy, permission catalogue, bootstrap admin
    tests/
      unit/ criteria/ processing/ services/
      integration/ api/ db/
      fixtures/                *.csv — TEST ONLY
      conftest.py  factories.py
  pyproject.toml  Dockerfile  alembic.ini
```

## E. Frontend folder structure

```
frontend/
  src/
    main.tsx  App.tsx  routes.tsx
    layouts/          AppShell (sidebar + header + breadcrumbs) · AuthLayout
    pages/            thin route components; composition only
    components/       DataTable · FileDropzone · StatusBadge · StatCard · Modal
                      ConfirmDialog · Toast · FormField · EmptyState · ErrorBoundary
                      BlockedBanner · CalculationPanel · RuleResultList
    features/
      auth/           LoginPage · ProtectedRoute · useAuth · in-memory token store
      dashboard/      DashboardPage · SummaryCards · PassFailChart · RecentActivity
      analytics/      AnalyticsListPage · AnalyticsDetailPage(8 tabs) · ConfigurationTab
      files/          FilesPage · UploadDropzone · FileDetailPage · FilePreview
      calibration/    CalibrationTable · CalibrationSummary · CorrectionDialog
      controls/       ControlTable · ControlSummary
      processing/     ProcessingPage · StateTimeline · GateCard · ProgressPanel
      results/        ResultsTable · ResultDetailDrawer · ExceptionsTable · Downloads
      administration/ UsersPage · RolesPage · RuleDefinitionsPage
      profile/        ProfilePage · ChangePasswordForm
    services/         api client (refresh-on-401, error_code → AppError) + per-resource
    hooks/            useSession · useGate · useProgress · usePermission
    types/            generated from OpenAPI (openapi-typescript)
    utils/            numeric formatting, dates, guards
  vite.config.ts  tsconfig.json  Dockerfile  nginx.conf
```

**No business constant may appear anywhere under `frontend/src/`.** Tolerances, adjustment
percentages, calibrator IDs, control IDs, cut-off sources and thresholds are rendered from
`GET /api/rule-definitions` and the analytics configuration. A numeric business literal in a
feature component fails review (§43).

---

## O. Security architecture

| Concern | Mechanism |
|---|---|
| Password storage | **Argon2id** (`argon2-cffi`), tunable cost; policy: ≥ 12 chars, complexity, breach-list check on set |
| Access token | JWT, 15 min, `sub`/`role`/`jti`, in-memory on the client only — never `localStorage` |
| Refresh token | 7 d, opaque, stored **hashed**, `family_id`; **rotation on every use**; reuse of a rotated token revokes the whole family |
| Logout | Revokes the family; audited |
| RBAC | Table-driven: `roles`, `permissions`, `role_permissions`. `require_permission("processing:execute")` as a FastAPI dependency on every mutating route. ADMIN / ANALYST / VIEWER seeded |
| The gate | Enforced in three layers (AD-2): UI disable → service assertion → **`SELECT … FOR UPDATE` + verdict re-check inside the processing transaction** (§36). API answers `409` with an explicit `error_code` |
| Input validation | Pydantic v2 on every body/path/query; numeric bounds sourced from the rule-definition registry |
| File validation | Extension allow-list, MIME sniff, configurable max size, encoding ladder, delimiter check, row/column sanity; rejected before a single row is persisted |
| Safe filenames | User filenames are metadata only. Storage keys are server-generated UUID paths — no user string ever reaches the filesystem |
| Path traversal | Impossible by construction (see above) + key normalisation assertion in `FileStorage` |
| SQL injection | ORM/parameterised only; no string-built SQL anywhere; CSV values never reach a query builder |
| CSV injection | Every exported cell starting `= + - @ TAB CR` is prefixed with `'` in `output_writer` |
| CORS | Explicit origin allow-list from settings; credentials enabled only for the refresh route |
| Secure headers | HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP on the served frontend |
| Rate limiting | Per-IP and per-account on `/auth/login`, exponential lockout |
| Audit | Written in the **same transaction** as the mutation — an action that succeeds is always logged, an action that rolls back is never logged (§23) |
| Error leakage | A global handler maps every exception to `{error_code, message, details}`; stack traces go to logs with a `request_id`, never to the client (§25) |

---

## Non-functional targets

| Target | Value | Mechanism |
|---|---|---|
| Max upload | configurable, default 100 MB | streamed to storage in chunks; never fully buffered |
| Parse memory | O(chunk) not O(file) | `csv.reader` over a streamed handle; 1 000-row insert batches |
| Patient throughput | ≥ 5 000 rows/s/worker (7 rules) | pure functions over a prebuilt context; zero per-row I/O |
| Progress latency | ≤ 2 s | counters written per batch; UI polls at 1.5 s while PROCESSING_PATIENTS |
| Determinism | byte-identical outputs for the same inputs | `Decimal` throughout; no clock/random in `criteria/`; `engine_version` stamped per session |

## Deployment

`docker compose`: `api`, `worker`, `postgres`, `redis`, `frontend` (nginx). Alembic runs as an
init job — never `create_all` outside tests. `/health/live` and `/health/ready` (DB, Redis,
storage). All configuration via environment; `.env.example` committed, `.env` never.

## Relationship to the existing prototype

The vanilla-JS prototype at the repository root is the **behavioural reference** for the
criteria and column-mapping logic. Phase 0 moves it to `prototype/` unchanged and still
runnable. It is not ported and not deleted. Where it disagrees with this specification —
notably the ion-ratio formula — the specification wins and the difference is recorded in
`DECISIONS.md` (D-01), not silently inherited.
