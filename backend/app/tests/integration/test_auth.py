"""Authentication end to end: login, lockout, rotation, reuse detection, logout."""

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models import AuditLog, RefreshToken, User
from app.models.enums import AuditAction, RoleName
from app.tests.conftest import TEST_PASSWORD, requires_db

pytestmark = [pytest.mark.integration, requires_db]

REFRESH_COOKIE = get_settings().refresh_cookie_name


class TestLogin:
    def test_valid_credentials_return_a_token_and_the_user(self, client, make_user) -> None:
        make_user(email="analyst@lisa.local")
        r = client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["token_type"] == "bearer"
        assert body["expires_in"] == get_settings().access_token_ttl_seconds
        assert body["user"]["email"] == "analyst@lisa.local"
        assert "processing:execute" in body["user"]["permissions"]

    def test_email_is_case_insensitive(self, client, make_user) -> None:
        make_user(email="analyst@lisa.local")
        r = client.post(
            "/api/auth/login",
            json={"email": "Analyst@LISA.Local", "password": TEST_PASSWORD},
        )
        assert r.status_code == 200

    def test_refresh_token_is_an_httponly_cookie_and_never_in_the_body(
        self, client, make_user
    ) -> None:
        make_user()
        r = client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
        )
        cookie_header = r.headers["set-cookie"]
        assert "HttpOnly" in cookie_header
        assert "SameSite=strict" in cookie_header.replace("samesite", "SameSite")
        # Script in the page must never be able to read the long-lived credential.
        assert "refresh_token" not in r.json()

    def test_unknown_email_and_wrong_password_are_indistinguishable(
        self, client, make_user
    ) -> None:
        make_user(email="analyst@lisa.local")
        unknown = client.post(
            "/api/auth/login", json={"email": "nobody@lisa.local", "password": TEST_PASSWORD}
        )
        wrong = client.post(
            "/api/auth/login", json={"email": "analyst@lisa.local", "password": "Wr0ngPassword!"}
        )
        # Any difference here is an account-enumeration oracle.
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json()["error_code"] == wrong.json()["error_code"] == "INVALID_CREDENTIALS"
        assert unknown.json()["message"] == wrong.json()["message"]

    def test_deactivated_account_cannot_sign_in(self, client, make_user) -> None:
        make_user(email="gone@lisa.local", is_active=False)
        r = client.post(
            "/api/auth/login", json={"email": "gone@lisa.local", "password": TEST_PASSWORD}
        )
        assert r.status_code == 403
        assert r.json()["error_code"] == "PERMISSION_DENIED"

    def test_last_login_is_recorded(self, client, make_user, db) -> None:
        user = make_user()
        assert user.last_login_at is None
        client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
        )
        db.refresh(user)
        assert user.last_login_at is not None


class TestLockout:
    def test_account_locks_after_the_configured_number_of_failures(
        self, client, make_user, db
    ) -> None:
        user = make_user()
        attempts = get_settings().login_max_attempts

        for _ in range(attempts):
            r = client.post(
                "/api/auth/login",
                json={"email": user.email, "password": "Wr0ngPassword!"},
            )
            assert r.status_code == 401

        # The correct password must now be refused too, or lockout means nothing.
        locked = client.post(
            "/api/auth/login", json={"email": user.email, "password": TEST_PASSWORD}
        )
        assert locked.status_code == 423
        assert locked.json()["error_code"] == "ACCOUNT_LOCKED"
        assert locked.json()["details"][0]["retry_after_seconds"] > 0

    def test_failed_attempts_survive_the_failed_request(self, client, make_user, db) -> None:
        """The counter is written on a request that ends in an exception. If it were
        rolled back with the request, guessing would be unlimited."""
        user = make_user()
        client.post("/api/auth/login", json={"email": user.email, "password": "Wr0ng1!"})
        db.expire(user)
        assert user.failed_login_count == 1

    def test_a_successful_login_clears_the_counter(self, client, make_user, db) -> None:
        user = make_user()
        client.post("/api/auth/login", json={"email": user.email, "password": "Wr0ng1!"})
        client.post("/api/auth/login", json={"email": user.email, "password": TEST_PASSWORD})
        db.expire(user)
        assert user.failed_login_count == 0
        assert user.locked_until is None


class TestRefreshRotation:
    def _login(self, client, make_user):
        make_user()
        r = client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
        )
        assert r.status_code == 200
        return r

    def test_refresh_issues_a_new_access_token(self, client, make_user) -> None:
        self._login(client, make_user)
        r = client.post("/api/auth/refresh")
        assert r.status_code == 200
        assert r.json()["access_token"]

    def test_the_refresh_token_is_rotated_on_every_use(self, client, make_user, db) -> None:
        self._login(client, make_user)
        first = client.cookies.get(REFRESH_COOKIE)
        client.post("/api/auth/refresh")
        second = client.cookies.get(REFRESH_COOKIE)
        assert first != second
        assert db.scalar(select(func.count()).select_from(RefreshToken)) == 2

    def test_reusing_a_rotated_token_revokes_the_whole_family(
        self, client, make_user, db
    ) -> None:
        """The reuse test. A replayed token means the credential leaked, so every
        descendant is suspect and the session chain must die."""
        self._login(client, make_user)
        stolen = client.cookies.get(REFRESH_COOKIE)

        client.post("/api/auth/refresh")          # legitimate rotation
        assert client.post("/api/auth/refresh").status_code == 200

        client.cookies.set(REFRESH_COOKIE, stolen)   # attacker replays the old token
        replayed = client.post("/api/auth/refresh")
        assert replayed.status_code == 401
        assert replayed.json()["error_code"] == "TOKEN_REUSED"

        live = db.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(RefreshToken.revoked_at.is_(None))
        )
        assert live == 0, "every token in the family must be revoked"

    def test_the_legitimate_holder_is_also_locked_out_after_reuse(
        self, client, make_user
    ) -> None:
        self._login(client, make_user)
        stolen = client.cookies.get(REFRESH_COOKIE)
        client.post("/api/auth/refresh")
        current = client.cookies.get(REFRESH_COOKIE)

        client.cookies.set(REFRESH_COOKIE, stolen)
        client.post("/api/auth/refresh")

        # Nobody keeps the session — the honest user re-authenticates, the thief
        # gets nothing. Preferring convenience here would defeat the whole control.
        client.cookies.set(REFRESH_COOKIE, current)
        assert client.post("/api/auth/refresh").status_code == 401

    def test_refresh_without_a_cookie_is_rejected(self, client) -> None:
        r = client.post("/api/auth/refresh")
        assert r.status_code == 401

    def test_a_forged_refresh_token_is_rejected(self, client, make_user) -> None:
        self._login(client, make_user)
        client.cookies.set(REFRESH_COOKIE, "not-a-real-token")
        assert client.post("/api/auth/refresh").status_code == 401

    def test_deactivating_a_user_kills_their_refresh_family(
        self, client, make_user, db
    ) -> None:
        user = make_user()
        client.post(
            "/api/auth/login",
            json={"email": user.email, "password": TEST_PASSWORD},
        )
        user.is_active = False
        db.flush()
        db.commit()
        assert client.post("/api/auth/refresh").status_code == 403


class TestLogout:
    def test_logout_revokes_the_session_and_clears_the_cookie(
        self, client, make_user, db
    ) -> None:
        make_user()
        client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
        )
        r = client.post("/api/auth/logout")
        assert r.status_code == 204
        assert db.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(RefreshToken.revoked_at.is_(None))
        ) == 0
        assert client.post("/api/auth/refresh").status_code == 401

    def test_logout_without_a_session_still_succeeds(self, client) -> None:
        # A client that cannot log out is a worse outcome than a redundant call.
        assert client.post("/api/auth/logout").status_code == 204


class TestCurrentUser:
    def test_me_returns_the_user_with_their_permissions(self, client, login) -> None:
        user, headers = login(RoleName.ANALYST)
        r = client.get("/api/auth/me", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == user.email
        assert body["role"]["name"] == "ANALYST"
        assert "users:write" not in body["permissions"]

    def test_me_without_a_token_is_unauthenticated(self, client) -> None:
        r = client.get("/api/auth/me")
        assert r.status_code == 401
        assert r.json()["error_code"] == "NOT_AUTHENTICATED"

    def test_a_token_for_a_deactivated_user_stops_working_immediately(
        self, client, login, db
    ) -> None:
        """A JWT stays cryptographically valid until it expires, so deactivation
        has to be re-checked per request rather than trusted from the claims."""
        user, headers = login()
        assert client.get("/api/auth/me", headers=headers).status_code == 200

        user.is_active = False
        db.flush()
        db.commit()
        assert client.get("/api/auth/me", headers=headers).status_code == 403

    def test_profile_name_can_be_updated(self, client, login) -> None:
        _, headers = login()
        r = client.patch("/api/auth/me", json={"full_name": "Dr Jane Roe"}, headers=headers)
        assert r.status_code == 200
        assert r.json()["full_name"] == "Dr Jane Roe"


class TestChangePassword:
    def test_password_can_be_changed_and_the_new_one_works(self, client, login) -> None:
        user, headers = login()
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "An0therStrongPass"},
            headers=headers,
        )
        assert r.status_code == 204
        assert client.post(
            "/api/auth/login", json={"email": user.email, "password": "An0therStrongPass"}
        ).status_code == 200

    def test_the_old_password_stops_working(self, client, login) -> None:
        user, headers = login()
        client.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "An0therStrongPass"},
            headers=headers,
        )
        assert client.post(
            "/api/auth/login", json={"email": user.email, "password": TEST_PASSWORD}
        ).status_code == 401

    def test_a_wrong_current_password_is_refused(self, client, login) -> None:
        _, headers = login()
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": "Wr0ngPassword!", "new_password": "An0therStrongPass"},
            headers=headers,
        )
        assert r.status_code == 401

    def test_the_new_password_must_meet_the_policy(self, client, login) -> None:
        _, headers = login()
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "short"},
            headers=headers,
        )
        assert r.status_code == 422
        assert r.json()["details"]

    def test_the_new_password_must_differ_from_the_old_one(self, client, login) -> None:
        _, headers = login()
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": TEST_PASSWORD},
            headers=headers,
        )
        assert r.status_code == 422

    def test_changing_a_password_ends_every_other_session(self, client, login, db) -> None:
        """A password change is how a user responds to a suspected compromise, so
        it has to evict whoever else is holding a token."""
        _, headers = login()
        client.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "An0therStrongPass"},
            headers=headers,
        )
        assert db.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(RefreshToken.revoked_at.is_(None))
        ) == 0


class TestAuditTrail:
    def _actions(self, db) -> list[str]:
        return list(db.scalars(select(AuditLog.action).order_by(AuditLog.at)))

    def test_successful_login_is_audited(self, client, make_user, db) -> None:
        make_user()
        client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
        )
        assert AuditAction.LOGIN.value in self._actions(db)

    def test_failed_login_is_audited_with_a_reason(self, client, make_user, db) -> None:
        make_user()
        client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": "Wr0ngPassword!"},
        )
        entry = db.scalar(
            select(AuditLog).where(AuditLog.action == AuditAction.LOGIN_FAILED.value)
        )
        assert entry is not None
        assert entry.audit_metadata["reason"] == "bad_password"

    def test_an_unknown_email_is_audited_without_inventing_an_actor(
        self, client, seeded, db
    ) -> None:
        client.post(
            "/api/auth/login", json={"email": "nobody@lisa.local", "password": TEST_PASSWORD}
        )
        entry = db.scalar(
            select(AuditLog).where(AuditLog.action == AuditAction.LOGIN_FAILED.value)
        )
        assert entry is not None and entry.actor_id is None
        assert entry.audit_metadata["reason"] == "unknown_email"

    def test_refresh_token_reuse_is_audited(self, client, make_user, db) -> None:
        make_user()
        client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
        )
        stolen = client.cookies.get(REFRESH_COOKIE)
        client.post("/api/auth/refresh")
        client.cookies.set(REFRESH_COOKIE, stolen)
        client.post("/api/auth/refresh")

        reuse = [
            e
            for e in db.scalars(select(AuditLog))
            if (e.audit_metadata or {}).get("reason") == "refresh_token_reuse"
        ]
        assert len(reuse) == 1
        assert reuse[0].audit_metadata["tokens_revoked"] >= 1

    def test_logout_is_audited(self, client, make_user, db) -> None:
        make_user()
        client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
        )
        client.post("/api/auth/logout")
        assert AuditAction.LOGOUT.value in self._actions(db)

    def test_audit_rows_carry_the_user_agent_and_survive_a_non_ip_peer(
        self, client, make_user, db
    ) -> None:
        """TestClient's peer is the literal string "testclient". A non-address must
        be dropped rather than crash the insert into the INET column."""
        make_user()
        client.post(
            "/api/auth/login",
            json={"email": "analyst@lisa.local", "password": TEST_PASSWORD},
            headers={"User-Agent": "pytest-agent/1.0"},
        )
        entry = db.scalar(select(AuditLog).where(AuditLog.action == AuditAction.LOGIN.value))
        assert entry is not None
        assert entry.user_agent == "pytest-agent/1.0"
        assert entry.ip is None


class TestRateLimit:
    def test_repeated_attempts_from_one_address_are_throttled(
        self, client, seeded, monkeypatch
    ) -> None:
        settings = get_settings()
        monkeypatch.setattr(settings, "login_rate_limit_attempts", 3)

        statuses = [
            client.post(
                "/api/auth/login", json={"email": "nobody@lisa.local", "password": "Wr0ngPass1!"}
            ).status_code
            for _ in range(5)
        ]
        assert statuses[-1] == 429
        assert 429 not in statuses[:3]


def test_no_user_is_created_by_the_seed(db, seeded) -> None:
    """There is no self-service registration: the first admin is an operator action."""
    assert db.scalar(select(func.count()).select_from(User)) == 0
