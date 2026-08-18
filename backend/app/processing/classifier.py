"""Row classification (spec sections 5 and 28).

Classification uses Sample Type **and** Sample ID, driven by ordered rules from the
configuration snapshot. First match wins, and the rule that matched is recorded on
every row so the UI can answer "why is this a control?" with the actual reason.

`BLANK` and `Double Blank` are never patient rows regardless of their sample type —
that is the whole reason the rules are ordered rather than a lookup.
"""

import re
from dataclasses import dataclass
from typing import Any

from app.models.enums import SampleStream


@dataclass(frozen=True)
class ClassificationRule:
    priority: int
    stream: SampleStream
    match_mode: str
    sample_id_pattern: re.Pattern[str]
    sample_type_pattern: re.Pattern[str]
    label: str


@dataclass(frozen=True)
class Classification:
    stream: SampleStream
    reason: str


def compile_rules(raw_rules: list[dict[str, Any]]) -> list[ClassificationRule]:
    rules = [
        ClassificationRule(
            priority=int(rule["priority"]),
            stream=SampleStream(rule["stream"]),
            match_mode=str(rule["match_mode"]),
            sample_id_pattern=re.compile(rule["sample_id_pattern"], re.IGNORECASE),
            sample_type_pattern=re.compile(rule["sample_type_pattern"], re.IGNORECASE),
            label=str(rule["label"]),
        )
        for rule in raw_rules
    ]
    return sorted(rules, key=lambda r: r.priority)


def classify(
    sample_id: str, sample_type: str, rules: list[ClassificationRule]
) -> Classification:
    identifier = (sample_id or "").strip()
    kind = (sample_type or "").strip()

    for rule in rules:
        id_matches = bool(rule.sample_id_pattern.match(identifier))
        type_matches = bool(rule.sample_type_pattern.match(kind))

        if rule.match_mode == "id_only":
            matched = id_matches
        elif rule.match_mode == "type_only":
            matched = type_matches
        else:
            matched = id_matches and type_matches

        if matched:
            return Classification(stream=rule.stream, reason=rule.label)

    # Nothing matched: OTHER, never PATIENT. A row we cannot identify must not be
    # treated as a patient sample by default.
    return Classification(
        stream=SampleStream.OTHER, reason="No classification rule matched this row."
    )
