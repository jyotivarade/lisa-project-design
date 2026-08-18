"""Authentication use cases: login, refresh rotation, logout, password change.

Threat handling in one place:
  * account enumeration  — identical response and identical timing for an unknown
                           email and a wrong password
  * credential stuffing  — per-account lockout plus a per-IP throttle
  * stolen refresh token — rotation on every use, and reuse of a rotated token
                           revokes the entire family
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.audit import RequestContext, record
from app.core.config import get_settings
from app.core.errors import ErrorCode, LisaError
from app.core.security import (
    create_access_token,
    equalise_timing,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    needs_rehash,
    validate_password_policy,
    verify_password,
)
from app.models import RefreshToken, User
from app.models.enums import AuditAction
from app.repositories import refresh_token_repository as tokens
from app.repositories import user_repository as users

logger = logging.getLogger(__name__)


class InvalidCredentialsError(LisaError):
    status_code = 401
    error_code = ErrorCode.INVALID_CREDENTIALS


class AccountLockedError(LisaError):
    status_code = 423
    error_code = ErrorCode.ACCOUNT_LOCKED


class InactiveAccountError(LisaError):
    status_code = 403
    error_code = ErrorCode.PERMISSION_DENIED


class TokenReuseError(LisaError):
    status_code = 401
    error_code = ErrorCode.TOKEN_REUSED


@dataclass(frozen=True)
class IssuedSession:
    user: User
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime


def _issue(
    db: Session,
    user: User,
    *,
    family_id: uuid.UUID | None = None,
    context: RequestContext | None = None,
) -> IssuedSession:
    settings = get_settings()
    access_token, ttl = create_access_token(user.id, user.role.name)
    refresh_token = generate_refresh_token()
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.refresh_token_ttl_seconds)

    stored = tokens.create(
        db,
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        family_id=family_id or uuid.uuid4(),
        expires_at=expires_at,
        user_agent=context.user_agent if context else None,
        ip=context.ip if context else None,
    )
    return IssuedSession(
        user=user,
        access_token=access_token,
        expires_in=ttl,
        refresh_token=refresh_token,
        refresh_expires_at=stored.expires_at,
    )


def _lockout_remaining(user: User) -> int | None:
    if user.locked_until is None:
        return None
    locked_until = user.locked_until
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    remaining = (locked_until - datetime.now(UTC)).total_seconds()
    return int(remaining) if remaining > 0 else None


def login(
    db: Session, *, email: str, password: str, context: RequestContext | None = None
) -> IssuedSession:
    """Authenticate, or raise.

    Failure paths commit before raising. The attempt counter, the lockout it
    triggers and the LOGIN_FAILED audit row are the security value of a failed
    login; rolling them back with the request would leave the account defenceless
    against exactly the attack they exist to stop.
    """
    settings = get_settings()
    user = users.get_by_email(db, email)

    if user is None:
        # Spend the same work as a real verification so response timing cannot be
        # used to discover which addresses have accounts.
        equalise_timing()
        record(
            db,
            action=AuditAction.LOGIN_FAILED,
            entity_type="user",
            metadata={"email": users.normalise_email(email), "reason": "unknown_email"},
            context=context,
        )
        db.commit()
        raise InvalidCredentialsError("Email or password is incorrect.")

    remaining = _lockout_remaining(user)
    if remaining is not None:
        record(
            db,
            action=AuditAction.LOGIN_FAILED,
            actor_id=user.id,
            entity_type="user",
            entity_id=user.id,
            metadata={"reason": "locked", "retry_after_seconds": remaining},
            context=context,
        )
        db.commit()
        raise AccountLockedError(
            "This account is temporarily locked after repeated failed sign-in attempts.",
            details=[{"retry_after_seconds": remaining}],
        )

    if not verify_password(password, user.password_hash):
        user.failed_login_count += 1
        reason = "bad_password"
        if user.failed_login_count >= settings.login_max_attempts:
            user.locked_until = datetime.now(UTC) + timedelta(
                seconds=settings.login_lockout_seconds
            )
            user.failed_login_count = 0
            reason = "locked_out"
        record(
            db,
            action=AuditAction.LOGIN_FAILED,
            actor_id=user.id,
            entity_type="user",
            entity_id=user.id,
            metadata={"reason": reason},
            context=context,
        )
        # The attempt counter and the lockout it triggers must survive the exception
        # that ends this request, or repeated guessing would never lock anything.
        db.commit()
        # Deliberately the same message and status as an unknown email.
        raise InvalidCredentialsError("Email or password is incorrect.")

    if not user.is_active:
        record(
            db,
            action=AuditAction.LOGIN_FAILED,
            actor_id=user.id,
            entity_type="user",
            entity_id=user.id,
            metadata={"reason": "inactive"},
            context=context,
        )
        db.commit()
        raise InactiveAccountError("This account has been deactivated.")

    # Transparently upgrade a hash whose cost parameters have since increased.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = datetime.now(UTC)

    issued = _issue(db, user, context=context)
    record(
        db,
        action=AuditAction.LOGIN,
        actor_id=user.id,
        entity_type="user",
        entity_id=user.id,
        context=context,
    )
    return issued


def refresh(
    db: Session, *, refresh_token: str, context: RequestContext | None = None
) -> IssuedSession:
    stored: RefreshToken | None = tokens.get_by_hash(db, hash_refresh_token(refresh_token))
    if stored is None:
        raise InvalidCredentialsError("The refresh token is not valid.")

    if stored.revoked_at is not None:
        # This token was already exchanged. Either it was replayed by an attacker or
        # it leaked; either way every descendant is suspect, so the family dies.
        revoked = tokens.revoke_family(db, stored.family_id)
        logger.warning(
            "refresh token reuse detected",
            extra={"family_id": str(stored.family_id), "revoked": revoked},
        )
        record(
            db,
            action=AuditAction.LOGIN_FAILED,
            actor_id=stored.user_id,
            entity_type="refresh_token",
            entity_id=stored.id,
            metadata={
                "reason": "refresh_token_reuse",
                "family_id": str(stored.family_id),
                "tokens_revoked": revoked,
            },
            context=context,
        )
        db.commit()
        raise TokenReuseError(
            "This session has been ended for security reasons. Please sign in again."
        )

    expires_at = stored.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= datetime.now(UTC):
        raise InvalidCredentialsError("The refresh token has expired.")

    user = users.get_by_id(db, stored.user_id)
    if user is None or not user.is_active:
        tokens.revoke_family(db, stored.family_id)
        db.commit()
        raise InactiveAccountError("This account has been deactivated.")

    issued = _issue(db, user, family_id=stored.family_id, context=context)
    replacement = tokens.get_by_hash(db, hash_refresh_token(issued.refresh_token))
    tokens.revoke(db, stored, replaced_by_id=replacement.id if replacement else None)
    return issued


def logout(
    db: Session, *, refresh_token: str | None, actor_id: uuid.UUID | None = None,
    context: RequestContext | None = None,
) -> None:
    """Revoke the presented session's whole family. Always succeeds — a client that
    cannot log out is a worse outcome than a redundant revocation."""
    if refresh_token:
        stored = tokens.get_by_hash(db, hash_refresh_token(refresh_token))
        if stored is not None:
            tokens.revoke_family(db, stored.family_id)
            actor_id = actor_id or stored.user_id
    record(
        db,
        action=AuditAction.LOGOUT,
        actor_id=actor_id,
        entity_type="user",
        entity_id=actor_id,
        context=context,
    )


def change_password(
    db: Session,
    *,
    user: User,
    current_password: str,
    new_password: str,
    context: RequestContext | None = None,
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise InvalidCredentialsError("The current password is incorrect.")

    problems = validate_password_policy(new_password)
    if problems:
        raise LisaError(
            "The new password does not meet the password policy.",
            details=problems,
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=422,
        )
    if verify_password(new_password, user.password_hash):
        raise LisaError(
            "The new password must differ from the current one.",
            details=[{"field": "new_password", "issue": "Must not repeat the current password."}],
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=422,
        )

    user.password_hash = hash_password(new_password)
    user.password_changed_at = datetime.now(UTC)
    # Every other device holding a refresh token loses it: a password change is how
    # a user responds to a suspected compromise, so it must end other sessions.
    tokens.revoke_all_for_user(db, user.id)
    record(
        db,
        action=AuditAction.USER_UPDATED,
        actor_id=user.id,
        entity_type="user",
        entity_id=user.id,
        metadata={"change": "password"},
        context=context,
    )
