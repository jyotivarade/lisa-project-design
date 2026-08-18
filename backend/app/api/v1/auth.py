"""Authentication endpoints (spec section 24).

The refresh token is delivered as an HttpOnly cookie and the access token in the
body: script running in the page can use the access token it was handed, but can
never read the long-lived credential, so an XSS cannot walk away with a week of
access.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import (
    CurrentUser,
    DbSession,
    RequestCtx,
    enforce_login_rate_limit,
    user_permissions,
)
from app.core.config import get_settings
from app.schemas.auth import (
    LoginRequest,
    PasswordChange,
    ProfileUpdate,
    TokenResponse,
    UserRead,
)
from app.services import auth_service, user_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _to_user_read(user) -> UserRead:  # type: ignore[no-untyped-def]
    return UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        last_login_at=user.last_login_at,
        role=user.role,
        permissions=sorted(user_permissions(user)),
    )


def _set_refresh_cookie(response: Response, issued: auth_service.IssuedSession) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=issued.refresh_token,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite="strict",
        max_age=settings.refresh_token_ttl_seconds,
        path=f"{settings.api_prefix}/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.refresh_cookie_name, path=f"{settings.api_prefix}/auth"
    )


@router.post("/login", response_model=TokenResponse, summary="Sign in")
def login(
    payload: LoginRequest,
    response: Response,
    db: DbSession,
    context: RequestCtx,
    _: Annotated[None, Depends(enforce_login_rate_limit)] = None,
) -> TokenResponse:
    # Failure paths commit their own bookkeeping inside the service before raising
    # (see auth_service.login); this commit is the success path.
    issued = auth_service.login(
        db, email=payload.email, password=payload.password, context=context
    )
    db.commit()
    _set_refresh_cookie(response, issued)
    return TokenResponse(
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        user=_to_user_read(issued.user),
    )


@router.post("/refresh", response_model=TokenResponse, summary="Rotate the session")
def refresh(
    request: Request, response: Response, db: DbSession, context: RequestCtx
) -> TokenResponse:
    settings = get_settings()
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token:
        raise auth_service.InvalidCredentialsError("No refresh token was supplied.")

    issued = auth_service.refresh(db, refresh_token=token, context=context)
    db.commit()
    _set_refresh_cookie(response, issued)
    return TokenResponse(
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        user=_to_user_read(issued.user),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Sign out")
def logout(request: Request, response: Response, db: DbSession, context: RequestCtx) -> None:
    settings = get_settings()
    token = request.cookies.get(settings.refresh_cookie_name)
    auth_service.logout(db, refresh_token=token, context=context)
    db.commit()
    _clear_refresh_cookie(response)


@router.get("/me", response_model=UserRead, summary="The signed-in user")
def me(user: CurrentUser) -> UserRead:
    return _to_user_read(user)


@router.patch("/me", response_model=UserRead, summary="Update your profile")
def update_me(
    payload: ProfileUpdate, user: CurrentUser, db: DbSession, context: RequestCtx
) -> UserRead:
    updated = user_service.update_profile(
        db, user=user, full_name=payload.full_name, context=context
    )
    db.commit()
    return _to_user_read(updated)


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change your password",
)
def change_password(
    payload: PasswordChange,
    user: CurrentUser,
    db: DbSession,
    context: RequestCtx,
    response: Response,
) -> None:
    auth_service.change_password(
        db,
        user=user,
        current_password=payload.current_password,
        new_password=payload.new_password,
        context=context,
    )
    db.commit()
    # Every session is revoked, including this one: the client must sign in again.
    _clear_refresh_cookie(response)
