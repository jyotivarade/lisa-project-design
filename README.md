# LISA — Laboratory Information System Analysis

LISA processes CSV files exported from laboratory instruments. It classifies every row as
calibrator, control or patient, validates the run's calibration and quality controls, and —
**only when that validation passes** — evaluates every patient row independently through a
configurable criteria engine, producing a PASSED file, an exception report, and a permanent,
auditable processing record.

The safety property the whole system is built around:

> **Patient results are never produced from a run whose calibration or controls have not passed.**

React + TypeScript · Python + FastAPI · PostgreSQL · SQLAlchemy + Alembic · pure criteria engine.

---

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Architecture and planning | ✅ complete — `docs/` |
| 1 | Project skeleton and database | ✅ complete |
| 2 | Authentication and RBAC | ✅ complete |
| 3 | Analytics and configuration | ✅ complete |
| **4** | **File upload and CSV parsing** | ✅ **complete** |
| 5 | Criteria engine | next |
| 6 | Calibration/control validation and the processing gate | |
| 7 | Patient processing | |
| 8 | Output files and reports | |
| 9 | Dashboard and complete frontend | |
| 10 | Audit logging | |
| 11 | Testing | |
| 12 | Docker, deployment, documentation | |

Requirement-by-requirement status: [REQUIREMENTS.md](REQUIREMENTS.md).
Business-rule decisions and open questions: [DECISIONS.md](DECISIONS.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/00-ARCHITECTURE.md](docs/00-ARCHITECTURE.md) | System architecture, folder structures, security |
| [docs/01-DATA-MODEL.md](docs/01-DATA-MODEL.md) | Schema, entity relationships, indexes |
| [docs/02-PROCESSING-ENGINE.md](docs/02-PROCESSING-ENGINE.md) | Workflows, state machine, criteria engine, formulas |
| [docs/03-API-CONTRACT.md](docs/03-API-CONTRACT.md) | REST surface and contract guarantees |
| [docs/04-FRONTEND.md](docs/04-FRONTEND.md) | Frontend architecture and screens |
| [docs/05-CONFIGURATION.md](docs/05-CONFIGURATION.md) | Configuration model and snapshot strategy |
| [docs/06-IMPLEMENTATION-PLAN.md](docs/06-IMPLEMENTATION-PLAN.md) | Phases, exit criteria, risks |
| [docs/07-TESTING.md](docs/07-TESTING.md) | Testing strategy |

## Repository layout

```
backend/          FastAPI application, criteria engine, migrations, tests
frontend/         React + TypeScript application
docs/             Architecture and design documents
prototype/        The original vanilla-JS prototype — behavioural reference, still runnable
docker-compose.yml
```

`prototype/` is kept unchanged and unported. It is the reference for the criteria and
column-mapping behaviour; where it disagrees with the specification, the specification wins
and the difference is recorded in [DECISIONS.md](DECISIONS.md).

## Running it

### With Docker

```bash
cp backend/.env.example backend/.env
docker compose up --build
# API      http://localhost:8000/api/docs
# Frontend http://localhost:5173
```

The `migrate` service runs Alembic and seeds reference data before the API starts.

### Locally

Requires Python 3.12+ (via [uv](https://docs.astral.sh/uv/)), Node 20+, and PostgreSQL 14+.

```bash
# --- database ---
createdb lisa && createdb lisa_test

# --- backend ---
cd backend
cp .env.example .env                 # set LISA_DATABASE_URL for your machine
uv sync
uv run alembic upgrade head          # create the schema
uv run python -m app.cli seed        # roles, permissions, rule catalogue
uv run python -m app.cli create-admin \
    --email admin@lisa.local --full-name "Lab Administrator"
uv run uvicorn app.main:app --reload --port 8000

# --- frontend (second terminal) ---
cd frontend
npm install
npm run dev                          # http://localhost:5173, /api proxied to :8000
```

## Testing

```bash
cd backend
uv run pytest                        # unit + integration (needs PostgreSQL)
uv run pytest -m slow -s             # opt-in performance checks (500k-row parse)
uv run pytest -m "not integration"   # unit only, no database
uv run ruff check .

cd frontend
npm test
npm run typecheck
npm run build
```

Integration tests migrate `lisa_test` with Alembic — the same path a deployment takes — and
run each test inside a transaction that is rolled back. Override the target with
`LISA_TEST_DATABASE_URL`.

## Test fixtures

`backend/app/tests/fixtures/` holds real LC-MS/MS exports used **only** by the test suite.
They are never seeded into any database: an empty installation reports
"No analytics data available" rather than fabricating numbers.

Two of the four Cocaine runs contain genuine QC failures (`Cal_4 %Diff 27.87`,
`WCS1 %Diff 61.22`, `WCS2 %Diff 73.90`), which is what makes them the right fixtures for
proving the processing gate actually blocks.

## Accounts

There is no self-service registration: a laboratory system with open signup has no meaningful
access control. The first administrator is created with `python -m app.cli create-admin`
(omit `--password` to be prompted), and every account after that is created by an
administrator through **Administration → Users**.

Roles are `ADMIN`, `ANALYST` and `VIEWER`. Permissions are rows in the database, not
hard-coded checks, so a role can be re-scoped without a deployment. An analyst runs the
laboratory workflow end to end but cannot administer users or read the audit trail.

## Business configuration

No tolerance, adjustment percentage, threshold, calibrator ID or control ID is hard-coded in
either application. Defaults are seeded once into `rule_definitions` from
`backend/app/core/rule_catalog.py`; from then on the values live in the database per
Analytics, and each processing session stores an immutable snapshot of the configuration it
actually used — so changing configuration can never alter a historical result.
