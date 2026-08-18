"""The configuration diff shown in version history."""

from app.services.configuration_service import compute_diff


def paths(before, after) -> dict[str, str]:
    return {e.path: e.change for e in compute_diff(before, after)}


def test_identical_payloads_produce_no_diff() -> None:
    payload = {"a": 1, "b": {"c": [1, 2]}}
    assert compute_diff(payload, payload) == []


def test_a_changed_scalar_reports_both_values() -> None:
    entries = compute_diff({"tolerance": 25}, {"tolerance": 30})
    assert len(entries) == 1
    assert entries[0].path == "tolerance"
    assert (entries[0].from_value, entries[0].to_value) == (25, 30)
    assert entries[0].change == "changed"


def test_nested_paths_are_dotted() -> None:
    before = {"calibration": {"minimum_required": 7}}
    after = {"calibration": {"minimum_required": 6}}
    assert compute_diff(before, after)[0].path == "calibration.minimum_required"


def test_added_and_removed_keys_are_distinguished() -> None:
    result = paths({"a": 1}, {"b": 2})
    assert result == {"a": "removed", "b": "added"}


def test_keyed_lists_are_matched_by_key_not_position() -> None:
    # Rules are a keyed collection. Diffing by index would report a reorder as a
    # wholesale rewrite of every threshold.
    before = {"rules": [{"rule_key": "a", "v": 1}, {"rule_key": "b", "v": 2}]}
    after = {"rules": [{"rule_key": "b", "v": 2}, {"rule_key": "a", "v": 1}]}
    assert compute_diff(before, after) == []


def test_a_change_inside_a_keyed_list_is_addressed_by_key() -> None:
    before = {"rules": [{"rule_key": "ion_ratio", "parameters": {"adjustment_percent": 10}}]}
    after = {"rules": [{"rule_key": "ion_ratio", "parameters": {"adjustment_percent": 25}}]}
    entry = compute_diff(before, after)[0]
    assert entry.path == "rules[ion_ratio].parameters.adjustment_percent"
    assert (entry.from_value, entry.to_value) == (10, 25)


def test_adding_and_removing_a_keyed_entry() -> None:
    before = {"rules": [{"rule_key": "a"}]}
    after = {"rules": [{"rule_key": "b"}]}
    assert paths(before, after) == {"rules[a]": "removed", "rules[b]": "added"}


def test_unkeyed_lists_fall_back_to_whole_value_comparison() -> None:
    entries = compute_diff({"ids": ["Cal_1", "Cal_2"]}, {"ids": ["Cal_1"]})
    assert len(entries) == 1
    assert entries[0].path == "ids"
    assert entries[0].to_value == ["Cal_1"]


def test_a_list_with_duplicate_keys_is_not_treated_as_keyed() -> None:
    # Two entries sharing a key cannot be matched unambiguously, so comparing the
    # whole list is the honest answer.
    before = {"rules": [{"rule_key": "a", "v": 1}, {"rule_key": "a", "v": 2}]}
    after = {"rules": [{"rule_key": "a", "v": 1}]}
    entries = compute_diff(before, after)
    assert len(entries) == 1
    assert entries[0].path == "rules"


def test_multiple_simultaneous_changes_are_all_reported() -> None:
    before = {"a": 1, "b": {"c": 2}, "d": 3}
    after = {"a": 9, "b": {"c": 8}, "d": 3}
    assert paths(before, after) == {"a": "changed", "b.c": "changed"}
