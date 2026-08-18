"""The pagination envelope (docs/03 Conventions)."""

import pytest
from pydantic import ValidationError

from app.core.pagination import MAX_PAGE_SIZE, Page, PageParams


def test_offset_is_zero_based() -> None:
    assert PageParams(page=1, page_size=50).offset == 0
    assert PageParams(page=3, page_size=50).offset == 100


def test_page_size_is_bounded() -> None:
    # An unbounded page_size is a denial-of-service on a table with a million rows.
    with pytest.raises(ValidationError):
        PageParams(page_size=MAX_PAGE_SIZE + 1)
    with pytest.raises(ValidationError):
        PageParams(page_size=0)
    with pytest.raises(ValidationError):
        PageParams(page=0)


@pytest.mark.parametrize(
    ("total", "page_size", "expected_pages"),
    [(0, 50, 0), (1, 50, 1), (50, 50, 1), (51, 50, 2), (137, 50, 3)],
)
def test_total_pages_rounds_up(total: int, page_size: int, expected_pages: int) -> None:
    page = Page.build([], total, PageParams(page=1, page_size=page_size))
    assert page.total_pages == expected_pages


def test_build_preserves_items_and_params() -> None:
    page = Page[str].build(["a", "b"], 2, PageParams(page=1, page_size=50))
    assert page.items == ["a", "b"]
    assert (page.page, page.page_size, page.total) == (1, 50, 2)
