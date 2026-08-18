# LISA — P. Testing Strategy

Gates in CI: `app/criteria/` ≥ **95 %**, `app/services/` + `app/processing/` ≥ 85 %, backend
overall ≥ 85 %. Fixtures live in `backend/app/tests/fixtures/` and are **test-only** (§27).

---

## 1. Criteria-engine unit tests (pure, no database)

Constructed `RowData` + `EvaluationContext` objects only. Per rule, at minimum:

| case | why |
|---|---|
| clear pass / clear fail | baseline |
| **exactly at the threshold** | inclusive vs exclusive is configuration and must be proven |
| one step either side | `Decimal` boundary correctness |
| `----` | must be MISSING, never `0` (§28) |
| blank | must not be a silent pass |
| `N.I. High` / `N.I. Low` | over/under-range codes |
| non-numeric junk | fails with the raw token preserved in `original_value` |
| negative `%Diff` (`-11.46`, real) | absolute-value handling |
| threshold changed in the snapshot | the value genuinely comes from configuration |
| rule disabled / non-mandatory | contributes nothing / fails without failing the row |

Rule-specific:

* **calibration_accuracy** — `-0.22` PASS; `27.87` FAIL at 25 %, PASS at 30 % (real, run 02).
* **control_accuracy** — `61.22`, `73.90` FAIL (real); `UC` with `----` → `SKIPPED`, not required.
* **istd** — `ISTD_MISSING` on `----`/absent peak; suppression via recovery columns; via batch
  mean; via calibrator mean; the basis used is reported in `metadata`.
* **concentration_cutoff** — `0.6582 < 1.5` → FAIL, `CONCENTRATION_BELOW_CUTOFF`, original
  preserved, adjusted `0`; exactly `1.5`; cut-off unresolvable → SKIPPED, never PASS.
* **ion_ratio** — the specification example `40 / 62 / 10 %` → **`37.8 … 64.2`** asserted
  numerically; real run-01 `25.31 / 33.91` → `24.45 … 34.77`; `MULTIPLICATIVE` asserted
  separately; **all three `zero_ratio_policy` values** proven to change the range as documented.
* **retention_time** — real average `4.3484`, ±20 % → `3.4787 … 5.2181`; `5.662` FAILs;
  `ABSOLUTE` mode; `MEDIAN` method.
* **calibration_range** — inside; above top calibrator → `OVER_CALIBRATION_RANGE`; below →
  `UNDER_CALIBRATION_RANGE`; both `over/under_range_action` values.

Engine level: priority ordering; **all** failures collected, no short-circuit; multi-rule
failure records every code; an injected exception fails only that row; a row nothing could be
evaluated against is `FAILED / NOT_EVALUABLE`, never `PASSED`; `evaluate()` is deterministic
across 1 000 repetitions.

**Purity test:** an import-lint test asserts nothing under `app/criteria/` imports `fastapi`,
`sqlalchemy`, `app.models`, `app.repositories`, `app.storage` or `httpx` (AD-3).

---

## 2. Integration tests (real PostgreSQL, real fixtures)

| test | assertion |
|---|---|
| Upload | stored once, hash recorded, bytes identical to input, session `UPLOADED` |
| Duplicate | second upload of the same bytes → `is_duplicate`, **file retained**, still processable |
| Parse | run 01 → 7 calibrators / 3 required controls + `UC` / 118 patients / 0 empty |
| Classification | `BLANK`, `Double Blank` → `OTHER`, absent from patient results |
| Calibration validation | run 01 PASS; run 02 FAIL naming `Cal_4` with actual and threshold |
| Control validation | run 02 FAIL `WCS1`; run 03 FAIL `WCS2`; runs 01/04 PASS |
| **THE GATE (§26, mandatory)** | `POST /api/processing/{id}/process` on runs 02 and 03 → **409** with `CALIBRATION_FAILED` / `CONTROL_FAILED`, and `processing_results` count stays **0**. Repeated at the service layer and with a concurrent double-submit under `FOR UPDATE`. |
| Not-reviewed gate | validate → change a selection → process → **409 `CALIBRATION_NOT_REVIEWED`** |
| Selection loop | unselecting a calibrator returns the session to `CALIBRATION_REVIEW` and changes the derived limits exactly as the trace states |
| Corrections | original preserved; reason required; audited; verdict reset; a correction that fixes `Cal_4` makes run 02 pass — and the uploaded file is byte-identical afterwards |
| Patient processing | run 01 evaluates all 118 rows; `rule_results` include passes |
| Passed file | original header names, order and values; row count = PASSED count |
| Exception report | one row per failure with codes, values, thresholds and the original row |
| CSV injection | `=HYPERLINK(...)` written as `'=HYPERLINK(...)` |
| Rerun | new session, `parent_session_id` set, fresh snapshot; **parent's results, counters and files unchanged** |
| **Historical immutability (§35)** | process at 25 % → change to 10 % → old session still shows 25 % and identical results; only a rerun applies the new value |
| **Replay (§43)** | rebuild from file + selections + controls + corrections + snapshot + engine version → results identical to stored |
| Configuration validation | negative adjustment, `minimum_required` > list length, non-numeric tolerance → `422 INVALID_CONFIGURATION`, processing refused |
| Malformed input | short row, unterminated quote, missing Sample Type, duplicate `Cal_3` → each handled per §5, session still completes |
| Dashboard | empty DB → zeros + `has_data: false`; after run 01 → aggregates equal direct counts |
| Multi-analyte | a two-analyte file under `STRICT` → out-of-scope rows counted, never processed |
| AuthZ | every mutating endpoint × ADMIN/ANALYST/VIEWER, expected allow/deny |
| Audit | every mutating endpoint writes exactly one row; a rolled-back mutation writes none |

---

## 3. Frontend tests

**Vitest + RTL + MSW** — GateCard renders BLOCKED with the reason text and keeps the button
disabled; calibration selection recomputes the displayed range; configuration forms reject
out-of-range values using catalogue bounds; ResultDetailDrawer shows PASS and FAIL lines with
actual vs allowed; CorrectionDialog requires a reason; DataTable sort/filter/paginate;
FileDropzone rejects type and size; `usePermission` hides forbidden actions.

**Playwright e2e** — (a) login → create analytics → configure → upload run 01 → preview →
calibration → controls → READY → process → results → download both files; (b) the blocked
journey: upload run 02 → BLOCKED with the WCS1 reason → button disabled → **direct API call
rejected with 409** → correct or reconfigure → revalidate → process.

---

## 4. Performance & resilience
500 000-row file parses and processes within the memory budget (peak RSS asserted);
throughput assertion per worker; concurrent uploads to one analytics do not interleave
sessions; a worker killed mid-run leaves `PROCESSING_FAILED`, partial rows retained and **no**
published outputs.

## 5. CI
ruff · mypy (strict on `app/criteria`) · eslint · tsc · backend unit → integration → coverage
gate · frontend unit → build → Playwright against the composed stack · dependency and secret
scan. Golden-file tests fail loudly on any output-byte change: the output format is a contract,
and a silent change to it is a regression even when it looks like an improvement.
