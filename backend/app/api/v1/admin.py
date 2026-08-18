"""User and role administration (spec section 37). ADMIN only."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, RequestCtx, require_permission, user_permissions
from app.auth.permissions import Perm
from app.core.errors import NotFoundError
from app.core.pagination import Page, PageParams
from app.models import User
from app.repositories import user_repository as users
from app.schemas.auth import UserRead
from app.schemas.user import RoleDetail, UserCreate, UserUpdate
from app.services import user_service

router = APIRouter(prefix="/admin", tags=["administration"])

AdminRead = Annotated[User, Depends(require_permission(Perm.USERS_READ))]
AdminWrite = Annotated[User, Depends(require_permission(Perm.USERS_WRITE))]
RoleWrite = Annotated[User, Depends(require_permission(Perm.ROLES_WRITE))]


def _to_user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        last_login_at=user.last_login_at,
        role=user.role,
        permissions=sorted(user_permissions(user)),
    )


@router.get("/users", response_model=Page[UserRead], summary="List users")
def list_users(
    _: AdminRead,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Page[UserRead]:
    params = PageParams(page=page, page_size=page_size)
    rows, total = users.list_users(db, limit=params.page_size, offset=params.offset)
    return Page[UserRead].build([_to_user_read(u) for u in rows], total, params)


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user",
)
def create_user(
    payload: UserCreate, actor: AdminWrite, db: DbSession, context: RequestCtx
) -> UserRead:
    user = user_service.create_user(
        db,
        email=payload.email,
        full_name=payload.full_name,
        password=payload.password,
        role_name=payload.role,
        actor_id=actor.id,
        context=context,
    )
    db.commit()
    return _to_user_read(user)


@router.get("/users/{user_id}", response_model=UserRead, summary="Get a user")
def get_user(user_id: uuid.UUID, _: AdminRead, db: DbSession) -> UserRead:
    user = users.get_by_id(db, user_id)
    if user is None:
        raise NotFoundError("User not found.")
    return _to_user_read(user)


@router.patch("/users/{user_id}", response_model=UserRead, summary="Update a user")
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    actor: AdminWrite,
    db: DbSession,
    context: RequestCtx,
) -> UserRead:
    user = user_service.update_user(
        db,
        user_id=user_id,
        full_name=payload.full_name,
        role_name=payload.role,
        is_active=payload.is_active,
        actor_id=actor.id,
        context=context,
    )
    db.commit()
    return _to_user_read(user)


@router.get("/roles", response_model=list[RoleDetail], summary="List roles")
def list_roles(_: AdminRead, db: DbSession) -> list[RoleDetail]:
    return [
        RoleDetail(
            id=role.id,
            name=role.name,
            description=role.description,
            permissions=sorted(p.code for p in role.permissions),
        )
        for role in users.list_roles(db)
    ]
