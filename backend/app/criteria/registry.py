"""Rule registry.

Adding a rule is a class plus one entry here plus a `rule_definitions` row — no
change to the engine, the API or the frontend.
"""

from app.criteria.rules.base import CriteriaRule
from app.criteria.rules.calibration import CalibrationAccuracyRule
from app.criteria.rules.calibration_range import CalibrationRangeRule
from app.criteria.rules.concentration import ConcentrationCutoffRule
from app.criteria.rules.control import ControlAccuracyRule
from app.criteria.rules.ion_ratio import IonRatioRule
from app.criteria.rules.istd import InternalStandardRule
from app.criteria.rules.retention_time import RetentionTimeRule

REGISTRY: dict[str, CriteriaRule] = {
    rule.rule_id: rule
    for rule in (
        CalibrationAccuracyRule(),
        ControlAccuracyRule(),
        InternalStandardRule(),
        ConcentrationCutoffRule(),
        IonRatioRule(),
        RetentionTimeRule(),
        CalibrationRangeRule(),
    )
}


def get_rule(rule_id: str) -> CriteriaRule | None:
    return REGISTRY.get(rule_id)
