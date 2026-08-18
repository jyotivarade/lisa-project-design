"""Test fixtures.

Integration tests run against a real PostgreSQL database (LISA_TEST_DATABASE_URL,
default `lisa_test`), created and migrated once per session. Real database, real
constraints — a CHECK constraint that only exists in SQLAlchemy metadata is not a
constraint.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# Meets the default password policy; used by every auth fixture.
TEST_PASSWORD = "Str0ngTestPassw0rd"

TEST_DATABASE_URL = os.environ.get(
    "LISA_TEST_DATABASE_URL",
    f"postgresql+psycopg://{os.environ.get('USER', 'postgres')}@localhost:5432/lisa_test",
)


def _database_available(url: str) -> bool:
    try:
        engine = create_engine(url)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


requires_db = pytest.mark.skipif(
    not _database_available(TEST_DATABASE_URL),
    reason=f"PostgreSQL not reachable at {TEST_DATABASE_URL}",
)


@pytest.fixture(scope="session")
def db_engine() -> Iterator[Engine]:
    """Migrate the test database with Alembic — the same path production uses.

    Deliberately not `Base.metadata.create_all`: that would test a schema no
    deployment ever runs.
    """
    os.environ["LISA_DATABASE_URL"] = TEST_DATABASE_URL

    from alembic.config import Config

    from alembic import command
    from app.core.config import get_settings

    get_settings.cache_clear()

    root = Path(__file__).resolve().parents[2]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    engine = create_engine(TEST_DATABASE_URL, future=True)
    yield engine
    engine.dispose()


@pytest.fixture
def db(db_engine: Engine) -> Iterator[Session]:
    """A session inside a transaction that is always rolled back.

    `join_transaction_mode="create_savepoint"` means a `commit()` under test — and
    the services do commit, deliberately, so failed-login bookkeeping survives —
    releases a savepoint rather than ending the outer transaction. Tests therefore
    exercise the real commit path and still leave the database untouched.
    """
    connection = db_engine.connect()
    transaction = connection.begin()
    session = sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    """A TestClient whose requests run in the test's transaction."""
    from app.api.deps import login_rate_limiter
    from app.core.database import get_db
    from app.main import create_app

    login_rate_limiter.reset()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def seeded(db: Session) -> Session:
    """Roles, permissions and the rule catalogue present."""
    from app.core.seed import seed_reference_data

    seed_reference_data(db)
    return db


@pytest.fixture
def make_user(seeded: Session):
    """Factory for a user with a known password."""
    from app.core.security import hash_password
    from app.models import User
    from app.models.enums import RoleName
    from app.repositories import user_repository as users

    created: list[User] = []

    def _make(
        email: str = "analyst@lisa.local",
        password: str = TEST_PASSWORD,
        role: RoleName = RoleName.ANALYST,
        *,
        is_active: bool = True,
        full_name: str = "Test User",
    ) -> User:
        role_row = users.get_role_by_name(seeded, role.value)
        assert role_row is not None, "roles must be seeded"
        user = User(
            email=users.normalise_email(email),
            full_name=full_name,
            password_hash=hash_password(password),
            role_id=role_row.id,
            is_active=is_active,
        )
        seeded.add(user)
        seeded.flush()
        created.append(user)
        return user

    return _make


@pytest.fixture
def login(client: TestClient, make_user):
    """Create a user, sign in, and return (user, authorised headers)."""
    from app.models.enums import RoleName

    def _login(
        role: RoleName = RoleName.ANALYST,
        email: str = "analyst@lisa.local",
        password: str = TEST_PASSWORD,
    ):
        user = make_user(email=email, password=password, role=role)
        response = client.post("/api/auth/login", json={"email": email, "password": password})
        assert response.status_code == 200, response.text
        token = response.json()["access_token"]
        return user, {"Authorization": f"Bearer {token}"}

    return _login


@pytest.fixture
def storage(tmp_path):
    """An isolated LocalFileStorage per test, wired into the app."""
    from app.core.config import get_settings
    from app.storage import get_storage
    from app.storage.local import LocalFileStorage

    root = tmp_path / "storage"
    settings = get_settings()
    original_root = settings.storage_local_root
    settings.storage_local_root = str(root)
    get_storage.cache_clear()
    backend = LocalFileStorage(root)
    yield backend
    settings.storage_local_root = original_root
    get_storage.cache_clear()


@pytest.fixture
def analytics_factory(client, login):
    """Create an analytics via the API and return (analytics, headers)."""
    from app.models.enums import RoleName

    def _make(name: str = "Cocaine", analyte: str | None = None, headers=None):
        if headers is None:
            headers = login(RoleName.ANALYST)[1]
        response = client.post(
            "/api/analytics",
            json={
                "name": name,
                "code": name.lower().replace(" ", "_"),
                "analyte_name": analyte or name,
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text
        return response.json(), headers

    return _make


@pytest.fixture
def upload_fixture(client, storage):
    """Upload one of the real instrument exports and return the response body."""

    def _upload(analytics_id: str, headers, filename: str = "Cocaine_2026_08_01.csv"):
        path = FIXTURES_DIR / filename
        with path.open("rb") as handle:
            response = client.post(
                f"/api/analytics/{analytics_id}/files",
                files={"files": (filename, handle, "text/csv")},
                headers=headers,
            )
        assert response.status_code == 201, response.text
        return response.json()["results"][0]

    return _upload


@pytest.fixture(scope="session")
def cocaine_run_01() -> Path:
    """A real LC-MS/MS export whose calibration and controls both pass."""
    return FIXTURES_DIR / "Cocaine_2026_08_01.csv"


@pytest.fixture(scope="session")
def cocaine_run_02() -> Path:
    """A real export that FAILS: Cal_4 %Diff 27.87 and WCS1 %Diff 61.22."""
    return FIXTURES_DIR / "Cocaine_2026_08_02.csv"
