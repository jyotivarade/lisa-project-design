"""Password hashing, policy and JWT handling."""

import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.config import get_settings
from app.core.errors import ErrorCode
from app.core.security import (
    TokenError,
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    validate_password_policy,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_is_argon2id_and_salted(self) -> None:
        first = hash_password("Str0ngTestPassw0rd")
        second = hash_password("Str0ngTestPassw0rd")
        assert first.startswith("$argon2id$")
        # Equal passwords must not produce equal hashes, or a leaked table would
        # reveal which users share a password.
        assert first != second

    def test_verify_accepts_the_password_and_rejects_everything_else(self) -> None:
        stored = hash_password("Str0ngTestPassw0rd")
        assert verify_password("Str0ngTestPassw0rd", stored)
        assert not verify_password("str0ngtestpassw0rd", stored)
        assert not verify_password("", stored)

    def test_verify_against_a_corrupt_hash_returns_false_rather_than_raising(self) -> None:
        # A damaged row must fail the login, not crash the endpoint.
        assert not verify_password("anything", "not-a-hash")
        assert not verify_password("anything", "")


class TestPasswordPolicy:
    def test_a_compliant_password_has_no_problems(self) -> None:
        assert validate_password_policy("Str0ngTestPassw0rd") == []

    @pytest.mark.parametrize(
        ("password", "expected_issue"),
        [
            ("Sh0rt", "at least"),
            ("alllowercase123", "uppercase"),
            ("ALLUPPERCASE123", "lowercase"),
            ("NoDigitsInHereAtAll", "digit"),
        ],
    )
    def test_violations_are_reported_per_field(self, password: str, expected_issue: str) -> None:
        problems = validate_password_policy(password)
        assert any(expected_issue in p["issue"] for p in problems)
        assert all(p["field"] == "password" for p in problems)

    def test_policy_comes_from_settings_not_from_code(self, monkeypatch) -> None:
        settings = get_settings()
        monkeypatch.setattr(settings, "password_min_length", 4)
        monkeypatch.setattr(settings, "password_require_digit", False)
        assert validate_password_policy("Abcd") == []


class TestAccessTokens:
    def test_round_trip_carries_the_subject_and_role(self) -> None:
        user_id = uuid.uuid4()
        token, ttl = create_access_token(user_id, "ANALYST")
        claims = decode_access_token(token)
        assert claims.user_id == user_id
        assert claims.role == "ANALYST"
        assert ttl == get_settings().access_token_ttl_seconds

    def test_each_token_has_a_distinct_id(self) -> None:
        user_id = uuid.uuid4()
        first, _ = create_access_token(user_id, "ADMIN")
        time.sleep(0.01)
        second, _ = create_access_token(user_id, "ADMIN")
        assert decode_access_token(first).jti != decode_access_token(second).jti

    def test_expired_token_is_rejected_with_a_specific_code(self) -> None:
        settings = get_settings()
        payload = {
            "sub": str(uuid.uuid4()),
            "role": "ADMIN",
            "typ": "access",
            "exp": int((datetime.now(UTC) - timedelta(seconds=1)).timestamp()),
        }
        token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
        with pytest.raises(TokenError) as excinfo:
            decode_access_token(token)
        assert excinfo.value.error_code == ErrorCode.TOKEN_EXPIRED

    def test_token_signed_with_another_key_is_rejected(self) -> None:
        payload = {
            "sub": str(uuid.uuid4()),
            "role": "ADMIN",
            "typ": "access",
            "exp": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp()),
        }
        forged = jwt.encode(payload, "an-attacker-key-that-is-long-enough!!", algorithm="HS256")
        with pytest.raises(TokenError):
            decode_access_token(forged)

    def test_unsigned_token_is_rejected(self) -> None:
        """The alg=none downgrade must not be accepted."""
        payload = {
            "sub": str(uuid.uuid4()),
            "role": "ADMIN",
            "typ": "access",
            "exp": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp()),
        }
        unsigned = jwt.encode(payload, key="", algorithm="none")
        with pytest.raises(TokenError):
            decode_access_token(unsigned)

    def test_tampered_payload_is_rejected(self) -> None:
        token, _ = create_access_token(uuid.uuid4(), "VIEWER")
        header, payload, signature = token.split(".")
        other, _ = create_access_token(uuid.uuid4(), "ADMIN")
        with pytest.raises(TokenError):
            decode_access_token(f"{header}.{other.split('.')[1]}.{signature}")

    def test_a_refresh_style_token_cannot_be_used_as_a_bearer_credential(self) -> None:
        settings = get_settings()
        payload = {
            "sub": str(uuid.uuid4()),
            "role": "ADMIN",
            "typ": "refresh",
            "exp": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp()),
        }
        token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
        with pytest.raises(TokenError):
            decode_access_token(token)

    @pytest.mark.parametrize("garbage", ["", "not.a.token", "a.b", "...."])
    def test_malformed_tokens_are_rejected(self, garbage: str) -> None:
        with pytest.raises(TokenError):
            decode_access_token(garbage)


class TestRefreshTokens:
    def test_tokens_are_long_and_unique(self) -> None:
        tokens = {generate_refresh_token() for _ in range(100)}
        assert len(tokens) == 100
        assert all(len(t) >= 43 for t in tokens)

    def test_hash_is_deterministic_and_not_the_token(self) -> None:
        token = generate_refresh_token()
        assert hash_refresh_token(token) == hash_refresh_token(token)
        assert token not in hash_refresh_token(token)
        assert hash_refresh_token(token) != hash_refresh_token(generate_refresh_token())
