"""Instrument value interpretation (spec section 28)."""

from decimal import Decimal

import pytest

from app.criteria.values import TokenSet, Value, ValueKind, interpret

TOKENS = TokenSet.from_config(
    {
        "missing": ["----", "", "N/A", "NA"],
        "over_range": ["N.I. High", "N.I.(High)"],
        "under_range": ["N.I. Low"],
    }
)


class TestMissing:
    @pytest.mark.parametrize("raw", ["----", "", "  ", "N/A", "na", None, "  ----  "])
    def test_missing_tokens_are_missing(self, raw) -> None:
        assert interpret(raw, TOKENS).kind is ValueKind.MISSING

    def test_a_missing_value_is_never_zero(self) -> None:
        """The single most consequential rule in this module.

        An instrument reporting no peak and an instrument measuring zero are
        different facts. Collapsing them would turn "we could not measure this"
        into "we measured nothing there" — a silent, plausible, wrong result.
        """
        value = interpret("----", TOKENS)
        assert value.number is None
        assert value.number != Decimal(0)
        assert not value.is_usable

    def test_the_raw_token_is_preserved(self) -> None:
        assert interpret("----", TOKENS).raw == "----"


class TestNumeric:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("27.87", Decimal("27.87")),
            ("-11.46", Decimal("-11.46")),
            ("0", Decimal(0)),
            ("0.0000", Decimal("0.0000")),
            ("18266257", Decimal(18266257)),
            (" 4.348 ", Decimal("4.348")),
            ("1,234.5", Decimal("1234.5")),
            ("1e3", Decimal("1000")),
        ],
    )
    def test_real_instrument_values_parse(self, raw: str, expected: Decimal) -> None:
        value = interpret(raw, TOKENS)
        assert value.kind is ValueKind.NUMERIC
        assert value.number == expected

    def test_decimal_not_float(self) -> None:
        # 27.87 must compare against a tolerance of 25 identically on every machine
        # and every rerun; binary floating point cannot promise that.
        assert isinstance(interpret("27.87", TOKENS).number, Decimal)
        assert interpret("0.1", TOKENS).number + interpret("0.2", TOKENS).number == Decimal("0.3")

    def test_zero_is_a_real_measurement(self) -> None:
        value = interpret("0", TOKENS)
        assert value.is_usable
        assert value.number == Decimal(0)


class TestRangeTokens:
    @pytest.mark.parametrize("raw", ["N.I. High", "n.i. high", "N.I.(High)", " N.I. High "])
    def test_over_range_tokens(self, raw: str) -> None:
        assert interpret(raw, TOKENS).kind is ValueKind.OVER_RANGE

    def test_under_range_token(self) -> None:
        assert interpret("N.I. Low", TOKENS).kind is ValueKind.UNDER_RANGE

    def test_range_tokens_carry_no_number(self) -> None:
        # Coercing N.I. High to a number would invent a measurement the instrument
        # explicitly declined to report.
        assert interpret("N.I. High", TOKENS).number is None


class TestNonNumeric:
    @pytest.mark.parametrize("raw", ["abc", "12abc", "--", "#DIV/0!"])
    def test_unparseable_text_is_flagged_not_guessed(self, raw: str) -> None:
        value = interpret(raw, TOKENS)
        assert value.kind is ValueKind.NON_NUMERIC
        assert value.number is None
        assert value.raw == raw


class TestTokenSet:
    def test_tokens_come_from_configuration(self) -> None:
        custom = TokenSet.from_config({"missing": ["NULL"], "over_range": [], "under_range": []})
        assert interpret("NULL", custom).kind is ValueKind.MISSING
        # "----" is not special unless configured — nothing is hard-coded.
        assert interpret("----", custom).kind is ValueKind.NON_NUMERIC

    def test_matching_is_case_and_whitespace_insensitive(self) -> None:
        assert interpret("  n/a  ", TOKENS).kind is ValueKind.MISSING


def test_value_is_immutable() -> None:
    value = Value(raw="1", kind=ValueKind.NUMERIC, number=Decimal(1))
    with pytest.raises(AttributeError):
        value.number = Decimal(2)  # type: ignore[misc]
