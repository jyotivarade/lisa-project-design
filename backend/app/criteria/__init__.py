"""LISA criteria engine — a PURE package (AD-3).

Nothing here imports FastAPI, SQLAlchemy, the models, the repositories, the storage
layer or anything else that performs I/O. `app/tests/unit/test_purity.py` enforces
that, so a rule's verdict can only ever depend on the arguments it was given.
"""

from app.criteria.engine import CriteriaEngine, engine, not_evaluable
from app.criteria.models import (
    CalculationTrace,
    CalibratorPoint,
    ControlPoint,
    ErrorCode,
    EvaluationContext,
    FinalResult,
    RowData,
    RowEvaluation,
    RuleConfig,
    RuleResult,
    RuleStatus,
    Stream,
)
from app.criteria.registry import REGISTRY, get_rule
from app.criteria.values import TokenSet, Value, ValueKind, interpret
from app.criteria.version import ENGINE_VERSION

__all__ = [
    "ENGINE_VERSION",
    "REGISTRY",
    "CalculationTrace",
    "CalibratorPoint",
    "ControlPoint",
    "CriteriaEngine",
    "ErrorCode",
    "EvaluationContext",
    "FinalResult",
    "RowData",
    "RowEvaluation",
    "RuleConfig",
    "RuleResult",
    "RuleStatus",
    "Stream",
    "TokenSet",
    "Value",
    "ValueKind",
    "engine",
    "get_rule",
    "interpret",
    "not_evaluable",
]
