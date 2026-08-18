"""The criteria engine (spec sections 13 and 14). PURE — data in, verdict out.

Four guarantees, each of which exists because its opposite would be dangerous:

  * **Every applicable rule runs.** No short-circuit on the first failure — section
    13 requires all of a row's failures, not just the earliest one.
  * **PASSED only if every enabled mandatory rule passed** (section 14).
  * **One row's failure never stops the run.** An exception inside a rule becomes a
    FAIL on that row and processing continues (section 5).
  * **A row nothing could evaluate is FAILED, never PASSED.** An unchecked row must
    never be indistinguishable from a verified one.
"""

import logging
from collections.abc import Sequence
from decimal import Decimal

from app.criteria.models import (
    ErrorCode,
    EvaluationContext,
    FinalResult,
    RowData,
    RowEvaluation,
    RuleConfig,
    RuleResult,
    RuleStatus,
)
from app.criteria.registry import get_rule
from app.criteria.values import ValueKind
from app.criteria.version import ENGINE_VERSION

logger = logging.getLogger(__name__)


class CriteriaEngine:
    """Deterministic: the same inputs always produce the same verdict.

    Nothing here reads a clock, a random source, or any state outside its
    arguments — that is what makes a stored result replayable (section 43).
    """

    VERSION = ENGINE_VERSION

    def evaluate(
        self,
        row: RowData,
        context: EvaluationContext,
        rules: Sequence[RuleConfig],
    ) -> RowEvaluation:
        original = self._concentration(row, context)
        adjusted = original
        cutoff: Decimal | None = None
        results: list[RuleResult] = []

        for config in sorted(rules, key=lambda r: (r.priority, r.rule_id)):
            if not config.enabled or config.stream is not row.stream:
                continue

            rule = get_rule(config.rule_id)
            if rule is None:
                results.append(
                    RuleResult(
                        rule_id=config.rule_id,
                        rule_name=config.rule_id,
                        status=RuleStatus.SKIPPED,
                        message="No such rule is registered in this engine.",
                        priority=config.priority,
                    )
                )
                continue

            try:
                result = rule.evaluate(row, config, context)
            except Exception as exc:  # noqa: BLE001 - containment is the point
                # A defect in one rule must not take down the run. The row fails
                # visibly, with the reason, and the next row is still processed.
                logger.exception(
                    "criteria rule raised",
                    extra={"rule_id": config.rule_id, "row": row.source_row_number},
                )
                result = RuleResult(
                    rule_id=config.rule_id,
                    rule_name=getattr(rule, "name", config.rule_id),
                    status=RuleStatus.FAIL,
                    message=f"The rule could not be evaluated: {type(exc).__name__}.",
                    error_code=ErrorCode.RULE_ERROR,
                    priority=config.priority,
                )

            results.append(result)

            if result.failed and result.zero_concentration:
                adjusted = Decimal(0)
            if result.rule_id == "concentration_cutoff" and result.lower_limit is not None:
                cutoff = result.lower_limit

        return RowEvaluation(
            source_row_number=row.source_row_number,
            sample_id=row.sample_id,
            analyte=row.analyte_name,
            final_result=self._verdict(results, rules),
            rules=tuple(results),
            original_concentration=original,
            adjusted_concentration=adjusted,
            cutoff_value=cutoff,
            engine_version=self.VERSION,
        )

    def _verdict(
        self, results: Sequence[RuleResult], rules: Sequence[RuleConfig]
    ) -> FinalResult:
        mandatory = {r.rule_id for r in rules if r.mandatory}
        evaluated = [r for r in results if r.status is not RuleStatus.SKIPPED]

        if not evaluated:
            # Nothing could be checked. Reporting PASSED here would make an
            # unverified row look identical to a verified one.
            return FinalResult.FAILED

        if any(r.failed and r.rule_id in mandatory for r in results):
            return FinalResult.FAILED
        return FinalResult.PASSED

    def _concentration(self, row: RowData, context: EvaluationContext) -> Decimal | None:
        value = context.value(row, "concentration")
        return value.number if value.kind is ValueKind.NUMERIC else None


def not_evaluable(row: RowData, reason: str) -> RowEvaluation:
    """A row that never reached the rules at all."""
    return RowEvaluation(
        source_row_number=row.source_row_number,
        sample_id=row.sample_id,
        analyte=row.analyte_name,
        final_result=FinalResult.FAILED,
        rules=(
            RuleResult(
                rule_id="engine",
                rule_name="Criteria Engine",
                status=RuleStatus.FAIL,
                message=reason,
                error_code=ErrorCode.NOT_EVALUABLE,
            ),
        ),
        engine_version=CriteriaEngine.VERSION,
    )


engine = CriteriaEngine()
