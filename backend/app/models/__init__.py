"""SQLAlchemy models. Importing this package registers every table on Base.metadata,
which is what Alembic autogenerate and the test schema check both rely on."""

from app.models.analytics import (
    Analytics,
    AnalyticsConfiguration,
    AnalyticsConfigurationVersion,
    RuleDefinition,
)
from app.models.audit import AuditLog
from app.models.base import Base
from app.models.file import UploadedFile
from app.models.processing import ProcessingEvent, ProcessingRow, ProcessingSession
from app.models.result import CalculationTrace, OutputFile, ProcessingResult, RuleResult
from app.models.user import Permission, RefreshToken, Role, RolePermission, User
from app.models.validation import CalibratorSelection, ControlSelection, RowCorrection

__all__ = [
    "Analytics",
    "AnalyticsConfiguration",
    "AnalyticsConfigurationVersion",
    "AuditLog",
    "Base",
    "CalculationTrace",
    "CalibratorSelection",
    "ControlSelection",
    "OutputFile",
    "Permission",
    "ProcessingEvent",
    "ProcessingResult",
    "ProcessingRow",
    "ProcessingSession",
    "RefreshToken",
    "Role",
    "RolePermission",
    "RowCorrection",
    "RuleDefinition",
    "RuleResult",
    "UploadedFile",
    "User",
]
