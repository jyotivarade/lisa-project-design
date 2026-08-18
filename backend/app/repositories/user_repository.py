"""User and role queries. No business logic — that lives in the services."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Role, User


def normalise_email(email: str) -> str:
    """Email is the login identity, so casing must never create a second account."""
    return email.strip().lower()


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(
        select(User)
        .options(selectinload(User.role).selectinload(Role.permissions))
        .where(User.email == normalise_email(email))
    )


def get_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    return db.scalar(
        select(User)
        .options(selectinload(User.role).selectinload(Role.permissions))
        .where(User.id == user_id)
    )


def list_users(db: Session, *, limit: int, offset: int) -> tuple[Sequence[User], int]:
    total = db.scalar(select(func.count()).select_from(User)) or 0
    rows = db.scalars(
        select(User)
        .options(selectinload(User.role).selectinload(Role.permissions))
        .order_by(User.email)
        .limit(limit)
        .offset(offset)
    ).all()
    return rows, total


def get_role_by_name(db: Session, name: str) -> Role | None:
    return db.scalar(
        select(Role).options(selectinload(Role.permissions)).where(Role.name == name)
    )


def list_roles(db: Session) -> Sequence[Role]:
    return db.scalars(
        select(Role).options(selectinload(Role.permissions)).order_by(Role.name)
    ).all()


def count_active_admins(db: Session, *, excluding: uuid.UUID | None = None) -> int:
    stmt = (
        select(func.count())
        .select_from(User)
        .join(Role, Role.id == User.role_id)
        .where(Role.name == "ADMIN", User.is_active.is_(True))
    )
    if excluding is not None:
        stmt = stmt.where(User.id != excluding)
    return db.scalar(stmt) or 0
