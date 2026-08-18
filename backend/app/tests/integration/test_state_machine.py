"""The processing state machine (spec section 16).

Phase 6 adds the gate that depends on these transitions. What matters now is that
the table is closed: there is no path to PROCESSING_PATIENTS except from READY.
"""

import pytest

from app.models.enums import ProcessingState as S
from app.services.state_machine import ALLOWED, InvalidStateTransition, can_transition, transition
from app.tests.conftest import requires_db

pytestmark = [pytest.mark.integration, requires_db]


class TestTable:
    def test_every_state_is_declared(self) -> None:
        assert set(ALLOWED) == set(S)

    def test_only_ready_reaches_patient_processing(self) -> None:
        """The safety property the whole system is built around.

        If any other state could reach PROCESSING_PATIENTS, patient results could
        be produced from a run whose calibration or controls had not passed.
        """
        sources = [state for state, targets in ALLOWED.items() if S.PROCESSING_PATIENTS in targets]
        assert sources == [S.READY]

    @pytest.mark.parametrize(
        "blocked", [S.CALIBRATION_FAILED, S.CONTROL_FAILED, S.CALIBRATION_REVIEW, S.CONTROL_REVIEW]
    )
    def test_no_failed_or_pending_state_can_start_processing(self, blocked: S) -> None:
        assert not can_transition(blocked, S.PROCESSING_PATIENTS)

    @pytest.mark.parametrize("terminal", [S.COMPLETED, S.PROCESSING_FAILED])
    def test_terminal_states_go_nowhere(self, terminal: S) -> None:
        # A rerun creates a new session rather than reviving a finished one.
        assert ALLOWED[terminal] == set()

    def test_a_failed_verdict_can_be_revisited(self) -> None:
        # The review loop is the point: re-select or correct, then validate again.
        assert can_transition(S.CALIBRATION_FAILED, S.CALIBRATION_REVIEW)
        assert can_transition(S.CONTROL_FAILED, S.CONTROL_REVIEW)

    def test_readiness_can_be_revoked(self) -> None:
        # Changing a selection after READY invalidates the verdict that granted it;
        # a stale PASS must never survive a data change.
        assert can_transition(S.READY, S.CALIBRATION_REVIEW)
        assert can_transition(S.READY, S.CONTROL_REVIEW)


class TestTransitions:
    def _session(self, db, analytics_factory, upload_fixture):
        from sqlalchemy import select

        from app.models import ProcessingSession

        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)
        return db.scalar(
            select(ProcessingSession).where(ProcessingSession.id == result["session"]["id"])
        )

    def test_an_illegal_transition_is_refused_before_any_write(
        self, db, analytics_factory, upload_fixture
    ) -> None:
        session = self._session(db, analytics_factory, upload_fixture)
        assert session.state == S.CALIBRATION_REVIEW.value

        with pytest.raises(InvalidStateTransition) as excinfo:
            transition(db, session, S.PROCESSING_PATIENTS)

        assert excinfo.value.status_code == 409
        assert excinfo.value.error_code == "INVALID_STATE"
        # The state is untouched, so a refused move cannot half-apply.
        assert session.state == S.CALIBRATION_REVIEW.value

    def test_a_legal_transition_records_an_event(
        self, db, analytics_factory, upload_fixture
    ) -> None:
        from sqlalchemy import select

        from app.models import ProcessingEvent

        session = self._session(db, analytics_factory, upload_fixture)
        transition(db, session, S.CONTROL_REVIEW, reason="calibration passed")

        event = db.scalars(
            select(ProcessingEvent)
            .where(ProcessingEvent.session_id == session.id)
            .order_by(ProcessingEvent.created_at.desc())
        ).first()
        assert event.from_state == S.CALIBRATION_REVIEW.value
        assert event.to_state == S.CONTROL_REVIEW.value
        assert event.reason == "calibration passed"
