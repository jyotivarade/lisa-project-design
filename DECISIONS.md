# LISA — Decision Log (R & S)

**R** = unresolved business decisions · **S** = recommended defaults.
Nothing here was resolved silently. Every item is implemented as configuration with a
documented default; the ones marked **OPEN** need a laboratory answer before clinical use,
but none of them blocks Phase 1.

`RESOLVED` — settled by the specification · `OPEN` — needs a lab answer · `BLOCKING` — needs
an input before the relevant phase can complete.

---

## Settled by the specification (recorded for traceability)

| id | decision | default | configurable as |
|---|---|---|---|
| **D-01** | **Ion-ratio formula** — span-based, per §10's worked example (`40, 62, 10 %` → `37.8 … 64.2`). The existing prototype uses a multiplicative form giving `36.0 … 68.2`; the specification wins and the prototype's reading is retained as an option. | `SPAN` | `ion_ratio.formula` ∈ `SPAN` \| `MULTIPLICATIVE` |
| **D-02** | Ion-ratio adjustment percentage (source material states 10 %, 25 % and 30 % in different places) | **10 %** | `ion_ratio.adjustment_percent` |
| **D-03** | Calibration tolerance | **25 %**, operator `lte` (exactly 25.00 passes) | `calibration.tolerance_percent`, `.tolerance_operator` |
| **D-04** | Control tolerance | **25 %**, operator `lte` | `controls.tolerance_percent` |
| **D-06** | RT adjustment and mode | **20 %**, `PERCENTAGE`, average `MEAN` | `retention_time.*` |
| **D-07** | Zero ion-ratio policy | **`EXCLUDE_FROM_RANGE`** | `ion_ratio.zero_ratio_policy` ∈ `VALID` \| `INVALID` \| `EXCLUDE_FROM_RANGE` |
| **D-08** | Required calibrators | `Cal_1 … Cal_7`, `minimum_required = 7` | `calibration.required_calibrators`, `.minimum_required` |
| **D-10** | Concentration cut-off | `WCS1` `Std. Conc. (ng/mL)` (= 1.5 in the real files); below cut-off ⇒ **row FAILS** with `CONCENTRATION_BELOW_CUTOFF`, original preserved, adjusted `0` (§9 + §13) | `concentration_cutoff.*`, rule `mandatory` |
| **D-11** | PASSED-file values | Original headers, order and values, verbatim. Because a below-cut-off row fails, no adjusted value can reach the passed file — it is a faithful subset of the source. | `output.*` |

### Note on D-06 (not a conflict, but worth stating)
±20 % on a real average of `4.3484 min` is `3.4787 … 5.2181` — roughly ±52 seconds, wide for
LC-MS/MS, where ±2–5 % or an absolute ±0.05–0.15 min is typical. It is not inert: the real
patient rows at `5.660`/`5.662 min` do fail it. Implemented as specified, with `ABSOLUTE` mode
available and the computed window always displayed in minutes so its width is visible rather
than implied. **Worth confirming ±20 % is not a transcription of ±2.0 %.**

---

## R. Unresolved decisions

### D-05 — ISTD suppression basis and direction · **OPEN**
§8 specifies `% Recovery` and `Average % Recovery`. **No real instrument export in this
repository contains either column** — only `ISTD Area`. Additionally, a literal reading of
"suppression > 90 % = FAIL" would fail a sample only once recovery had fallen below 10 %.

**S — recommended default:** `basis_method = AUTO` → use the recovery columns when both map,
otherwise `(row ISTD Area ÷ mean ISTD Area of the run) × 100`. Rule: **below 90 % of the basis
fails** (`ISTD_SUPPRESSED`). Missing/`----` peak fails as `ISTD_MISSING`. Every result records
which basis produced it.
**Needed from the lab:** the intended direction, and whether the batch mean should span
patient rows only or all streams.

### D-09 — `UC` and other discovered controls · **OPEN (low risk)**
Real files carry `UC` with `Sample Type = Control` and `%Diff = ----`. Making it required
fails every run; making it a patient row would be a safety defect.
**S:** controls carry a role — `REQUIRED` (WCS1–3), `CUTOFF_SOURCE` (WCS1), `OPTIONAL`,
`DISCOVERED`. `UC` is `DISCOVERED`: shown in the control table as *NOT EVALUATED*, excluded
from the verdict, never hidden.

### D-12 — `N.I. Low` and below-range results · **OPEN**
§28 requires the token to be handled; no rule is specified for it, and §12 names only the
high side.
**S:** treat as `UNDER_CALIBRATION_RANGE` in the `calibration_range` rule, default action
`FAIL`, configurable to flag-only, symmetrical with `N.I. High` → `OVER_CALIBRATION_RANGE`
(`FAIL`, per §12). The same code and action apply to a **numeric** result below the lowest
calibrator, since it is equally extrapolated.

**Consequence, visible on real data:** a result below the cut-off is usually also below the
lowest calibrator, so such a row reports **two** failures — `CONCENTRATION_BELOW_CUTOFF` and
`UNDER_CALIBRATION_RANGE`. Both are true of the row and §13 asks for every applicable
failure, so they are not collapsed. On `Cocaine_2026_08_01` that is 26 cut-off failures and
17 under-range failures across 118 patient rows. A reported **zero** is exempt: it is a
negative result the cut-off rule has already decided, not a range excursion.
**Needed from the lab:** confirm that reporting both is wanted, or that under-range should be
flag-only when the cut-off has already failed the row.

### D-13 — Multi-analyte files · **OPEN**
§29 requires support for files containing several analytes, while an Analytics has one
`analyte_name` and its own configuration.
**S:** `analyte_scope_policy = STRICT` — a session processes only rows whose `Analyte Name`
matches the Analytics' analyte; other rows are `NOT_IN_SCOPE`, counted and listed but never
processed. Processing the same file under a second Analytics creates a second, independent
session. `ALL` is available for single-analyte files with an inconsistent name column.
**Needed from the lab:** whether one file should fan out to every matching Analytics
automatically, or stay an explicit per-Analytics action (default: explicit).

### D-14 — Scope of corrections · **OPEN — safety-relevant**
§19 permits correcting calibration/control values "where business rules permit" but does not
bound them. Unbounded correction of patient measurements would let a user manufacture a
passing run.
**S:** corrections are restricted by configuration to **calibrator and control rows only**;
patient-row corrections are **disabled by default**; a reason is mandatory; the original value,
the new value, the actor and the timestamp are stored permanently; every correction is audited
and **resets the affected verdict to `NOT_REVIEWED`** so the run must be revalidated. Enabling
patient corrections is an explicit ADMIN configuration change, itself audited.
**Needed from the lab:** confirmation that patient values must never be correctable.

### D-15 — Rerun: carry selections forward or start clean? · **OPEN (low risk)**
§20 says a rerun gets its own selections and corrections but not whether they are copied.
**S:** `POST /rerun {carry_forward_selections: true}` — default **copy** (so a rerun isolates
the effect of a configuration change), with `false` for a clean re-review. Either way the new
session gets a fresh snapshot and the parent is untouched.

### D-17 — Which rule failures zero the concentration · **OPEN**
The approved specification zeroes the concentration in exactly one place: §9, the cut-off
(`Conc = 0` with the original preserved). The **earlier** version of the specification also
zeroed it on an ion-ratio failure; §10 of the approved version does not.

**S:** implemented per the approved specification — only `concentration_cutoff` zeroes, via
its existing `zero_on_fail` parameter (default `true`). An ion-ratio or retention-time
failure fails the row and reports the measured concentration unchanged, which is what the
exception report needs in order to show what was actually observed.

Making this configurable per rule is a one-line addition to each rule's parameter schema in
`app/core/rule_catalog.py`. It was **not** added pre-emptively because the configuration
validator requires an exact parameter match, so introducing a parameter invalidates every
configuration version already stored.
**Needed from the lab:** confirm that only the cut-off should zero, or name the other rules
that should.

### D-16 — A row nothing could be evaluated against · **RESOLVED (stated for the record)**
**S:** `FAILED` with `NOT_EVALUABLE`, never `PASSED`, and never written to the passed file.
A file whose columns the rules cannot read reports zero passes and says so. An unverified row
must never be indistinguishable from a verified one.

---

## B. Blocking inputs

### B-1 — Mitragynine and Temazepam fixtures are not in this repository · **BLOCKING Phase 11**
§27 asks for those structures as behavioural fixtures. What exists here is
`Cocaine_2026_08_0{1..4}.csv` (real LC-MS/MS exports, currently deleted in the working tree
but recoverable from git) plus three generic QC exports. The Cocaine files are structurally
ideal — they contain a genuine calibration failure (`Cal_4 %Diff 27.87`) and two genuine
control failures (`WCS1 61.22`, `WCS2 73.90`) — and the parser is layout-agnostic, so
development is not blocked. **Please supply the Mitragynine and Temazepam CSVs** so the
Phase 11 suites can assert against the layouts actually named in the specification.

### B-2 — Values requiring laboratory sign-off before clinical use
D-01/D-02 (ion-ratio formula and percentage), D-03/D-04 (tolerances), D-05 (ISTD basis and
direction), D-06 (RT window width), D-12 (`N.I. Low` and below-range), D-17 (which failures
zero the concentration). All are configurable and all are
displayed with their formula, inputs and configured percentage — but a default is still a
decision, and these ones belong to the laboratory, not to the software.
