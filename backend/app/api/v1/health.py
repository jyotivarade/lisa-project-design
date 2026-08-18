"""Liveness and readiness. Unauthenticated by design — a probe has no credentials."""

from typing import Any

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import engine

router = APIRouter(tags=["health"])


@router.get("/health/live", summary="Liveness probe")
def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", summary="Readiness probe")
def ready(response: Response) -> dict[str, Any]:
    """Reports each dependency separately so a failing probe names the culprit."""
    settings = get_settings()
    checks: dict[str, Any] = {"database": "ok"}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - exercised by outage, not tests
        checks["database"] = f"unavailable: {type(exc).__name__}"

    ok = all(v == "ok" for v in checks.values())
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ready" if ok else "degraded",
        "environment": settings.environment,
        "checks": checks,
    }
