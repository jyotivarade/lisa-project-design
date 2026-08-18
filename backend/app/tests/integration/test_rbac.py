"""RBAC enforcement.

The permission matrix is asserted at the API, per role, per endpoint. A frontend
that hides a button is a convenience; this is the control.
"""

import pytest

from app.models.enums import RoleName
from app.tests.conftest import TEST_PASSWORD, requires_db

pytestmark = [pytest.mark.integration, requires_db]

ADMIN_ONLY = [
    ("GET", "/api/admin/users"),
    ("GET", "/api/admin/roles"),
]


class TestPermissionMatrix:
    @pytest.mark.parametrize(("method", "path"), ADMIN_ONLY)
    def test_admin_reaches_administration(self, client, login, method: str, path: str) -> None:
        _, headers = login(RoleName.ADMIN, email="admin@lisa.local")
        assert client.request(method, path, headers=headers).status_code == 200

    @pytest.mark.parametrize(("method", "path"), ADMIN_ONLY)
    @pytest.mark.parametrize("role", [RoleName.ANALYST, RoleName.VIEWER])
    def test_non_admins_are_refused_administration(
        self, client, login, method: str, path: str, role: RoleName
    ) -> None:
        _, headers = login(role, email=f"{role.value.lower()}@lisa.local")
        response = client.request(method, path, headers=headers)
        assert response.status_code == 403
        assert response.json()["error_code"] == "PERMISSION_DENIED"

    @pytest.mark.parametrize(("method", "path"), ADMIN_ONLY)
    def test_administration_requires_authentication_at_all(
        self, client, seeded, method: str, path: str
    ) -> None:
        response = client.request(method, path)
        assert response.status_code == 401

    def test_a_viewer_cannot_create_users(self, client, login) -> None:
        _, headers = login(RoleName.VIEWER, email="viewer@lisa.local")
        response = client.post(
            "/api/admin/users",
            json={
                "email": "new@lisa.local",
                "full_name": "New User",
                "password": TEST_PASSWORD,
                "role": "ANALYST",
            },
            headers=headers,
        )
        assert response.status_code == 403

    def test_an_analyst_cannot_create_users(self, client, login) -> None:
        _, headers = login(RoleName.ANALYST)
        response = client.post(
            "/api/admin/users",
            json={
                "email": "new@lisa.local",
                "full_name": "New User",
                "password": TEST_PASSWORD,
                "role": "ADMIN",
            },
            headers=headers,
        )
        # Otherwise any analyst could mint themselves an administrator.
        assert response.status_code == 403

    def test_every_role_can_read_its_own_profile(self, client, login) -> None:
        for role in RoleName:
            _, headers = login(role, email=f"{role.value.lower()}-me@lisa.local")
            assert client.get("/api/auth/me", headers=headers).status_code == 200

    def test_permissions_are_reported_from_the_database_not_hard_coded(
        self, client, login, db
    ) -> None:
        """The frontend renders what this list says, so it must come from the role's
        actual grants rather than a copy of the matrix kept in code."""
        from app.repositories import user_repository as users

        _, headers = login(RoleName.ANALYST)
        reported = set(client.get("/api/auth/me", headers=headers).json()["permissions"])
        role = users.get_role_by_name(db, RoleName.ANALYST.value)
        assert reported == {p.code for p in role.permissions}


class TestUserAdministration:
    def _admin(self, login):
        return login(RoleName.ADMIN, email="admin@lisa.local")

    def test_admin_can_create_a_user_who_can_then_sign_in(self, client, login) -> None:
        _, headers = self._admin(login)
        created = client.post(
            "/api/admin/users",
            json={
                "email": "New.Analyst@LISA.Local",
                "full_name": "New Analyst",
                "password": "An0therStrongPass",
                "role": "ANALYST",
            },
            headers=headers,
        )
        assert created.status_code == 201
        assert created.json()["email"] == "new.analyst@lisa.local"

        assert client.post(
            "/api/auth/login",
            json={"email": "new.analyst@lisa.local", "password": "An0therStrongPass"},
        ).status_code == 200

    def test_a_weak_password_is_refused_at_creation(self, client, login) -> None:
        _, headers = self._admin(login)
        response = client.post(
            "/api/admin/users",
            json={
                "email": "weak@lisa.local",
                "full_name": "Weak",
                "password": "short",
                "role": "VIEWER",
            },
            headers=headers,
        )
        assert response.status_code == 422
        assert response.json()["details"]

    def test_duplicate_email_is_refused(self, client, login, make_user) -> None:
        _, headers = self._admin(login)
        make_user(email="taken@lisa.local")
        response = client.post(
            "/api/admin/users",
            json={
                "email": "taken@lisa.local",
                "full_name": "Duplicate",
                "password": "An0therStrongPass",
                "role": "VIEWER",
            },
            headers=headers,
        )
        assert response.status_code == 409

    def test_role_change_takes_effect_on_the_next_request(
        self, client, login, make_user
    ) -> None:
        _, admin_headers = self._admin(login)
        target = make_user(email="promote@lisa.local", role=RoleName.VIEWER)

        response = client.patch(
            f"/api/admin/users/{target.id}", json={"role": "ANALYST"}, headers=admin_headers
        )
        assert response.status_code == 200
        # The response must report the new role, not the one it just replaced.
        assert response.json()["role"]["name"] == "ANALYST"
        assert "processing:execute" in response.json()["permissions"]

        promoted = client.post(
            "/api/auth/login",
            json={"email": "promote@lisa.local", "password": TEST_PASSWORD},
        ).json()
        assert "processing:execute" in promoted["user"]["permissions"]

    def test_deactivating_a_user_revokes_their_live_sessions(
        self, client, login, make_user
    ) -> None:
        _, admin_headers = self._admin(login)
        victim = make_user(email="victim@lisa.local")
        victim_token = client.post(
            "/api/auth/login",
            json={"email": "victim@lisa.local", "password": TEST_PASSWORD},
        ).json()["access_token"]
        victim_headers = {"Authorization": f"Bearer {victim_token}"}
        assert client.get("/api/auth/me", headers=victim_headers).status_code == 200

        client.patch(
            f"/api/admin/users/{victim.id}", json={"is_active": False}, headers=admin_headers
        )
        # Access must stop now, not whenever the access token happens to expire.
        assert client.get("/api/auth/me", headers=victim_headers).status_code == 403

    def test_the_last_administrator_cannot_be_demoted(self, client, login) -> None:
        admin, headers = self._admin(login)
        response = client.patch(
            f"/api/admin/users/{admin.id}", json={"role": "VIEWER"}, headers=headers
        )
        # Otherwise the system becomes unadministrable with no supported way back.
        assert response.status_code == 422
        assert "last active administrator" in response.json()["message"]

    def test_the_last_administrator_cannot_be_deactivated(self, client, login) -> None:
        admin, headers = self._admin(login)
        response = client.patch(
            f"/api/admin/users/{admin.id}", json={"is_active": False}, headers=headers
        )
        assert response.status_code == 422

    def test_a_second_admin_makes_demotion_possible(self, client, login, make_user) -> None:
        admin, headers = self._admin(login)
        make_user(email="admin2@lisa.local", role=RoleName.ADMIN)
        response = client.patch(
            f"/api/admin/users/{admin.id}", json={"role": "VIEWER"}, headers=headers
        )
        assert response.status_code == 200

    def test_unknown_user_returns_not_found(self, client, login) -> None:
        _, headers = self._admin(login)
        response = client.get(
            "/api/admin/users/00000000-0000-0000-0000-000000000000", headers=headers
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"

    def test_role_and_user_changes_are_audited(self, client, login, make_user, db) -> None:
        from sqlalchemy import select

        from app.models import AuditLog
        from app.models.enums import AuditAction

        _, headers = self._admin(login)
        target = make_user(email="audited@lisa.local", role=RoleName.VIEWER)
        client.patch(
            f"/api/admin/users/{target.id}", json={"role": "ANALYST"}, headers=headers
        )
        actions = set(db.scalars(select(AuditLog.action)))
        assert AuditAction.ROLE_CHANGED.value in actions
        assert AuditAction.USER_UPDATED.value in actions


class TestRoleCatalogue:
    def test_roles_list_their_permissions(self, client, login) -> None:
        _, headers = login(RoleName.ADMIN, email="admin@lisa.local")
        roles = {r["name"]: r for r in client.get("/api/admin/roles", headers=headers).json()}
        assert set(roles) == {"ADMIN", "ANALYST", "VIEWER"}
        assert "users:write" in roles["ADMIN"]["permissions"]
        assert "users:write" not in roles["ANALYST"]["permissions"]
        assert all(
            p.endswith(":read") or p == "files:download" for p in roles["VIEWER"]["permissions"]
        )
