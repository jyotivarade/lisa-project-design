"""Application settings — 12-factor, environment-driven.

Nothing here is a *business* value. Business configuration (tolerances, adjustments,
thresholds) lives in the database per Analytics (AD-2 / docs/05-CONFIGURATION.md).
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LISA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- application ---------------------------------------------------------
    app_name: str = "LISA"
    environment: Literal["development", "test", "staging", "production"] = "development"
    debug: bool = False
    api_prefix: str = "/api"

    # --- database ------------------------------------------------------------
    database_url: PostgresDsn = Field(
        default="postgresql+psycopg://postgres@localhost:5432/lisa",  # type: ignore[arg-type]
        description="SQLAlchemy URL. Must use the psycopg (v3) driver.",
    )
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_echo: bool = False

    # --- storage (Phase 4 uses these; declared here so the contract is one place) ---
    storage_backend: Literal["local", "s3"] = "local"
    storage_local_root: str = "./var/storage"
    max_upload_bytes: int = 104_857_600  # 100 MB, per docs/00 NFR

    # --- security ------------------------------------------------------------
    secret_key: str = Field(
        default="dev-only-insecure-key-change-me-0123456789",
        min_length=32,
        description=(
            "JWT signing key. MUST be overridden outside development. At least 32 "
            "bytes, per RFC 7518 section 3.2 for HS256."
        ),
    )
    jwt_algorithm: str = "HS256"
    access_token_ttl_seconds: int = 900  # 15 minutes
    refresh_token_ttl_seconds: int = 604_800  # 7 days
    refresh_cookie_name: str = "lisa_refresh"
    # Resolved from the environment when unset: a Secure cookie is never sent
    # over plain HTTP, so leaving it hard-coded True would silently break local
    # development while looking correct.
    refresh_cookie_secure: bool | None = None
    cors_origins: list[str] = ["http://localhost:5173"]

    # Password policy. Values, not code — a laboratory's policy is its own.
    password_min_length: int = 12
    password_require_upper: bool = True
    password_require_lower: bool = True
    password_require_digit: bool = True
    password_require_symbol: bool = False

    # Account lockout after repeated failures (spec section 31).
    login_max_attempts: int = 5
    login_lockout_seconds: int = 900
    # Per-IP throttle on the login route. In-process for now; Redis-backed in
    # Phase 12, where there is more than one API replica to coordinate.
    login_rate_limit_attempts: int = 20
    login_rate_limit_window_seconds: int = 60

    # --- logging -------------------------------------------------------------
    log_level: str = "INFO"
    log_json: bool = True

    @field_validator("database_url")
    @classmethod
    def _require_psycopg(cls, v: PostgresDsn) -> PostgresDsn:
        if v.scheme not in ("postgresql+psycopg", "postgresql"):
            raise ValueError(
                f"database_url must use the postgresql+psycopg driver, got {v.scheme!r}"
            )
        return v

    @property
    def sqlalchemy_url(self) -> str:
        url = str(self.database_url)
        # Normalise the bare scheme so we never silently fall back to psycopg2.
        return url.replace("postgresql://", "postgresql+psycopg://", 1)

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def _resolve_cookie_security(self) -> "Settings":
        if self.refresh_cookie_secure is None:
            object.__setattr__(
                self,
                "refresh_cookie_secure",
                self.environment not in ("development", "test"),
            )
        return self

    @model_validator(mode="after")
    def _reject_default_secret_in_production(self) -> "Settings":
        # A deployment that silently runs on the shipped key is a deployment whose
        # tokens anyone can forge. Fail at boot, loudly, instead.
        if self.is_production and self.secret_key == "dev-only-insecure-key-change-me-0123456789":
            raise ValueError("LISA_SECRET_KEY must be set outside development")
        if self.is_production and not self.refresh_cookie_secure:
            raise ValueError("LISA_REFRESH_COOKIE_SECURE cannot be disabled in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
