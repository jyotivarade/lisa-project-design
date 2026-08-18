# LISA backend

FastAPI · SQLAlchemy 2.0 · Alembic · PostgreSQL. See [../docs](../docs) for the design.

## Layout

```
app/
  api/          HTTP only: routing, status codes, RBAC dependencies
  core/         settings · logging · errors · database · pagination · rule catalogue · seed
  models/       SQLAlchemy models (21 tables)
  schemas/      Pydantic DTOs — the wire contract              (Phase 2+)
  repositories/ queries; the only layer that touches an ORM session   (Phase 3+)
  services/     use cases, transactions, state machine, the gate      (Phase 3+)
  criteria/     PURE domain: rules and engine. No FastAPI, no SQLAlchemy, no I/O  (Phase 5)
  processing/   CSV parsing, classification, orchestration, outputs   (Phase 4+)
  storage/      FileStorage protocol → local | S3                     (Phase 4)
  audit/        audit writer                                          (Phase 10)
  auth/         permission catalogue, password policy, bootstrap admin
  tests/        unit/ integration/ fixtures/
```

The dependency rule is one-way: `api → services → repositories → models`. `app/criteria/`
imports nothing above it and nothing that performs I/O, which is what makes every rule
unit-testable without a database (AD-3).

## Commands

```bash
uv sync                              # install
uv run alembic upgrade head          # migrate
uv run alembic downgrade base        # roll back completely
uv run alembic check                 # fail if models and migrations disagree
uv run python -m app.cli seed        # idempotent reference data
uv run python -m app.cli check-db    # verify connectivity
uv run uvicorn app.main:app --reload
uv run pytest
```

## Adding a migration

```bash
uv run alembic revision --autogenerate -m "what changed"
uv run alembic check                 # must report no new operations
```

`alembic check` is also a test: models and migrations drifting apart is how a schema
silently stops matching what the application believes.
