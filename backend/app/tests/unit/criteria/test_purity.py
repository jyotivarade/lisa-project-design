"""AD-3: the criteria package is pure.

This is enforcement, not documentation. A rule that could reach a database would be
a rule whose verdict depended on something outside the six reproducibility inputs of
spec section 43 — and nobody would notice until a result could not be replayed.
"""

import ast
import importlib
import pkgutil
import sys
from pathlib import Path

import pytest

CRITERIA_ROOT = Path(__file__).resolve().parents[3] / "criteria"

FORBIDDEN_PREFIXES = (
    "fastapi",
    "starlette",
    "sqlalchemy",
    "alembic",
    "psycopg",
    "httpx",
    "requests",
    "celery",
    "redis",
    "jwt",
    "argon2",
    "app.models",
    "app.repositories",
    "app.services",
    "app.storage",
    "app.api",
    "app.audit",
    "app.auth",
    "app.processing",
    "app.core",
)

# I/O and non-determinism. A rule that read a clock or a random source could not
# produce the same verdict twice from the same inputs.
FORBIDDEN_STDLIB = ("os", "io", "pathlib", "socket", "subprocess", "random", "time")


def criteria_modules() -> list[Path]:
    return sorted(CRITERIA_ROOT.rglob("*.py"))


def imported_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module)
    return names


def test_the_package_has_modules_to_check() -> None:
    assert len(criteria_modules()) >= 10


@pytest.mark.parametrize("path", criteria_modules(), ids=lambda p: p.name)
def test_no_framework_database_or_app_layer_imports(path: Path) -> None:
    offenders = sorted(
        name
        for name in imported_names(path)
        if any(name == p or name.startswith(f"{p}.") for p in FORBIDDEN_PREFIXES)
    )
    assert offenders == [], f"{path.name} imports {offenders}"


@pytest.mark.parametrize("path", criteria_modules(), ids=lambda p: p.name)
def test_no_io_or_nondeterministic_stdlib(path: Path) -> None:
    offenders = sorted(
        name
        for name in imported_names(path)
        if any(name == p or name.startswith(f"{p}.") for p in FORBIDDEN_STDLIB)
    )
    assert offenders == [], f"{path.name} imports {offenders}"


def test_the_package_imports_with_no_database_configured(monkeypatch) -> None:
    """Importing the engine must not need settings, a driver or a connection."""
    monkeypatch.delenv("LISA_DATABASE_URL", raising=False)
    for name in [m for m in sys.modules if m.startswith("app.criteria")]:
        del sys.modules[name]

    module = importlib.import_module("app.criteria")
    assert module.ENGINE_VERSION
    assert len(module.REGISTRY) == 7


def test_every_submodule_imports_standalone() -> None:
    for info in pkgutil.walk_packages([str(CRITERIA_ROOT)], prefix="app.criteria."):
        importlib.import_module(info.name)


def test_the_engine_version_is_stamped_on_every_evaluation() -> None:
    from app.criteria import ENGINE_VERSION, CriteriaEngine

    assert CriteriaEngine.VERSION == ENGINE_VERSION
