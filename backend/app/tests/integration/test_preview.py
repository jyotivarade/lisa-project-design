"""File preview and listing (spec sections 4 and 32)."""

import pytest

from app.models.enums import RoleName, SampleStream
from app.tests.conftest import requires_db

pytestmark = [pytest.mark.integration, requires_db]


@pytest.fixture
def uploaded(analytics_factory, upload_fixture):
    analytics, headers = analytics_factory()
    return upload_fixture(analytics["id"], headers), headers, analytics


class TestPreview:
    def test_preview_describes_the_file_without_the_browser_parsing_it(
        self, client, uploaded
    ) -> None:
        result, headers, _ = uploaded
        body = client.get(f"/api/files/{result['file']['id']}/preview", headers=headers).json()

        assert len(body["columns"]) == 19
        assert body["columns"][0] == "Analyte Name"
        assert body["stream_counts"] == {
            SampleStream.CALIBRATOR.value: 7,
            SampleStream.CONTROL.value: 4,
            SampleStream.PATIENT.value: 118,
        }

    def test_the_column_mapping_is_shown_including_what_is_missing(
        self, client, uploaded
    ) -> None:
        result, headers, _ = uploaded
        body = client.get(f"/api/files/{result['file']['id']}/preview", headers=headers).json()

        assert body["column_mappings"]["percent_diff"] == "%Diff"
        assert body["column_mappings"]["ion_ratio"] == "Ref 1 Actual Ratio"
        # D-05: no real export has these, and the preview says so rather than
        # leaving it to be discovered when a rule quietly does nothing.
        assert body["column_mappings"]["recovery"] is None
        assert "recovery" in body["unmapped_roles"]
        assert any("recovery" in w for w in body["warnings"])

    def test_only_the_requested_number_of_rows_is_returned(self, client, uploaded) -> None:
        # A 500 000-row file must cost the browser exactly as much as this one.
        result, headers, _ = uploaded
        body = client.get(
            f"/api/files/{result['file']['id']}/preview?limit=10", headers=headers
        ).json()
        assert len(body["rows"]) == 10
        assert body["row_limit"] == 10
        assert body["session"]["total_rows"] == 129

    def test_the_preview_limit_is_capped(self, client, uploaded) -> None:
        result, headers, _ = uploaded
        assert client.get(
            f"/api/files/{result['file']['id']}/preview?limit=100000", headers=headers
        ).status_code == 422

    def test_rows_can_be_filtered_by_stream(self, client, uploaded) -> None:
        result, headers, _ = uploaded
        body = client.get(
            f"/api/files/{result['file']['id']}/preview?stream=CALIBRATOR", headers=headers
        ).json()
        assert len(body["rows"]) == 7
        assert {r["sample_id"] for r in body["rows"]} == {f"Cal_{n}" for n in range(1, 8)}

    def test_each_row_explains_its_classification(self, client, uploaded) -> None:
        result, headers, _ = uploaded
        body = client.get(
            f"/api/files/{result['file']['id']}/preview?stream=CONTROL", headers=headers
        ).json()
        uc = next(r for r in body["rows"] if r["sample_id"] == "UC")
        assert "not required" in uc["classification_reason"]

    def test_row_values_are_the_originals(self, client, uploaded) -> None:
        result, headers, _ = uploaded
        body = client.get(
            f"/api/files/{result['file']['id']}/preview?stream=CONTROL", headers=headers
        ).json()
        uc = next(r for r in body["rows"] if r["sample_id"] == "UC")
        assert uc["values"]["%Diff"] == "----"

    def test_preview_of_an_unknown_file_is_not_found(self, client, login) -> None:
        _, headers = login(RoleName.ANALYST)
        assert client.get(
            "/api/files/00000000-0000-0000-0000-000000000000/preview", headers=headers
        ).status_code == 404


class TestFileListing:
    def test_files_are_listed_for_an_analytics(self, client, uploaded) -> None:
        result, headers, analytics = uploaded
        body = client.get(f"/api/analytics/{analytics['id']}/files", headers=headers).json()
        assert body["total"] == 1
        assert body["items"][0]["original_filename"] == "Cocaine_2026_08_01.csv"

    def test_the_global_file_list_names_its_analytics_and_sessions(
        self, client, uploaded
    ) -> None:
        result, headers, analytics = uploaded
        body = client.get("/api/files", headers=headers).json()
        item = body["items"][0]
        assert item["analytics_name"] == analytics["name"]
        assert len(item["sessions"]) == 1
        assert item["sessions"][0]["state"] == "CALIBRATION_REVIEW"

    def test_file_detail_carries_its_sessions(self, client, uploaded) -> None:
        result, headers, _ = uploaded
        body = client.get(f"/api/files/{result['file']['id']}", headers=headers).json()
        assert body["total_rows"] == 129
        assert len(body["sessions"]) == 1

    def test_a_viewer_can_read_and_download_but_not_upload(self, client, uploaded, login) -> None:
        result, _, analytics = uploaded
        _, viewer = login(RoleName.VIEWER, email="viewer@lisa.local")
        assert client.get("/api/files", headers=viewer).status_code == 200
        assert client.get(
            f"/api/files/{result['file']['id']}/download", headers=viewer
        ).status_code == 200


class TestAnalyticsCountsAreReal:
    def test_the_analytics_list_reports_actual_uploads(
        self, client, analytics_factory, upload_fixture
    ) -> None:
        """Spec section 27: these numbers come from rows, never from estimates."""
        analytics, headers = analytics_factory()
        before = client.get("/api/analytics", headers=headers).json()["items"][0]
        assert before["file_count"] == 0
        assert before["last_uploaded_at"] is None
        assert before["last_session_state"] is None

        upload_fixture(analytics["id"], headers)
        upload_fixture(analytics["id"], headers, "Cocaine_2026_08_02.csv")

        after = client.get("/api/analytics", headers=headers).json()["items"][0]
        assert after["file_count"] == 2
        assert after["session_count"] == 2
        assert after["last_uploaded_at"] is not None
        assert after["last_session_state"] == "CALIBRATION_REVIEW"
