"""Column role resolution (spec section 5).

The real instrument writes `%Diff` where the specification writes `% Diff`, so
roles are matched by configurable patterns against whatever headers the file
actually has — never by literal equality. A role that cannot be mapped is `None`,
and the rules that depend on it will report NOT_EVALUATED rather than passing.
"""

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ColumnMapping:
    """role -> column name in this file (None when the file has no such column)."""

    roles: dict[str, str | None]

    def column(self, role: str) -> str | None:
        return self.roles.get(role)

    def value(self, row: dict[str, Any], role: str) -> str:
        column = self.roles.get(role)
        if column is None:
            return ""
        return str(row.get(column, "") or "")

    @property
    def mapped(self) -> dict[str, str]:
        return {role: name for role, name in self.roles.items() if name}

    @property
    def unmapped(self) -> list[str]:
        return sorted(role for role, name in self.roles.items() if not name)


def resolve(
    columns: list[str],
    role_patterns: dict[str, list[str]],
    overrides: dict[str, str | None] | None = None,
) -> ColumnMapping:
    """Match each role to a column, honouring any explicit override.

    Patterns are tried in order, so the configuration expresses preference: the
    first pattern that matches an unclaimed column wins. A column is claimed by at
    most one role, which stops `Conc. (ng/mL)` and `Std. Conc. (ng/mL)` from both
    binding to the concentration role.
    """
    overrides = overrides or {}
    roles: dict[str, str | None] = {}
    claimed: set[str] = set()

    # Explicit overrides come first and always win.
    for role, column in overrides.items():
        if column and column in columns:
            roles[role] = column
            claimed.add(column)

    for role, patterns in role_patterns.items():
        if role in roles:
            continue
        found: str | None = None
        for pattern in patterns:
            expression = re.compile(pattern, re.IGNORECASE)
            for column in columns:
                if column in claimed:
                    continue
                if expression.search(column.strip()):
                    found = column
                    break
            if found:
                break
        roles[role] = found
        if found:
            claimed.add(found)

    return ColumnMapping(roles=roles)
