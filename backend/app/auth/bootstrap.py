"""First-administrator bootstrap.

Creating the first admin is an operator action run against the database, never an
open registration endpoint: a laboratory system with self-service signup has no
meaningful access control at all.
"""

from sqlalchemy.orm import Session

from app.core.security import hash_password, validate_password_policy
from app.models import User
from app.models.enums import RoleName
from app.repositories import user_repository as users


class BootstrapError(RuntimeError):
    pass


def create_admin(db: Session, *, email: str, full_name: str, password: str) -> User:
    problems = validate_password_policy(password)
    if problems:
        raise BootstrapError("; ".join(p["issue"] for p in problems))

    normalised = users.normalise_email(email)
    if users.get_by_email(db, normalised) is not None:
        raise BootstrapError(f"A user with email {normalised} already exists.")

    role = users.get_role_by_name(db, RoleName.ADMIN.value)
    if role is None:
        raise BootstrapError("Roles are not seeded. Run `python -m app.cli seed` first.")

    user = User(
        email=normalised,
        full_name=full_name,
        password_hash=hash_password(password),
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user
