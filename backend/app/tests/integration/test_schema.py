"""The migrated schema is the one the application expects, and its constraints are
real database constraints rather than Python-side intentions."""

import uuid

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.models import Base
from app.tests.conftest import requires_db

pytestmark = [pytest.mark.integration, requires_db]

EXPECTED_TABLES = {
    "analytics",
    "analytics_configuration_versions",
    "analytics_configurations",
    "audit_logs",
    "calculation_traces",
    "calibrator_selections",
    "control_selections",
    "output_files",
    "permissions",
    "processing_events",
    "processing_results",
    "processing_rows",
    "processing_sessions",
    "refresh_tokens",
    "role_permissions",
    "roles",
    "row_corrections",
    "rule_definitions",
    "rule_results",
    "uploaded_files",
    "users",
}


def test_every_designed_table_exists(db_engine) -> None:
    actual = set(inspect(db_engine).get_table_names()) - {"alembic_version"}
    assert actual == EXPECTED_TABLES
    assert actual == set(Base.metadata.tables)


@pytest.mark.parametrize(
    ("table", "columns"),
    [
        # docs/01 section 29: the indexes the specification requires by name.
        ("uploaded_files", {"analytics_id", "uploaded_at"}),
        ("processing_sessions", {"analytics_id", "created_at"}),
        ("processing_sessions", {"state"}),
        ("processing_rows", {"session_id", "stream"}),
        ("processing_rows", {"sample_id"}),
        ("processing_results", {"session_id", "final_result"}),
        ("processing_results", {"analyte_name"}),
        ("calibrator_selections", {"session_id"}),
        ("control_selections", {"session_id"}),
        ("audit_logs", {"session_id"}),
    ],
)
def test_required_indexes_exist(db_engine, table: str, columns: set[str]) -> None:
    indexed = [
        set(ix["column_names"]) for ix in inspect(db_engine).get_indexes(table)
    ]
    assert any(columns <= cols for cols in indexed), (
        f"{table} has no index covering {columns}; found {indexed}"
    )


def test_analytical_values_are_numeric_not_float(db_engine) -> None:
    """Binary floating point cannot promise that 27.87 compares to 25 the same way
    on every machine and every rerun. Reproducibility is the product."""
    inspector = inspect(db_engine)
    for table in ("calibrator_selections", "control_selections", "processing_results"):
        for column in inspector.get_columns(table):
            type_name = str(column["type"]).upper()
            assert "FLOAT" not in type_name and "DOUBLE" not in type_name, (
                f"{table}.{column['name']} is {type_name}"
            )


def test_session_state_check_constraint_rejects_an_invented_state(db, db_engine) -> None:
    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO processing_sessions "
                "(id, uploaded_file_id, analytics_id, session_number, state, "
                " config_snapshot, engine_version, calibration_verdict, control_verdict, "
                " created_at, updated_at) "
                "VALUES (:id, :fid, :aid, 1, 'DEFINITELY_NOT_A_STATE', '{}', '1.0.0', "
                " 'NOT_REVIEWED', 'NOT_REVIEWED', now(), now())"
            ),
            {"id": uuid.uuid4(), "fid": uuid.uuid4(), "aid": uuid.uuid4()},
        )


def test_correction_reason_cannot_be_blank(db) -> None:
    """Spec section 19 requires a reason. A whitespace-only reason is not a reason."""
    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO row_corrections "
                "(id, session_id, processing_row_id, stream, column_role, column_name, "
                " original_value, corrected_value, reason, corrected_by_id, "
                " corrected_at, is_active, created_at, updated_at) "
                "VALUES (:id, :sid, :rid, 'CALIBRATOR', 'percent_diff', '%Diff', "
                " '27.87', '24.10', '   ', :uid, now(), true, now(), now())"
            ),
            {
                "id": uuid.uuid4(),
                "sid": uuid.uuid4(),
                "rid": uuid.uuid4(),
                "uid": uuid.uuid4(),
            },
        )


def test_user_email_must_be_stored_lowercase(db) -> None:
    """Email is the login identity. Two users differing only in case would be a
    security hazard, so the database refuses the mixed-case form outright."""
    from app.core.seed import seed_reference_data

    seed_reference_data(db)  # the insert below needs a real role to reference
    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO users (id, email, password_hash, full_name, role_id, "
                " is_active, failed_login_count, created_at, updated_at) "
                "SELECT :id, 'Mixed.Case@Example.COM', 'x', 'Test', r.id, true, 0, "
                " now(), now() FROM roles r WHERE r.name = 'ADMIN'"
            ),
            {"id": uuid.uuid4()},
        )
