"""Settings behaviour."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_database_url_must_use_psycopg_driver() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="mysql://user@localhost/lisa")


def test_bare_postgresql_scheme_is_normalised_to_psycopg() -> None:
    # Left alone, SQLAlchemy would silently look for psycopg2 and fail at runtime.
    s = Settings(database_url="postgresql://user@localhost:5432/lisa")
    assert s.sqlalchemy_url.startswith("postgresql+psycopg://")


def test_defaults_are_development_safe() -> None:
    s = Settings()
    assert s.environment == "development"
    assert s.is_production is False
    assert s.api_prefix == "/api"
