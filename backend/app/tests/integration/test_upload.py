"""Upload, storage and parsing against the real instrument exports."""

import io

import pytest
from sqlalchemy import func, select

from app.models import AuditLog, ProcessingEvent, ProcessingRow, ProcessingSession, UploadedFile
from app.models.enums import AuditAction, ProcessingState, RoleName, SampleStream
from app.tests.conftest import FIXTURES_DIR, requires_db

pytestmark = [pytest.mark.integration, requires_db]


def csv_upload(client, analytics_id, headers, name: str, content: bytes):
    return client.post(
        f"/api/analytics/{analytics_id}/files",
        files={"files": (name, io.BytesIO(content), "text/csv")},
        headers=headers,
    )


class TestUpload:
    def test_a_real_export_uploads_and_parses(self, analytics_factory, upload_fixture) -> None:
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)

        assert result["file"]["status"] == "PARSED"
        assert result["file"]["total_rows"] == 129
        assert result["file"]["empty_rows"] == 0
        assert result["file"]["malformed_rows"] == 0
        assert result["file"]["detected_analytes"] == ["Cocaine"]
        assert result["session"]["state"] == ProcessingState.CALIBRATION_REVIEW.value

    def test_the_streams_match_the_real_run(self, analytics_factory, upload_fixture) -> None:
        # Run 01: Cal_1..Cal_7, WCS1/2/3 plus UC, and 118 patient samples.
        analytics, headers = analytics_factory()
        session = upload_fixture(analytics["id"], headers)["session"]
        assert session["calibrator_rows"] == 7
        assert session["control_rows"] == 4
        assert session["patient_rows"] == 118
        assert session["total_rows"] == 129

    def test_the_stored_file_is_byte_identical_to_the_upload(
        self, client, analytics_factory, upload_fixture, storage, db
    ) -> None:
        """Spec section 18: the original is never modified."""
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)

        original = (FIXTURES_DIR / "Cocaine_2026_08_01.csv").read_bytes()
        uploaded = db.scalar(select(UploadedFile).where(UploadedFile.id == result["file"]["id"]))
        assert storage.open(uploaded.stored_filename).read() == original
        assert uploaded.size_bytes == len(original)

    def test_the_download_returns_exactly_what_was_uploaded(
        self, client, analytics_factory, upload_fixture
    ) -> None:
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)

        response = client.get(f"/api/files/{result['file']['id']}/download", headers=headers)
        assert response.status_code == 200
        assert response.content == (FIXTURES_DIR / "Cocaine_2026_08_01.csv").read_bytes()
        assert "Cocaine_2026_08_01.csv" in response.headers["content-disposition"]

    def test_the_stored_key_never_contains_the_user_filename(
        self, client, analytics_factory, db
    ) -> None:
        """A user filename is metadata. No user string ever reaches a path."""
        analytics, headers = analytics_factory()
        response = csv_upload(
            client, analytics["id"], headers, "../../etc/passwd.csv", b"A\n1\n"
        )
        assert response.status_code == 201
        stored = db.scalar(select(UploadedFile.stored_filename))
        assert ".." not in stored
        assert "passwd" not in stored
        assert stored.startswith("analytics/")

    def test_uploads_are_additive_and_never_overwrite(
        self, analytics_factory, upload_fixture, db
    ) -> None:
        analytics, headers = analytics_factory()
        first = upload_fixture(analytics["id"], headers)
        second = upload_fixture(analytics["id"], headers, "Cocaine_2026_08_02.csv")

        assert first["file"]["id"] != second["file"]["id"]
        assert db.scalar(select(func.count()).select_from(UploadedFile)) == 2
        # Two files, two independent sessions, both numbered 1 for their own file.
        assert first["session"]["session_number"] == 1
        assert second["session"]["session_number"] == 1

    def test_the_session_is_pinned_to_a_configuration_snapshot(
        self, analytics_factory, upload_fixture, db
    ) -> None:
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)
        session = db.scalar(
            select(ProcessingSession).where(ProcessingSession.id == result["session"]["id"])
        )
        assert session.config_snapshot["schema_version"] == 1
        assert session.config_version_id is not None
        assert session.engine_version  # part of the six reproducibility inputs

    def test_the_upload_is_audited(self, analytics_factory, upload_fixture, db) -> None:
        analytics, headers = analytics_factory()
        upload_fixture(analytics["id"], headers)
        entry = db.scalar(select(AuditLog).where(AuditLog.action == AuditAction.UPLOAD.value))
        assert entry is not None
        assert entry.new_value["filename"] == "Cocaine_2026_08_01.csv"
        assert entry.new_value["sha256"]

    def test_state_transitions_are_recorded(self, analytics_factory, upload_fixture, db) -> None:
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)
        events = db.scalars(
            select(ProcessingEvent)
            .where(ProcessingEvent.session_id == result["session"]["id"])
            .order_by(ProcessingEvent.created_at)
        ).all()
        assert [e.to_state for e in events] == [
            ProcessingState.VALIDATING.value,
            ProcessingState.CALIBRATION_REVIEW.value,
        ]

    def test_a_viewer_cannot_upload(self, client, analytics_factory, login) -> None:
        analytics, _ = analytics_factory()
        _, viewer = login(RoleName.VIEWER, email="viewer@lisa.local")
        response = csv_upload(client, analytics["id"], viewer, "x.csv", b"A\n1\n")
        assert response.status_code == 403


class TestDuplicates:
    def test_identical_content_is_flagged_but_still_stored(
        self, analytics_factory, upload_fixture, db
    ) -> None:
        """Spec section 4: detect duplicates, never silently delete the file."""
        analytics, headers = analytics_factory()
        first = upload_fixture(analytics["id"], headers)
        second = upload_fixture(analytics["id"], headers)

        assert first["file"]["is_duplicate"] is False
        assert second["file"]["is_duplicate"] is True
        assert second["duplicate_of_id"] == first["file"]["id"]
        assert any("already uploaded" in w for w in second["warnings"])
        # Both rows survive, and both remain processable.
        assert db.scalar(select(func.count()).select_from(UploadedFile)) == 2
        assert second["session"]["state"] == ProcessingState.CALIBRATION_REVIEW.value

    def test_the_same_file_in_another_analytics_is_not_a_duplicate(
        self, analytics_factory, upload_fixture
    ) -> None:
        first, headers = analytics_factory("Cocaine")
        second, _ = analytics_factory("Cocaine Backup", "Cocaine", headers=headers)
        upload_fixture(first["id"], headers)
        result = upload_fixture(second["id"], headers)
        assert result["file"]["is_duplicate"] is False


class TestValidation:
    def test_a_non_csv_extension_is_refused(self, client, analytics_factory) -> None:
        analytics, headers = analytics_factory()
        response = client.post(
            f"/api/analytics/{analytics['id']}/files",
            files={"files": ("report.xlsx", io.BytesIO(b"PK\x03\x04"), "application/vnd.ms-excel")},
            headers=headers,
        )
        assert response.status_code == 400
        assert response.json()["error_code"] == "UNSUPPORTED_FILE_TYPE"

    def test_an_empty_file_is_refused_and_the_session_fails(
        self, client, analytics_factory, db
    ) -> None:
        analytics, headers = analytics_factory()
        response = csv_upload(client, analytics["id"], headers, "empty.csv", b"")
        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_CSV"

    def test_oversized_uploads_are_refused(self, client, analytics_factory, headers=None) -> None:
        analytics, headers = analytics_factory()
        # Shrink the limit through configuration rather than hard-coding a size here.
        config = client.get(
            f"/api/analytics/{analytics['id']}/configuration", headers=headers
        ).json()["payload"]
        config["limits"]["max_upload_bytes"] = 64
        client.post(
            f"/api/analytics/{analytics['id']}/configuration",
            json={"payload": config},
            headers=headers,
        )

        response = csv_upload(
            client, analytics["id"], headers, "big.csv", b"A,B\n" + b"1,2\n" * 100
        )
        assert response.status_code == 413
        assert response.json()["error_code"] == "FILE_TOO_LARGE"


class TestRowHandling:
    def test_blank_rows_are_skipped_and_reported_not_failed(
        self, client, analytics_factory, db
    ) -> None:
        analytics, headers = analytics_factory()
        content = (
            b"Analyte Name,Sample ID,Sample Type,%Diff\n"
            b"Cocaine,Cal_1,Standard,-0.22\n"
            b",,,\n"
            b"   ,  ,  ,  \n"
            b"Cocaine,2606251001,Unknown,----\n"
        )
        result = csv_upload(client, analytics["id"], headers, "gaps.csv", content).json()[
            "results"
        ][0]

        assert result["file"]["empty_rows"] == 2
        assert result["file"]["total_rows"] == 2
        assert result["session"]["skipped_rows"] == 2
        assert any("blank row" in w for w in result["warnings"])
        # Blank rows are not persisted at all, so they can never reach a report.
        rows = db.scalars(
            select(ProcessingRow).where(ProcessingRow.session_id == result["session"]["id"])
        ).all()
        assert [r.source_row_number for r in rows] == [1, 4]

    def test_malformed_rows_are_flagged_and_the_run_continues(
        self, client, analytics_factory, db
    ) -> None:
        analytics, headers = analytics_factory()
        content = (
            b"Analyte Name,Sample ID,Sample Type,%Diff\n"
            b"Cocaine,Cal_1,Standard,-0.22\n"
            b"Cocaine,Cal_2,Standard\n"
            b"Cocaine,2606251001,Unknown,----\n"
        )
        result = csv_upload(client, analytics["id"], headers, "ragged.csv", content).json()[
            "results"
        ][0]

        assert result["file"]["malformed_rows"] == 1
        assert result["file"]["total_rows"] == 3
        assert result["session"]["state"] == ProcessingState.CALIBRATION_REVIEW.value

        rows = db.scalars(
            select(ProcessingRow)
            .where(ProcessingRow.session_id == result["session"]["id"])
            .order_by(ProcessingRow.source_row_number)
        ).all()
        assert [r.is_malformed for r in rows] == [False, True, False]
        assert rows[1].parse_warnings

    def test_the_instrument_missing_token_is_stored_verbatim(
        self, analytics_factory, upload_fixture, db
    ) -> None:
        """`----` must survive into the row exactly as written — never as 0."""
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)
        uc = db.scalar(
            select(ProcessingRow).where(
                ProcessingRow.session_id == result["session"]["id"],
                ProcessingRow.sample_id == "UC",
            )
        )
        assert uc.raw["%Diff"] == "----"

    def test_rows_are_stored_verbatim(self, analytics_factory, upload_fixture, db) -> None:
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)
        row = db.scalar(
            select(ProcessingRow).where(
                ProcessingRow.session_id == result["session"]["id"],
                ProcessingRow.sample_id == "Cal_1",
            )
        )
        assert row.raw["%Diff"] == "-0.22"
        assert row.raw["Ref 1 Actual Ratio"] == "25.31"
        assert row.raw["Std. Conc. (ng/mL)"] == "1"


class TestClassificationInSession:
    def test_every_row_records_why_it_was_classified(
        self, analytics_factory, upload_fixture, db
    ) -> None:
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)
        rows = db.scalars(
            select(ProcessingRow).where(ProcessingRow.session_id == result["session"]["id"])
        ).all()
        assert all(row.classification_reason for row in rows)

    def test_uc_is_recorded_as_a_discovered_control(
        self, analytics_factory, upload_fixture, db
    ) -> None:
        analytics, headers = analytics_factory()
        result = upload_fixture(analytics["id"], headers)
        uc = db.scalar(
            select(ProcessingRow).where(
                ProcessingRow.session_id == result["session"]["id"],
                ProcessingRow.sample_id == "UC",
            )
        )
        assert uc.stream == SampleStream.CONTROL.value
        assert "not required" in uc.classification_reason


class TestAnalyteScope:
    def test_rows_for_another_analyte_are_counted_but_not_processed(
        self, client, analytics_factory, db
    ) -> None:
        """D-13, STRICT: a foreign analyte is listed, never evaluated against this
        assay's calibration."""
        analytics, headers = analytics_factory("Cocaine", "Cocaine")
        content = (
            b"Analyte Name,Sample ID,Sample Type,%Diff\n"
            b"Cocaine,2606251001,Unknown,----\n"
            b"Benzoylecgonine,2606251002,Unknown,----\n"
        )
        result = csv_upload(client, analytics["id"], headers, "mixed.csv", content).json()[
            "results"
        ][0]

        rows = {
            r.sample_id: r
            for r in db.scalars(
                select(ProcessingRow).where(
                    ProcessingRow.session_id == result["session"]["id"]
                )
            )
        }
        assert rows["2606251001"].stream == SampleStream.PATIENT.value
        assert rows["2606251002"].stream == SampleStream.NOT_IN_SCOPE.value
        assert "Benzoylecgonine" in rows["2606251002"].classification_reason
        assert result["session"]["patient_rows"] == 1

    def test_the_all_policy_processes_every_analyte(self, client, analytics_factory, db) -> None:
        analytics, headers = analytics_factory("Cocaine", "Cocaine")
        config = client.get(
            f"/api/analytics/{analytics['id']}/configuration", headers=headers
        ).json()["payload"]
        config["analyte_scope_policy"] = "ALL"
        client.post(
            f"/api/analytics/{analytics['id']}/configuration",
            json={"payload": config},
            headers=headers,
        )

        content = (
            b"Analyte Name,Sample ID,Sample Type,%Diff\n"
            b"Cocaine,2606251001,Unknown,----\n"
            b"Benzoylecgonine,2606251002,Unknown,----\n"
        )
        result = csv_upload(client, analytics["id"], headers, "mixed.csv", content).json()[
            "results"
        ][0]
        assert result["session"]["patient_rows"] == 2
