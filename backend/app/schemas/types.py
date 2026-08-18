"""Shared field types."""

from typing import Annotated

import email_validator
from pydantic import AfterValidator

# LISA is deployed on-premise inside laboratory networks, where an internal domain
# such as `lisa.local` is an ordinary address. email-validator treats `.local` as a
# special-use name and rejects it, which would make valid internal accounts
# unregisterable — so it is removed from that list, and only from that list.
#
# `invalid`, `localhost`, `arpa`, `onion` and `test` stay rejected: none of them
# names a mailbox anyone could actually receive at.
#
# This is the library's documented extension point for site-specific policy.
email_validator.SPECIAL_USE_DOMAIN_NAMES = [
    name for name in email_validator.SPECIAL_USE_DOMAIN_NAMES if name != "local"
]


def _validate_email(value: str) -> str:
    """Syntax only. Deliverability is never checked — LISA sends no mail, and a DNS
    lookup on a login request would be a denial-of-service waiting to happen."""
    try:
        result = email_validator.validate_email(
            value, check_deliverability=False, allow_smtputf8=False
        )
    except email_validator.EmailNotValidError as exc:
        raise ValueError(str(exc)) from exc
    # Stored lower-cased so casing can never create a second account for one person.
    return result.normalized.lower()


Email = Annotated[str, AfterValidator(_validate_email)]
