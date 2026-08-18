"""Shared FastAPI dependencies: database session, current user, permission checks.

`require_permission` is the single enforcement point for RBAC. Every mutating route
declares one; a route with no permission dependency is a review failure.
"""

import ipaddress
import time
from collections import defaultdict, deque
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.audit import RequestContext
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AuthenticationError, LisaError, PermissionDeniedError
from app.core.security import decode_access_token
from app.models import User
from app.repositories import user_repository as users

# auto_error=False so a missing header produces the LISA error envelope rather than
# FastAPI's own {"detail": ...} shape.
_bearer = HTTPBearer(auto_error=False)


def client_ip(request: Request) -> str | None:
    """The peer address, if it is actually an IP address.

    `audit_logs.ip` is an INET column, so a non-address value here would raise on
    insert and take down the request it was only meant to annotate. A unix socket
    peer, a test client, or a misconfigured proxy can all produce a non-address.
    Behind a reverse proxy, run uvicorn with --proxy-headers so this is the real
    client rather than the proxy.
    """
    host = request.client.host if request.client else None
    if not host:
        return None
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return None
    return host


def get_request_context(request: Request) -> RequestContext:
    return RequestContext(
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


DbSession = Annotated[Session, Depends(get_db)]
BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


def get_current_user(credentials: BearerCredentials, db: DbSession) -> User:
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("Authentication is required.")

    claims = decode_access_token(credentials.credentials)
    user = users.get_by_id(db, claims.user_id)
    if user is None:
        raise AuthenticationError("Authentication is required.")
    if not user.is_active:
        # A token stays cryptographically valid until it expires, so deactivation
        # must be re-checked on every request rather than trusted from the claims.
        raise PermissionDeniedError("This account has been deactivated.")
    return user


def user_permissions(user: User) -> set[str]:
    return {p.code for p in user.role.permissions}


CurrentUser = Annotated[User, Depends(get_current_user)]
RequestCtx = Annotated[RequestContext, Depends(get_request_context)]


def require_permission(*codes: str) -> Callable[..., User]:
    """Dependency factory. All listed permissions must be held."""

    def dependency(user: CurrentUser) -> User:
        held = user_permissions(user)
        missing = [c for c in codes if c not in held]
        if missing:
            raise PermissionDeniedError(
                "You do not have permission to perform this action.",
                details=[{"required": c} for c in missing],
            )
        return user

    return dependency


class RateLimitError(LisaError):
    status_code = 429
    error_code = "RATE_LIMITED"


class _SlidingWindow:
    """Per-IP throttle for the login route.

    In-process and therefore per-replica: it raises the cost of online guessing but
    is not the primary defence — per-account lockout is, and that lives in the
    database where every replica sees it. Redis-backed in Phase 12.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, *, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            raise RateLimitError(
                "Too many sign-in attempts. Please wait and try again.",
                details=[{"retry_after_seconds": int(window_seconds - (now - hits[0]))}],
            )
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


login_rate_limiter = _SlidingWindow()


def enforce_login_rate_limit(request: Request) -> None:
    settings = get_settings()
    key = request.client.host if request.client else "unknown"
    login_rate_limiter.check(
        key,
        limit=settings.login_rate_limit_attempts,
        window_seconds=settings.login_rate_limit_window_seconds,
    )


__all__ = [
    "BearerCredentials",
    "client_ip",
    "CurrentUser",
    "DbSession",
    "RequestCtx",
    "enforce_login_rate_limit",
    "get_current_user",
    "get_db",
    "get_request_context",
    "login_rate_limiter",
    "require_permission",
    "user_permissions",
]
