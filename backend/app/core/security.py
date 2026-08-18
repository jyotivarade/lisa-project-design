"""Password hashing, JWT issuance and refresh-token material.

Everything cryptographic lives here so there is exactly one place to audit.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import get_settings
from app.core.errors import ErrorCode, LisaError

# Argon2id with the library's current defaults, which track OWASP guidance.
_hasher = PasswordHasher()

# Verifying this when no user matches keeps a failed login's timing indistinguishable
# from a wrong-password login, so the endpoint cannot be used to enumerate accounts.
_DUMMY_HASH = _hasher.hash("lisa-timing-equaliser")


class TokenError(LisaError):
    status_code = 401
    error_code = ErrorCode.NOT_AUTHENTICATED


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the stored hash predates the current cost parameters."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except (InvalidHashError, ValueError):
        return True


def equalise_timing() -> None:
    """Spend the same work as a real verification when the account does not exist."""
    verify_password("lisa-timing-equaliser-miss", _DUMMY_HASH)


def validate_password_policy(password: str) -> list[dict[str, str]]:
    """Return one entry per unmet requirement. Empty means the password is acceptable."""
    s = get_settings()
    problems: list[dict[str, str]] = []
    if len(password) < s.password_min_length:
        problems.append(
            {"field": "password", "issue": f"Must be at least {s.password_min_length} characters."}
        )
    if s.password_require_upper and not any(c.isupper() for c in password):
        problems.append({"field": "password", "issue": "Must contain an uppercase letter."})
    if s.password_require_lower and not any(c.islower() for c in password):
        problems.append({"field": "password", "issue": "Must contain a lowercase letter."})
    if s.password_require_digit and not any(c.isdigit() for c in password):
        problems.append({"field": "password", "issue": "Must contain a digit."})
    if s.password_require_symbol and password.isalnum():
        problems.append({"field": "password", "issue": "Must contain a symbol."})
    return problems


# --------------------------------------------------------------------------------
# Access tokens
# --------------------------------------------------------------------------------


@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: uuid.UUID
    role: str
    jti: str
    expires_at: datetime


def create_access_token(user_id: uuid.UUID, role: str) -> tuple[str, int]:
    """Return (token, ttl_seconds)."""
    s = get_settings()
    now = datetime.now(UTC)
    expires = now + timedelta(seconds=s.access_token_ttl_seconds)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "typ": "access",
    }
    token = jwt.encode(payload, s.secret_key, algorithm=s.jwt_algorithm)
    return token, s.access_token_ttl_seconds


def decode_access_token(token: str) -> AccessTokenClaims:
    s = get_settings()
    try:
        payload = jwt.decode(
            token,
            s.secret_key,
            algorithms=[s.jwt_algorithm],
            options={"require": ["exp", "sub", "typ"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError(
            "The access token has expired.", error_code=ErrorCode.TOKEN_EXPIRED
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("The access token is not valid.") from exc

    # A refresh token presented as a bearer credential must not be accepted.
    if payload.get("typ") != "access":
        raise TokenError("The access token is not valid.")
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise TokenError("The access token is not valid.") from exc

    return AccessTokenClaims(
        user_id=user_id,
        role=str(payload.get("role", "")),
        jti=str(payload.get("jti", "")),
        expires_at=datetime.fromtimestamp(payload["exp"], tz=UTC),
    )


# --------------------------------------------------------------------------------
# Refresh tokens
# --------------------------------------------------------------------------------


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """Refresh tokens are stored hashed.

    SHA-256 rather than Argon2 deliberately: the token is 384 bits of CSPRNG output,
    so it has no guessable structure to slow down, and refresh happens often enough
    that a deliberately slow hash would be a self-inflicted denial of service.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
