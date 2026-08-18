"""User administration DTOs (ADMIN only)."""

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import RoleName
from app.schemas.types import Email


class UserCreate(BaseModel):
    email: Email
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=256)
    role: RoleName


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    role: RoleName | None = None
    is_active: bool | None = None


class RoleDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    permissions: list[str] = Field(default_factory=list)
