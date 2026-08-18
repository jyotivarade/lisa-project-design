"""Operational entry points. Run with `python -m app.cli <command>`."""

import argparse
import sys

from app.core.config import get_settings
from app.core.database import session_scope
from app.core.logging import configure_logging
from app.core.seed import seed_reference_data


def cmd_seed() -> int:
    with session_scope() as db:
        counts = seed_reference_data(db)
    print(
        f"seeded: {counts['permissions']} permissions, "
        f"{counts['roles']} roles, {counts['rule_definitions']} rule definitions"
    )
    return 0


def cmd_create_admin(args: argparse.Namespace) -> int:
    """Create the first administrator.

    Deliberately an operator command rather than an open registration endpoint: a
    laboratory system with self-service signup has no meaningful access control.
    """
    import getpass

    from app.auth.bootstrap import BootstrapError, create_admin

    password = args.password or getpass.getpass("Password: ")
    if not args.password and password != getpass.getpass("Confirm password: "):
        print("Passwords do not match.", file=sys.stderr)
        return 2

    try:
        with session_scope() as db:
            user = create_admin(
                db, email=args.email, full_name=args.full_name, password=password
            )
            email = user.email
    except BootstrapError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"created ADMIN {email}")
    return 0


def cmd_check_db() -> int:
    from sqlalchemy import text

    from app.core.database import engine

    with engine.connect() as conn:
        version = conn.execute(text("select version()")).scalar_one()
    print(version)
    return 0


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    parser = argparse.ArgumentParser(prog="lisa")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed", help="Seed roles, permissions and the rule catalogue")
    sub.add_parser("check-db", help="Verify database connectivity")

    admin = sub.add_parser("create-admin", help="Create the first administrator")
    admin.add_argument("--email", required=True)
    admin.add_argument("--full-name", required=True)
    admin.add_argument(
        "--password",
        help="Omit to be prompted. Passing it here leaves the password in shell history.",
    )

    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return cmd_create_admin(args)
    return {"seed": cmd_seed, "check-db": cmd_check_db}[args.command]()


if __name__ == "__main__":
    sys.exit(main())
