"""The LISA error contract (§25).

Every failure reaching a client is `{error_code, message, details, request_id}`.
Raw exception text is never returned — it is logged against the request_id instead.
"""

from typing import Any


class ErrorCode:
    """Stable error codes. Clients branch on these, never on message text."""

    # generic
    INTERNAL_ERROR = "INTERNAL_ERROR"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    # auth (Phase 2)
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    ACCOUNT_LOCKED = "ACCOUNT_LOCKED"
    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    TOKEN_REUSED = "TOKEN_REUSED"
    # files (Phase 4)
    INVALID_CSV = "INVALID_CSV"
    UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    DUPLICATE_FILE = "DUPLICATE_FILE"
    MISSING_COLUMN = "MISSING_COLUMN"
    MALFORMED_ROW = "MALFORMED_ROW"
    # configuration (Phase 3)
    INVALID_CONFIGURATION = "INVALID_CONFIGURATION"
    # validation / gate (Phase 6) — these are the AD-2 codes, returned as HTTP 409
    MISSING_CALIBRATOR = "MISSING_CALIBRATOR"
    MISSING_CONTROL = "MISSING_CONTROL"
    CALIBRATION_FAILED = "CALIBRATION_FAILED"
    CONTROL_FAILED = "CONTROL_FAILED"
    CALIBRATION_NOT_REVIEWED = "CALIBRATION_NOT_REVIEWED"
    CONTROL_NOT_REVIEWED = "CONTROL_NOT_REVIEWED"
    INVALID_STATE = "INVALID_STATE"
    CORRECTION_NOT_ALLOWED = "CORRECTION_NOT_ALLOWED"
    # outputs (Phase 8)
    FILE_GENERATION_FAILED = "FILE_GENERATION_FAILED"


class LisaError(Exception):
    """Base of every error that is safe to show a user."""

    status_code: int = 500
    error_code: str = ErrorCode.INTERNAL_ERROR

    def __init__(
        self,
        message: str,
        *,
        details: list[dict[str, Any]] | None = None,
        error_code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or []
        if error_code is not None:
            self.error_code = error_code
        if status_code is not None:
            self.status_code = status_code

    def to_payload(self, request_id: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "error_code": self.error_code,
            "message": self.message,
            "details": self.details,
        }
        if request_id:
            payload["request_id"] = request_id
        return payload


class NotFoundError(LisaError):
    status_code = 404
    error_code = ErrorCode.NOT_FOUND


class ValidationError(LisaError):
    status_code = 422
    error_code = ErrorCode.VALIDATION_ERROR


class AuthenticationError(LisaError):
    status_code = 401
    error_code = ErrorCode.NOT_AUTHENTICATED


class PermissionDeniedError(LisaError):
    status_code = 403
    error_code = ErrorCode.PERMISSION_DENIED


class ConflictError(LisaError):
    """State-machine and gate violations (AD-2). Always HTTP 409."""

    status_code = 409
    error_code = ErrorCode.INVALID_STATE


class GateBlockedError(ConflictError):
    """Patient processing refused. Carries the specific blocking code."""
