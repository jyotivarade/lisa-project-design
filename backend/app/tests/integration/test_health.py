"""Application wiring: health probes and the error contract."""

import pytest

from app.tests.conftest import requires_db


def test_liveness_needs_no_database(client) -> None:
    r = client.get("/api/health/live")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.integration
@requires_db
def test_readiness_reports_each_dependency(client) -> None:
    r = client.get("/api/health/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] == "ok"


def test_unknown_route_returns_the_error_envelope(client) -> None:
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert set(body) >= {"error_code", "message", "details"}
    assert body["error_code"] == "NOT_FOUND"


def test_every_response_carries_a_request_id(client) -> None:
    r = client.get("/api/health/live")
    assert r.headers["X-Request-ID"]

    supplied = client.get("/api/health/live", headers={"X-Request-ID": "trace-me"})
    assert supplied.headers["X-Request-ID"] == "trace-me"


def test_openapi_is_served_under_the_api_prefix(client) -> None:
    r = client.get("/api/openapi.json")
    assert r.status_code == 200
    assert r.json()["info"]["title"].startswith("LISA")
