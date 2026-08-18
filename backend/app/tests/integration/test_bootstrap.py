"""First-administrator bootstrap and the CLI around it."""

import pytest
from sqlalchemy import func, select

from app.auth.bootstrap import BootstrapError, create_admin
from app.models import User
from app.models.enums import RoleName
from app.tests.conftest import TEST_PASSWORD, requires_db

pytestmark = [pytest.mark.integration, requires_db]


def test_creates_an_active_admin_with_a_normalised_email(seeded) -> None:
    user = create_admin(
        seeded, email="Admin@LISA.Local", full_name="Lab Admin", password=TEST_PASSWORD
    )
    assert user.email == "admin@lisa.local"
    assert user.role.name == RoleName.ADMIN.value
    assert user.is_active is True
    assert user.password_hash.startswith("$argon2id$")


def test_the_created_admin_can_sign_in(client, seeded) -> None:
    create_admin(seeded, email="admin@lisa.local", full_name="Lab Admin", password=TEST_PASSWORD)
    response = client.post(
        "/api/auth/login", json={"email": "admin@lisa.local", "password": TEST_PASSWORD}
    )
    assert response.status_code == 200
    assert "users:write" in response.json()["user"]["permissions"]


def test_a_weak_password_is_refused(seeded) -> None:
    with pytest.raises(BootstrapError, match="at least"):
        create_admin(seeded, email="admin@lisa.local", full_name="Lab Admin", password="short")
    assert seeded.scalar(select(func.count()).select_from(User)) == 0


def test_a_duplicate_email_is_refused(seeded) -> None:
    create_admin(seeded, email="admin@lisa.local", full_name="Lab Admin", password=TEST_PASSWORD)
    with pytest.raises(BootstrapError, match="already exists"):
        create_admin(
            seeded, email="ADMIN@lisa.local", full_name="Impostor", password=TEST_PASSWORD
        )


def test_it_refuses_to_run_before_the_seed(db) -> None:
    # Without roles there is nothing to grant, and a half-created admin would be
    # worse than a clear failure.
    with pytest.raises(BootstrapError, match="not seeded"):
        create_admin(db, email="admin@lisa.local", full_name="Lab Admin", password=TEST_PASSWORD)


def test_there_is_no_self_service_registration(client, seeded) -> None:
    """A laboratory system with open signup has no access control worth the name."""
    for path in ("/api/auth/register", "/api/auth/signup", "/api/users"):
        assert client.post(path, json={}).status_code == 404
