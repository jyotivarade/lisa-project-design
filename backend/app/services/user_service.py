"""User administration (ADMIN only)."""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import RequestContext, record
from app.core.errors import ErrorCode, LisaError, NotFoundError, ValidationError
from app.core.security import hash_password, validate_password_policy
from app.models import User
from app.models.enums import AuditAction, RoleName
from app.repositories import refresh_token_repository as tokens
from app.repositories import user_repository as users


def _require_policy(password: str) -> None:
    problems = validate_password_policy(password)
    if problems:
        raise ValidationError("The password does not meet the password policy.", details=problems)


def create_user(
    db: Session,
    *,
    email: str,
    full_name: str,
    password: str,
    role_name: RoleName,
    actor_id: uuid.UUID | None,
    context: RequestContext | None = None,
) -> User:
    _require_policy(password)
    role = users.get_role_by_name(db, role_name.value)
    if role is None:
        raise ValidationError(f"Role {role_name.value} does not exist.")

    user = User(
        email=users.normalise_email(email),
        full_name=full_name,
        password_hash=hash_password(password),
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise LisaError(
            "A user with that email already exists.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=409,
            details=[{"field": "email", "issue": "Already registered."}],
        ) from exc

    record(
        db,
        action=AuditAction.USER_CREATED,
        actor_id=actor_id,
        entity_type="user",
        entity_id=user.id,
        new_value={"email": user.email, "full_name": full_name, "role": role.name},
        context=context,
    )
    return users.get_by_id(db, user.id) or user


def update_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    full_name: str | None,
    role_name: RoleName | None,
    is_active: bool | None,
    actor_id: uuid.UUID | None,
    context: RequestContext | None = None,
) -> User:
    user = users.get_by_id(db, user_id)
    if user is None:
        raise NotFoundError("User not found.")

    before = {"full_name": user.full_name, "role": user.role.name, "is_active": user.is_active}

    if role_name is not None and role_name.value != user.role.name:
        role = users.get_role_by_name(db, role_name.value)
        if role is None:
            raise ValidationError(f"Role {role_name.value} does not exist.")
        # Removing the last administrator would leave the system unadministrable,
        # with no supported way back in.
        if user.role.name == RoleName.ADMIN.value and users.count_active_admins(
            db, excluding=user.id
        ) == 0:
            raise ValidationError("The last active administrator cannot be demoted.")
        user.role_id = role.id
        record(
            db,
            action=AuditAction.ROLE_CHANGED,
            actor_id=actor_id,
            entity_type="user",
            entity_id=user.id,
            old_value={"role": before["role"]},
            new_value={"role": role.name},
            context=context,
        )

    if full_name is not None:
        user.full_name = full_name

    if is_active is not None and is_active != user.is_active:
        if not is_active:
            if user.role.name == RoleName.ADMIN.value and users.count_active_admins(
                db, excluding=user.id
            ) == 0:
                raise ValidationError("The last active administrator cannot be deactivated.")
            # A deactivated account must lose its live sessions immediately —
            # otherwise it stays usable until every access token expires.
            tokens.revoke_all_for_user(db, user.id)
        user.is_active = is_active

    db.flush()
    # The `role` relationship was loaded before the change, so it still points at
    # the old row. Expire it or this function reports the role it just replaced.
    db.expire(user, ["role"])
    record(
        db,
        action=AuditAction.USER_UPDATED,
        actor_id=actor_id,
        entity_type="user",
        entity_id=user.id,
        old_value=before,
        new_value={
            "full_name": user.full_name,
            "role": user.role.name,
            "is_active": user.is_active,
        },
        context=context,
    )
    return users.get_by_id(db, user.id) or user


def update_profile(
    db: Session,
    *,
    user: User,
    full_name: str,
    context: RequestContext | None = None,
) -> User:
    before = {"full_name": user.full_name}
    user.full_name = full_name
    db.flush()
    record(
        db,
        action=AuditAction.USER_UPDATED,
        actor_id=user.id,
        entity_type="user",
        entity_id=user.id,
        old_value=before,
        new_value={"full_name": full_name},
        context=context,
    )
    return user
