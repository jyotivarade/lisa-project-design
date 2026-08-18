# LISA — Workflows, State Machine & Criteria Engine

Covers **B** (system workflow), **F** (criteria engine), **G** (state machine),
**K/L/M/N** (calibration, control, patient, file workflows).

---

## B. System workflow

```
 Upload CSV ──► store immutably (uuid key, sha256) ──► uploaded_files
      │                                                processing_sessions = UPLOADED
      ▼
 VALIDATING ─ file checks ─ streamed parse ─ classification ─ derivations
      │   empty rows: skip + warn        malformed rows: flag → exception report
      │   neither aborts the session (§5)
      ▼
 CALIBRATION_REVIEW ──► user reviews / selects / unselects / corrects
      │                 ──► POST validate-calibration
      │                     FAIL → CALIBRATION_FAILED ──┐ (revisable, loops back)
      ▼                                                 │
 CONTROL_REVIEW ──► user reviews / selects / corrects   │
      │            ──► POST validate-controls           │
      │                FAIL → CONTROL_FAILED ───────────┤
      ▼                                                 │
 READY ◄─────────────────────────────────────────────────┘  (only when both verdicts PASS)
      │
      │  POST /process  ── transactional gate (§36): lock · verify state ·
      │                    verify calibration verdict · verify control verdict ·
      │                    verify snapshot · transition · commit
      ▼
 PROCESSING_PATIENTS ──► one patient row at a time ──► criteria engine ──►
      │                  processing_results + rule_results (passes included)
      ▼
 Outputs ──► PASSED csv (original headers/order/values) + EXCEPTIONS csv
      ▼
 COMPLETED ──► history · audit · dashboard · downloads
```

Any failure inside patient processing ⇒ `PROCESSING_FAILED`, partial rows retained for
diagnosis, **no outputs published**. A rerun is always a new session (§20).

---

## G. Processing state machine

```
                       ┌────────────┐
                       │  UPLOADED  │
                       └─────┬──────┘
                             │ parse task starts
                       ┌─────▼──────┐   invalid CSV / unrecoverable
                       │ VALIDATING │──────────────────────────────┐
                       └─────┬──────┘                              │
                             │ parsed + classified                 │
                  ┌──────────▼─────────────┐                       │
        ┌────────►│  CALIBRATION_REVIEW    │                       │
        │         └──────────┬─────────────┘                       │
        │            validate│                                     │
        │              ┌─────┴─────┐                               │
        │            PASS         FAIL                             │
        │              │           │                               │
        │              │    ┌──────▼───────────────┐               │
        │              │    │ CALIBRATION_FAILED   │               │
        │              │    └──────┬───────────────┘               │
        │              │           │ re-select / correct / revalidate
        │              └───────────┴──────┐                        │
        │         ┌───────────────────────▼┐                       │
        ├────────►│   CONTROL_REVIEW       │                       │
        │         └──────────┬─────────────┘                       │
        │            validate│                                     │
        │              ┌─────┴─────┐                               │
        │            PASS         FAIL                             │
        │              │           │                               │
        │              │    ┌──────▼───────────┐                   │
        │              │    │ CONTROL_FAILED   │                   │
        │              │    └──────┬───────────┘                   │
        │              │           │ revalidate                    │
        │              └───────────┘                               │
        │         ┌────▼─────┐                                     │
        │         │  READY   │                                     │
        │         └────┬─────┘                                     │
        │              │ POST /process  ── THE ONLY LEGAL ENTRY    │
        │   ┌──────────▼──────────┐                                │
        │   │ PROCESSING_PATIENTS │────── engine/storage failure ──┤
        │   └──────────┬──────────┘                                │
        │              │ results + outputs written        ┌────────▼──────────┐
        │       ┌──────▼──────┐                           │ PROCESSING_FAILED │
        │       │  COMPLETED  │                           └───────────────────┘
        │       └─────────────┘
        │
        └── any selection change, correction, or configuration change on a non-terminal
            session resets the affected verdict to NOT_REVIEWED and returns the session
            to CALIBRATION_REVIEW / CONTROL_REVIEW.
```

Transition table — implemented once, in `services/state_machine.py`, as an explicit map.
Anything not listed raises `InvalidStateTransition` before any write:

| from | to | trigger |
|---|---|---|
| UPLOADED | VALIDATING | parse starts |
| VALIDATING | CALIBRATION_REVIEW | parse + classification succeeded |
| VALIDATING | PROCESSING_FAILED | invalid CSV (`error_code = INVALID_CSV`) |
| CALIBRATION_REVIEW | CALIBRATION_FAILED / CONTROL_REVIEW | validate-calibration FAIL / PASS |
| CALIBRATION_FAILED | CALIBRATION_REVIEW | user changes selection/correction |
| CONTROL_REVIEW | CONTROL_FAILED / READY | validate-controls FAIL / PASS |
| CONTROL_FAILED | CONTROL_REVIEW | user changes selection/correction |
| CONTROL_REVIEW · CONTROL_FAILED · READY | CALIBRATION_REVIEW | calibration selection/correction changed |
| READY | PROCESSING_PATIENTS | `POST /process` — **gate verified in-transaction** |
| PROCESSING_PATIENTS | COMPLETED / PROCESSING_FAILED | success / failure |
| COMPLETED · PROCESSING_FAILED | — | **terminal.** A rerun creates a new session |

### AD-2 — the gate, in three layers

| layer | behaviour |
|---|---|
| Frontend | `[Process Patient Records]` disabled; a `BlockedBanner` states *why* in words — e.g. "Patient processing is blocked because WCS2 failed control validation (%Diff 73.90, tolerance 25%)" (§34). **Not security.** |
| Service | `gate.assert_can_process(session)` raises `GateBlockedError(error_code)` before any state change |
| Transaction | `SELECT … FOR UPDATE` re-reads the session and re-checks state + both verdicts + snapshot presence *inside* the same transaction that transitions the state (§36) |

Error codes returned as **HTTP 409**: `CALIBRATION_FAILED`, `CONTROL_FAILED`,
`CALIBRATION_NOT_REVIEWED`, `CONTROL_NOT_REVIEWED`, `INVALID_STATE`.

`NOT_REVIEWED` matters: a verdict is only valid for the exact selection/correction/config set
it was computed from. Any change clears it, so the user cannot validate, then change a
calibrator, then process against a stale PASS.

---

## N. File processing workflow

1. **Accept** — extension allow-list, MIME sniff, size limit; rejected before anything is stored.
2. **Store** — streamed to `FileStorage` under a server-generated UUID key; SHA-256 computed
   during the stream. A matching hash within the analytics sets `is_duplicate` and warns —
   the file is still stored and still processable (§4). Nothing is ever deleted silently.
3. **Parse** (`processing/csv_parser.py`) — encoding ladder (UTF-8 → UTF-8-BOM → latin-1),
   delimiter sniff, header captured **verbatim and in order** (§5, §15).
4. **Row handling** — every row carries `source_row_number`:
   * completely empty → `SKIPPED`, warning logged, counted, **absent from the exception report**
   * malformed (field-count mismatch, bad quoting) → stored, `is_malformed`, routed to the exception report
   * otherwise → `raw` JSONB verbatim
5. **Value tokens** (§28) — `----`, blank → MISSING; `N.I. High` → OVER_RANGE;
   `N.I. Low` → UNDER_RANGE. **No silent coercion**: a token never becomes `0`, and every
   transformation is recorded on the row result.
6. **Column roles** — auto-matched by configurable patterns (`%Diff` ↔ `% Diff`), confidence
   ranked, user-overridable, persisted in the configuration version.
7. **Classification** — see below.
8. **Scope** — with `analyte_scope_policy = STRICT` (default), rows whose `Analyte Name` does
   not match `analytics.analyte_name` are `NOT_IN_SCOPE`: counted, listed, never processed (§29, D-13).
9. **Batch persist** — 1 000 rows per insert; memory stays O(chunk) (§32).

### Classification (§5) — Sample Type **and** Sample ID, never ID alone

Driven by ordered rules in the configuration; first match wins; the matching rule is recorded
on every row so the UI can answer "why is this a control?".

| priority | Sample ID | Sample Type | → stream |
|---|---|---|---|
| 10 | `^(BLANK\|Double Blank\|DBLK)$` | any | `OTHER` |
| 20 | `^Cal_\d+$` | `^Standard$` | `CALIBRATOR` |
| 30 | `^(WCS\|WSC)\d+$` | `^Control$` | `CONTROL` |
| 40 | `^UC$` | `^Control$` | `CONTROL` (role `DISCOVERED`, not required) |
| 50 | `^\d+$` | `^Unknown$` | `PATIENT` |
| 99 | any | any | `OTHER` |

`BLANK` and `Double Blank` are **never** patient rows regardless of their Sample Type (§5).

---

## K. Calibration workflow

```
parse ──► discover every CALIBRATOR row ──► calibrator_selections
                                            (is_selected = default from config)
   ▼
UI shows: Calibrator · Sample ID · Sample Type · %Diff · Ref Ratio · Found RT ·
          Std Conc · Conc · Selected · Value state · In range? · Validation · Reason
   ▼
user selects / unselects / corrects  ──► verdict reset to NOT_REVIEWED
   ▼
POST /validate-calibration
   1. effective value per row = latest active correction, else raw
   2. value_state per calibrator:
        numeric & non-zero            → VALID
        ratio = 0                     → per zero_ratio_policy (default EXCLUDE_FROM_RANGE)
        "----" / blank / non-numeric  → MISSING
        user-unselected               → UNSELECTED
   3. presence: every required_calibrator present? count of selected VALID ≥ minimum_required?
   4. accuracy: ABS(%Diff) ≤ tolerance_percent, for each selected calibrator
   5. derive ion-ratio limits and RT window from selected VALID calibrators only
   6. write calibrator_selections + calculation_traces + verdict + transition + audit
```

**§10's data hazard, handled explicitly:** a calibrator with `Ref 1 Actual Ratio = 0` is
excluded from the range by default and shown as `ZERO_EXCLUDED — not included in range`.
A zero is never allowed to silently become the low bound.

### Derived limits

**Ion-ratio (§10, formula = `SPAN`, the default):**
```
lowest      = min(selected VALID ratios)
highest     = max(selected VALID ratios)
range       = highest − lowest
adjustment  = range × adjustment_percent/100
lower_limit = lowest  − adjustment
upper_limit = highest + adjustment
```
Specification example — `40, 62, 10 %` → range `22` → adjustment `2.2` → **`37.8 … 64.2`** ✔
Real data (`Cocaine_2026_08_01`, 7/7 selected) — `25.31 … 33.91` → range `8.60` →
adjustment `0.86` → **`24.45 … 34.77`**.
Alternative `MULTIPLICATIVE`: `lowest × (1−adj) … highest × (1+adj)` — configurable, not default.

**Retention time (§11, mode = `PERCENTAGE`, the default):**
```
average = MEAN (or MEDIAN) of Found RT over selected VALID calibrators
lower   = average × (1 − adjustment_percent/100)
upper   = average × (1 + adjustment_percent/100)
```
Real data — average `4.3484`, ±20 % → **`3.4787 … 5.2181`**. `ABSOLUTE` mode gives
`average ± absolute_window_minutes`.

**Cut-off (§9):** `Std. Conc. (ng/mL)` of `WCS1` → `1.5` in the real files. `FIXED_VALUE` mode
available. If it cannot be resolved, the cut-off rule reports `NOT_EVALUATED` — never a pass.

**Calibrated range (§12):** `[min, max]` of selected calibrator `Std. Conc.` → `[1, 100]` real.

Every one of these is written to `calculation_traces` with formula, inputs, exclusions,
percentage, adjustment value and limits, and rendered in the UI (§10, §17).

### Calibration verdict
```
PASS ⟺ calibration disabled
     OR (every required calibrator present
         AND count(selected, VALID) ≥ minimum_required
         AND every selected calibrator passes ABS(%Diff) ≤ tolerance)
```

---

## L. Control workflow

Identical shape. Controls are discovered from the file; `required_controls` from
configuration decides which ones gate the run.

| role | source | affects verdict |
|---|---|---|
| `REQUIRED` | in `required_controls` | **yes** |
| `CUTOFF_SOURCE` | `concentration_cutoff.source_sample_id` (WCS1) | yes, and supplies the cut-off |
| `OPTIONAL` | in `discovered_optional` | no |
| `DISCOVERED` | present in the file, unknown to configuration (e.g. `UC`) | no — listed as `NOT EVALUATED`, never silently passed |

```
PASS ⟺ controls disabled
     OR (every required control present and selected
         AND count(selected required, passing) ≥ minimum_required
         AND every selected required control passes ABS(%Diff) ≤ tolerance)
```

Real consequence: run 02 fails on `WCS1 %Diff = 61.22`; run 03 on `WCS2 %Diff = 73.90`.
Runs 01 and 04 pass. `UC` (`%Diff = ----`) is `DISCOVERED / NOT EVALUATED` in all four —
neither a false failure nor a silent pass.

---

## F. Criteria engine architecture (AD-3 — pure)

```python
# app/criteria/models.py — plain dataclasses, no ORM, no I/O
@dataclass(frozen=True)
class RuleResult:
    rule_id: str; rule_name: str
    status: Literal["PASS", "FAIL", "SKIPPED"]
    error_code: str | None
    original_value: str | None
    calculated_value: str | None
    threshold: str | None
    lower_limit: Decimal | None
    upper_limit: Decimal | None
    message: str
    metadata: dict

@dataclass(frozen=True)
class RowEvaluation:
    row_number: int; sample_id: str; analyte: str
    final_result: Literal["PASSED", "FAILED"]
    original_concentration: Decimal | None
    adjusted_concentration: Decimal | None
    rules: tuple[RuleResult, ...]

# app/criteria/engine.py
class CriteriaEngine:
    VERSION = "1.0.0"                       # stamped on every session (§43)
    def evaluate(self, row: RowData, context: EvaluationContext,
                 rules: Sequence[RuleConfig]) -> RowEvaluation: ...
```

`EvaluationContext` is built **once per session** by `processing/context_builder.py` and is
immutable: config snapshot, column mappings, value tokens, derived limits (ion-ratio, RT,
cut-off, calibrated range, ISTD basis), and the selected calibrator/control sets. The engine
never asks for anything else.

### Rules (`app/criteria/rules/`)

| priority | rule_id | file | stream | error codes |
|---|---|---|---|---|
| 10 | `calibration_accuracy` | `calibration.py` | CALIBRATOR | `CALIBRATION_TOLERANCE_EXCEEDED` |
| 20 | `control_accuracy` | `control.py` | CONTROL | `CONTROL_TOLERANCE_EXCEEDED` |
| 30 | `istd` | `istd.py` | PATIENT | `ISTD_MISSING`, `ISTD_SUPPRESSED` |
| 40 | `concentration_cutoff` | `concentration.py` | PATIENT | `CONCENTRATION_BELOW_CUTOFF` |
| 50 | `ion_ratio` | `ion_ratio.py` | PATIENT | `ION_RATIO_OUT_OF_RANGE` |
| 60 | `retention_time` | `retention_time.py` | PATIENT | `RT_OUT_OF_RANGE` |
| 70 | `calibration_range` | `calibration_range.py` | PATIENT | `OVER_CALIBRATION_RANGE`, `UNDER_CALIBRATION_RANGE` |

Adding a rule = one class + one registry entry + one `rule_definitions` row. No change to
the engine, the API, or the frontend.

---

## M. Patient processing workflow (§13, §14)

```python
def evaluate(self, row, context, rules) -> RowEvaluation:
    results = []
    conc = context.numeric(row, "concentration")
    original, adjusted = conc, conc
    for cfg in sorted(rules, key=lambda r: r.priority):
        if not cfg.enabled or cfg.stream != row.stream:
            continue
        try:
            res = REGISTRY[cfg.rule_id].evaluate(row, cfg, context)
        except Exception as exc:                  # one row never stops the run (§5)
            res = RuleResult.engine_error(cfg, exc)
        results.append(res)
        if res.status == "FAIL" and cfg.zero_concentration_on_fail:
            adjusted = Decimal(0)
    failed_mandatory = [r for r, c in zip(results, rules) if r.status == "FAIL" and c.mandatory]
    return RowEvaluation(
        final_result="FAILED" if failed_mandatory else "PASSED",
        original_concentration=original, adjusted_concentration=adjusted,
        rules=tuple(results), ...)
```

Guarantees:

* **Every enabled applicable rule runs.** No short-circuit on first failure — §13 requires all
  failures for the row.
* **`PASSED` only if every enabled mandatory rule passes** (§14).
* **One row's failure never stops the session** (§5). An exception inside a rule becomes a
  `FAIL` on that row with the message; the run continues.
* **A row against which nothing could be evaluated is `FAILED` with `NOT_EVALUABLE`**, never
  `PASSED`. A file the rules cannot read reports zero passes and says so — an unverified row
  must never be indistinguishable from a verified one.
* **The original concentration is never overwritten**: `original_concentration` and
  `adjusted_concentration` are separate columns, with `cutoff_value` and the rule that acted (§9).

Worked example from §13:
```
2606251021 · ISTD PASS · Cutoff FAIL · Ion Ratio PASS · RT PASS · Cal Range PASS
→ FAILED, failure_codes = {CONCENTRATION_BELOW_CUTOFF}
→ original 0.6582 · adjusted 0 · cutoff 1.5
```

---

## Output generation (§15)

**PASSED file** — original header names, original order, values exactly as uploaded, only
rows whose `final_result = PASSED`. Because a below-cut-off row **fails**, no adjusted value
ever appears here: the passed file is a faithful subset of the source (D-11).

**EXCEPTIONS report** — one row per failed patient row:
`session_number · source_row_number · sample_id · analyte · final_result · failed_rules ·
error_codes · error_descriptions · original_value · calculated_value · threshold ·
original_concentration · adjusted_concentration` followed by the complete original row.

Both pass through the CSV-injection guard (a cell starting `= + - @` is prefixed with `'`),
are stored with a SHA-256, and are served from storage on download — never regenerated, so a
file downloaded a year later is byte-identical to the day it was produced.

---

## Error handling (§25)

Every error surfaces as `{"error_code": …, "message": …, "details": [...]}`; no Python
exception text ever reaches a client.

| condition | error_code | HTTP |
|---|---|---|
| Unparseable / wrong type / too large | `INVALID_CSV`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE` | 400 / 413 |
| Required column role unmapped | `MISSING_COLUMN` | 422 |
| Duplicate hash | `DUPLICATE_FILE` (warning, upload still succeeds) | 200 |
| Malformed row | per-row `MALFORMED_ROW`, routed to exceptions | — |
| Missing calibrator / control | `MISSING_CALIBRATOR`, `MISSING_CONTROL` | 422 on validate |
| Invalid configuration | `INVALID_CONFIGURATION` + per-field details | 422 |
| Gate violation | `CALIBRATION_FAILED`, `CONTROL_FAILED`, `CALIBRATION_NOT_REVIEWED`, `CONTROL_NOT_REVIEWED`, `INVALID_STATE` | **409** |
| Correction not permitted | `CORRECTION_NOT_ALLOWED` | 403 |
| Storage / generation failure | `FILE_GENERATION_FAILED` | 500 |
| Database failure | `INTERNAL_ERROR` (details logged with `request_id`) | 500 |

### Configuration validation (§18, before every process)
Adjustment percentages ≥ 0 and within registry bounds · tolerances numeric and > 0 ·
`minimum_required` ≤ len(required list) · cut-off source present among the controls ·
every enabled rule has a mapped column or is explicitly marked not-evaluable ·
priorities unique. A failure returns `INVALID_CONFIGURATION` and processing refuses to start.
