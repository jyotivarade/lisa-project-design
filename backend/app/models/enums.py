"""Domain enumerations.

Stored as TEXT with CHECK constraints rather than native PostgreSQL ENUM types:
adding a value later is a one-line constraint change instead of an ALTER TYPE
migration that cannot run inside a transaction. The Python enums below are the
single source of truth for the allowed values.
"""

import enum


class StrEnum(enum.StrEnum):
    """Adds a `values()` helper used to build CHECK constraints."""

    @classmethod
    def values(cls) -> list[str]:
        return [m.value for m in cls]


class RoleName(StrEnum):
    ADMIN = "ADMIN"
    ANALYST = "ANALYST"
    VIEWER = "VIEWER"


class UploadStatus(StrEnum):
    STORED = "STORED"
    PARSED = "PARSED"
    INVALID = "INVALID"


class ProcessingState(StrEnum):
    """§16. Transitions are declared once, in services/state_machine.py."""

    UPLOADED = "UPLOADED"
    VALIDATING = "VALIDATING"
    CALIBRATION_REVIEW = "CALIBRATION_REVIEW"
    CALIBRATION_FAILED = "CALIBRATION_FAILED"
    CONTROL_REVIEW = "CONTROL_REVIEW"
    CONTROL_FAILED = "CONTROL_FAILED"
    READY = "READY"
    PROCESSING_PATIENTS = "PROCESSING_PATIENTS"
    COMPLETED = "COMPLETED"
    PROCESSING_FAILED = "PROCESSING_FAILED"

    @classmethod
    def terminal(cls) -> set["ProcessingState"]:
        return {cls.COMPLETED, cls.PROCESSING_FAILED}


class Verdict(StrEnum):
    """A verdict is only valid for the exact inputs it was computed from.

    Any selection, correction or configuration change resets it to NOT_REVIEWED,
    which is what CALIBRATION_NOT_REVIEWED / CONTROL_NOT_REVIEWED protect (AD-2).
    """

    NOT_REVIEWED = "NOT_REVIEWED"
    PASS = "PASS"
    FAIL = "FAIL"


class SampleStream(StrEnum):
    CALIBRATOR = "CALIBRATOR"
    CONTROL = "CONTROL"
    PATIENT = "PATIENT"
    OTHER = "OTHER"
    SKIPPED = "SKIPPED"
    NOT_IN_SCOPE = "NOT_IN_SCOPE"


class ValueState(StrEnum):
    """Calibrator/control value quality (§10 data-quality requirement, D-07)."""

    VALID = "VALID"
    INVALID = "INVALID"
    MISSING = "MISSING"
    ZERO_EXCLUDED = "ZERO_EXCLUDED"
    UNSELECTED = "UNSELECTED"


class ValidationStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_EVALUATED = "NOT_EVALUATED"


class ControlRole(StrEnum):
    REQUIRED = "REQUIRED"
    OPTIONAL = "OPTIONAL"
    CUTOFF_SOURCE = "CUTOFF_SOURCE"
    DISCOVERED = "DISCOVERED"


class FinalResult(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"


class RuleStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    SKIPPED = "SKIPPED"


class OutputKind(StrEnum):
    PASSED = "PASSED"
    EXCEPTIONS = "EXCEPTIONS"
    SUMMARY = "SUMMARY"


class TraceKey(StrEnum):
    ION_RATIO_RANGE = "ION_RATIO_RANGE"
    RT_WINDOW = "RT_WINDOW"
    CUTOFF = "CUTOFF"
    CALIBRATION_RANGE = "CALIBRATION_RANGE"
    ISTD_BASIS = "ISTD_BASIS"


class AuditAction(StrEnum):
    """§23. Extended as later phases add mutations."""

    LOGIN = "LOGIN"
    LOGIN_FAILED = "LOGIN_FAILED"
    LOGOUT = "LOGOUT"
    UPLOAD = "UPLOAD"
    CONFIG_CREATED = "CONFIG_CREATED"
    CONFIG_CHANGED = "CONFIG_CHANGED"
    ANALYTICS_CREATED = "ANALYTICS_CREATED"
    ANALYTICS_UPDATED = "ANALYTICS_UPDATED"
    CALIBRATION_SELECTION = "CALIBRATION_SELECTION"
    CONTROL_SELECTION = "CONTROL_SELECTION"
    CALIBRATION_CORRECTION = "CALIBRATION_CORRECTION"
    CONTROL_CORRECTION = "CONTROL_CORRECTION"
    CALIBRATION_VALIDATED = "CALIBRATION_VALIDATED"
    CONTROL_VALIDATED = "CONTROL_VALIDATED"
    PROCESSING_STARTED = "PROCESSING_STARTED"
    PROCESSING_COMPLETED = "PROCESSING_COMPLETED"
    PROCESSING_FAILED = "PROCESSING_FAILED"
    RERUN = "RERUN"
    FILE_DOWNLOADED = "FILE_DOWNLOADED"
    USER_CREATED = "USER_CREATED"
    USER_UPDATED = "USER_UPDATED"
    ROLE_CHANGED = "ROLE_CHANGED"
