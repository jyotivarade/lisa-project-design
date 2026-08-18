"""Instrument value interpretation (spec section 28). PURE — no I/O, no ORM.

The single most consequential rule in this module: `----` is MISSING, never zero.
An instrument that reports no peak and an instrument that measures zero are
different facts, and collapsing them would silently turn "we could not measure
this" into "we measured nothing there".

`N.I. High` / `N.I. Low` are likewise carried as their own kinds rather than
coerced, so the calibration-range rule can act on them in Phase 5.
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import StrEnum


class ValueKind(StrEnum):
    NUMERIC = "NUMERIC"
    MISSING = "MISSING"
    OVER_RANGE = "OVER_RANGE"
    UNDER_RANGE = "UNDER_RANGE"
    NON_NUMERIC = "NON_NUMERIC"


@dataclass(frozen=True)
class TokenSet:
    """Configured instrument tokens, matched case-insensitively after trimming."""

    missing: frozenset[str]
    over_range: frozenset[str]
    under_range: frozenset[str]

    @classmethod
    def from_config(cls, tokens: dict[str, list[str]]) -> "TokenSet":
        def normalise(values: list[str]) -> frozenset[str]:
            return frozenset(v.strip().casefold() for v in values)

        return cls(
            missing=normalise(tokens.get("missing", [])),
            over_range=normalise(tokens.get("over_range", [])),
            under_range=normalise(tokens.get("under_range", [])),
        )


@dataclass(frozen=True)
class Value:
    """An interpreted cell. `raw` is always kept so nothing is lost."""

    raw: str
    kind: ValueKind
    number: Decimal | None = None

    @property
    def is_numeric(self) -> bool:
        return self.kind is ValueKind.NUMERIC

    @property
    def is_usable(self) -> bool:
        """True when a rule can compute with this value."""
        return self.kind is ValueKind.NUMERIC


EMPTY_TOKENS = TokenSet(missing=frozenset({""}), over_range=frozenset(), under_range=frozenset())


def interpret(raw: object, tokens: TokenSet) -> Value:
    """Classify one cell. Never raises, never guesses."""
    if raw is None:
        return Value(raw="", kind=ValueKind.MISSING)

    text = str(raw).strip()
    folded = text.casefold()

    if folded in tokens.over_range:
        return Value(raw=text, kind=ValueKind.OVER_RANGE)
    if folded in tokens.under_range:
        return Value(raw=text, kind=ValueKind.UNDER_RANGE)
    if text == "" or folded in tokens.missing:
        return Value(raw=text, kind=ValueKind.MISSING)

    try:
        # Decimal, never float: a %Diff of 27.87 must compare against a tolerance
        # of 25 identically on every machine and every rerun.
        return Value(raw=text, kind=ValueKind.NUMERIC, number=Decimal(text.replace(",", "")))
    except (InvalidOperation, ValueError):
        return Value(raw=text, kind=ValueKind.NON_NUMERIC)
