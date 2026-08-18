"""The error contract (spec section 25)."""

from app.core.errors import (
    ConflictError,
    ErrorCode,
    GateBlockedError,
    LisaError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)


def test_payload_shape() -> None:
    err = LisaError("boom", details=[{"field": "x", "issue": "bad"}])
    payload = err.to_payload(request_id="abc")
    assert set(payload) == {"error_code", "message", "details", "request_id"}
    assert payload["error_code"] == ErrorCode.INTERNAL_ERROR
    assert payload["request_id"] == "abc"


def test_status_codes() -> None:
    assert NotFoundError("x").status_code == 404
    assert ValidationError("x").status_code == 422
    assert PermissionDeniedError("x").status_code == 403
    # AD-2: every gate and state-machine violation is a 409, never a 400 or 403.
    assert ConflictError("x").status_code == 409
    assert GateBlockedError("x").status_code == 409


def test_gate_error_carries_the_specific_blocking_code() -> None:
    err = GateBlockedError(
        "Patient processing is blocked: control validation failed.",
        error_code=ErrorCode.CONTROL_FAILED,
        details=[{"control_id": "WCS2", "percent_diff": 73.90, "tolerance_percent": 25}],
    )
    assert err.status_code == 409
    assert err.to_payload()["error_code"] == "CONTROL_FAILED"
