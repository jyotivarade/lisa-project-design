"""Refresh-token persistence. Tokens are stored hashed, never in plaintext."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import RefreshToken


def create(
    db: Session,
    *,
    user_id: uuid.UUID,
    token_hash: str,
    family_id: uuid.UUID,
    expires_at: datetime,
    user_agent: str | None,
    ip: str | None,
) -> RefreshToken:
    token = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        family_id=family_id,
        expires_at=expires_at,
        user_agent=user_agent,
        ip=ip,
    )
    db.add(token)
    db.flush()
    return token


def get_by_hash(db: Session, token_hash: str) -> RefreshToken | None:
    return db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))


def revoke(db: Session, token: RefreshToken, *, replaced_by_id: uuid.UUID | None = None) -> None:
    token.revoked_at = datetime.now(UTC)
    token.replaced_by_id = replaced_by_id


def revoke_family(db: Session, family_id: uuid.UUID) -> int:
    """Revoke every token in a family.

    Called when a rotated token is presented a second time: either the token was
    stolen or it leaked, and in both cases every descendant is suspect.
    """
    result = db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    return result.rowcount or 0


def revoke_all_for_user(db: Session, user_id: uuid.UUID) -> int:
    result = db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    return result.rowcount or 0
