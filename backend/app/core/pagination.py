"""Uniform pagination envelope (docs/03 §Conventions)."""

from pydantic import BaseModel, Field

MAX_PAGE_SIZE = 200


class PageParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=MAX_PAGE_SIZE)
    sort: str | None = None
    q: str | None = None

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class Page[T](BaseModel):
    items: list[T]
    page: int
    page_size: int
    total: int
    total_pages: int

    @classmethod
    def build(cls, items: list[T], total: int, params: PageParams) -> "Page[T]":
        pages = (total + params.page_size - 1) // params.page_size if total else 0
        return cls(
            items=items,
            page=params.page,
            page_size=params.page_size,
            total=total,
            total_pages=pages,
        )
