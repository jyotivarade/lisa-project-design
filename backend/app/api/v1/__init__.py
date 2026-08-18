"""API v1 routers. Each phase mounts its own router here."""

from fastapi import APIRouter

from app.api.v1 import admin, analytics, auth, files, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(admin.router)
api_router.include_router(analytics.router)
api_router.include_router(files.router)

__all__ = ["api_router"]
