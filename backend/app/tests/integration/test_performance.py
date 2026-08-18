"""Large-file behaviour (spec section 32). Run with `pytest -m slow`.

The claim being tested is bounded memory, not raw speed: parsing must cost O(batch)
rather than O(file), so a 500 000-row export is a scheduling question rather than
an outage.
"""

import io
import os
import resource
import time

import pytest

from app.models.enums import SampleStream
from app.tests.conftest import requires_db

pytestmark = [pytest.mark.integration, pytest.mark.slow, requires_db]

ROWS = 500_000


def synthetic_export(rows: int) -> bytes:
    """A file shaped like the real instrument export, at scale."""
    out = io.StringIO()
    out.write(
        "Analyte Name,Sample ID,Sample Type,ISTD Area,Found RT,"
        "Ref 1 Actual Ratio,Std. Conc. (ng/mL),Conc. (ng/mL),%Diff\n"
    )
    for n in range(1, 8):
        out.write(f"Cocaine,Cal_{n},Standard,18266257,4.348,25.31,{n},0.9978,-0.22\n")
    for n in range(1, 4):
        out.write(f"Cocaine,WCS{n},Control,14716504,4.333,29.08,1.5,1.3926,-7.16\n")
    for n in range(rows - 10):
        out.write(
            f"Cocaine,26062{n:08d},Unknown,13395265,4.355,31.18,----,1.2163,----\n"
        )
    return out.getvalue().encode()


def peak_rss_mb() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS reports bytes, Linux kilobytes.
    return usage / (1024 * 1024) if os.uname().sysname == "Darwin" else usage / 1024


def test_a_half_million_row_export_parses_within_budget(
    client, analytics_factory, storage
) -> None:
    analytics, headers = analytics_factory()
    content = synthetic_export(ROWS)

    # Raise the configured limit rather than hard-coding a size in the test.
    config = client.get(
        f"/api/analytics/{analytics['id']}/configuration", headers=headers
    ).json()["payload"]
    config["limits"]["max_upload_bytes"] = len(content) * 2
    client.post(
        f"/api/analytics/{analytics['id']}/configuration",
        json={"payload": config},
        headers=headers,
    )

    before_mb = peak_rss_mb()
    started = time.monotonic()
    response = client.post(
        f"/api/analytics/{analytics['id']}/files",
        files={"files": ("large.csv", io.BytesIO(content), "text/csv")},
        headers=headers,
    )
    elapsed = time.monotonic() - started
    growth_mb = peak_rss_mb() - before_mb

    assert response.status_code == 201, response.text
    result = response.json()["results"][0]
    assert result["file"]["total_rows"] == ROWS
    assert result["session"]["patient_rows"] == ROWS - 10
    assert result["session"]["calibrator_rows"] == 7
    assert result["session"]["control_rows"] == 3

    print(
        f"\n{ROWS:,} rows · {len(content) / 1e6:.1f} MB file · "
        f"{elapsed:.1f}s · peak RSS growth {growth_mb:.0f} MB"
    )
    # The file itself is ~50 MB; holding several multiples of it would mean the
    # streaming is not actually streaming.
    assert growth_mb < 1_500, f"parser retained {growth_mb:.0f} MB"


def test_preview_of_a_large_file_stays_cheap(client, analytics_factory, storage) -> None:
    """The browser must pay the same for 500 000 rows as for 129."""
    analytics, headers = analytics_factory()
    content = synthetic_export(50_000)
    config = client.get(
        f"/api/analytics/{analytics['id']}/configuration", headers=headers
    ).json()["payload"]
    config["limits"]["max_upload_bytes"] = len(content) * 2
    client.post(
        f"/api/analytics/{analytics['id']}/configuration",
        json={"payload": config},
        headers=headers,
    )
    result = client.post(
        f"/api/analytics/{analytics['id']}/files",
        files={"files": ("large.csv", io.BytesIO(content), "text/csv")},
        headers=headers,
    ).json()["results"][0]

    started = time.monotonic()
    body = client.get(
        f"/api/files/{result['file']['id']}/preview?limit=50", headers=headers
    ).json()
    elapsed = time.monotonic() - started

    assert len(body["rows"]) == 50
    assert body["stream_counts"][SampleStream.PATIENT.value] == 49_990
    print(f"\npreview of 50,000 rows: {elapsed * 1000:.0f} ms, 50 rows returned")
    assert elapsed < 3.0
