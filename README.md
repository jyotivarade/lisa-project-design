# LISA — Laboratory Information System Analysis (Frontend Prototype)

A fully interactive, clickable prototype of a laboratory **analyte validation and CSV processing
platform**, built with **HTML5 + CSS3 + vanilla JavaScript only** — no React, Angular, Vue or any
framework, and no build step, bundler or dependency install.

## Run it

Open `index.html` in a browser. That's it.

```
open index.html          # macOS
```

Prototype credentials:

```
Email:    admin@analytics.com
Password: Admin@123
```

## LISA workflow (per analyte)

An analyte (e.g. **Cocaine**, code `COC`) owns many run files, its own configuration and its own
criteria. Inside an analyte the workflow is an 11-step stepper:

```
Upload Files → Analytics → Sample Types → Sample Selection → Criteria → Fields
             → Rules → QC Validation → Approval → Patient Testing → Results
```

* **Analyte Configuration** (`Analyte Configuration` button on any analyte screen) — analyte name/code,
  assay, matrix, **Reference Ratio Adjustment %**, and cut-off configuration (dynamic from the `WCS1`
  control row, or a fixed value). Stored per analyte — every analyte carries its own values, and a table
  on the screen shows them side by side. Saving bumps the **criteria version** and marks processed files
  for re-processing.
* **Multiple files per analyte** — `Cocaine_2026_08_01.csv … _08_04.csv` all belong to the same analyte
  and are processed together. Each file keeps its own metadata and processing state; click a file to open
  **File Details**: file ID, analyte, assay, upload time, uploaded by, size, rows, columns, processing
  status, validation status, criteria version, processing start/completion time, passed/failed/warning
  counts, per-criterion breakdown, the values derived for that run, and the outputs.
* **Sample classification** — LISA definitions out of the box: calibrators `Cal_1…Cal_7` /
  Sample Type `Standard`; controls `WSC_*` / `WCS*` / `UC` / Sample Type `Control`; patients numeric
  Sample ID / Sample Type `Unknown`. Patterns and Sample-Type values are editable per stream (`ID AND
  Type` or `ID OR Type`), and blanks/double-blanks stay deliberately unmatched.
* **Criteria Module** — the seven criteria, each with sample stream, mapped column, operator, threshold,
  calculation and enable/disable, plus `Column Mapping`, `Test Criteria` (dry run) and
  `Execute Processing` (row-by-row over every file):

  | Criterion | Stream | Reads | Default |
  |---|---|---|---|
  | Check Calibrator Accuracy | Standard | `% Diff` | > 25 % → fail |
  | Check Control Accuracy | Control | `% Diff` | > 25 % → fail |
  | Check Internal Standard Errors | Unknown | `ISTD Area`, `% Recovery` | missing peak · recovery ratio < 90 % |
  | Remove Concentrations Below Cut-off | Unknown | `Conc. (ng/mL)` | < cut-off → **value replaced with 0** |
  | Check Ion Ratio | Unknown | `Ref 1 Actual Ratio` | outside calibrator range ± Reference Ratio Adjustment |
  | Check Retention Time | Unknown | `Found RT` | outside calibrator average ± 20 % |
  | Check Calibration Range | Unknown | `Conc. (ng/mL)` | outside lowest–highest calibrator → warning |

  Criteria form a **pipeline** — a later criterion sees what an earlier one rewrote, so a result zeroed
  by the cut-off is not then flagged as below-range.
* **Derived values** are computed from the run itself and shown on screen with their provenance: cut-off
  (Std. Conc. of the cut-off control), ion-ratio range (lowest/highest calibrator ratio widened by the
  analyte's adjustment, zero ratios excluded by default), RT window, calibrated measuring range.
* **Outputs per file** — `Download Passed File` (rows that passed, with the criteria adjustments applied
  plus `LISA Status` / `LISA Adjustments`) and `Download Exceptions Report` (one row per failed criterion
  with analyte, assay, stream, source file, criterion, failed column, reason, severity, criteria version
  and processing time). The passed file is **held** while any calibrator/control criterion fails or a run
  is stale; the exceptions report is always available.

## The core business rule

The **uploaded files** contain control, calibration and patient records together — there is never a
separate control, calibration or patient upload. Control and calibration are validated **together** from
that data, and **patient testing stays locked** until every required control and calibration record
passes *and* the configuration is approved. A single failing QC record keeps the lock in place until the
rule or the data is corrected and re-tested; patient records are then tested with the approved rules,
straight from the same files.

Changing a file, the analytics scope, the sample classification, the selected fields, a rule or its group
logic creates a **new configuration version**, invalidates the approval and **re-locks patient testing**.

## Click-through journey

Everything before the Analytics screen (login, dashboard, sidebar, header, analytics list/cards) is the
original build. The enhanced flow lives entirely **inside** an analytic — a 9-step workflow:

1. **Sign in** → Dashboard
2. **Analytics** → open an analytic, or `+ Create Analytics`
3. **Upload Files** — drag & drop **one or many** CSV files (real parsing), add more later, remove
   individually, or load a generated demo file. All files feed the *same* workflow.
4. **Analytics** — the files are scanned for the analytics they contain (file → analytics tree) and you
   pick which analytics this workflow validates. Records of other analytics are excluded from every run.
5. **Sample Types** — pick any column as the sample-type field and map its values to
   control / calibration / patient (a mapping is *suggested* from the data, never hardcoded)
6. **Sample Selection** — detection only *proposes* the split; here you confirm it record by record.
   A searchable, filterable table of every in-scope row lets you tick any row into the calibration or
   control set — `Cal_1…Cal_n` and `WCS1…WCS3` are whatever this file happened to contain, never a rule.
   Patient records are never picked by hand: whatever is left over *is* the patient set. The same screen
   carries **Test Calibration** / **Test Controls**, which show Sample ID · Field · Actual · Minimum ·
   Maximum · Failed Rule · Reason for every failing record, and the patient-testing lock panel.
   Changing a selection bumps the criteria version and re-locks patient testing.
7. **Fields** — choose which detected fields take part in validation, with per-sample-type population
   coverage shown for each field. Rules on unselected fields are kept but skipped.
8. **Rules** — build rules for any selected field; or `Suggest from data` to derive a starter set from
   the data's own statistics; `Test Rules` runs them over all in-scope records
9. **QC Validation** — one run covering control **and** calibration together; the demo data
   deliberately contains QC drift so the run fails
10. **Correct** — a drawer offers *Edit Rule* or *Correct Data* (+ reason) and shows the source file of
   the failing row, then **Save & Re-test** (no need to restart the workflow)
11. **Approval** — checklist over files / analytics / fields / rules / QC, then sign-off → patient
    testing unlocks
12. **Patient Testing** — runs the patient records from the *same* uploaded files with a live progress
    simulation
13. **Results** — PASS / FAIL / WARNING with search, filter, sort, pagination, per-analytics breakdown,
    a per-sample detail drawer, and **Download Failed Records** (there is deliberately no passed-records
    file)
14. **Validation History** / **Audit Logs** — versions, QC outcomes, and every change with before/after
    values and reasons

### Failed records only

Validation never produces a `Pass` file. Passed records stay part of the uploaded dataset; only the
failing (and warning) records are extracted, one row per rule failure, carrying:

`…every selected original field…` + `Analytics` + `Sample Type` + `Source File` + `Failed Field` +
`Failed Rule` + `Failure Reason` + `Severity` + `Validation Timestamp`

Available as **Download Failed Records** on the QC validation screen and **Download Failed Patient
Records** on the results screen (plus a preview drawer from the locked-state panel).

### Multiple files, multiple analytics

* Files may differ in shape — columns are unioned, and each record remembers its source file.
* A file may hold several analytics, either as a column value **or** as repeated header blocks in one
  sheet (`Name, Mitragynine` … `Name, Temazepam`), which the parser splits and promotes to a real
  column.
* Rules are scoped to the selected analytics, so a rule configured for one analytic can never touch
  another analytic's records.
* Instrument "no result" tokens (`----`, `N.I.(High)`, `N/A`, …) are treated as missing everywhere, so
  numeric columns are still detected as numeric. The token list is editable in
  *Settings → Validation policy*.

To see the failure→correction→re-test path from scratch, open **Renal Function Panel** (rules ready, QC
not yet run) or **Lipid Profile** (already failing). **Complete Blood Count** and **Vitamin D** are
empty drafts for the full upload-first journey.

## Everything is dynamic

Nothing about a file is assumed. Field names, field count, data types, control levels, thresholds,
sample-type values and rule parameters all come from the uploaded data or from user configuration:

- **Field discovery** — columns are read from the file; data types (`text` / `number` / `date` /
  `boolean`) are inferred from value distributions (`U.describeFields`, `U.inferType`).
- **Sample classification** — any column can be the discriminator; its distinct values populate the
  mapping dropdowns. Suggestions come from structural analysis (which groups are populated where) plus
  lexical hints, and are always user-editable.
- **Rule catalogue** — each rule type declares its own parameter schema, so the rule builder renders
  itself for any field. Available rule types are filtered by the field's inferred data type.
- **Derived limits** — `Suggest from data` computes numeric limits from the file's own population
  statistics (mean ± 2 SD warn / ± 3 SD fail), allowed value lists from observed distinct values, and a
  recovery limit against a *detected* target field (populated for QC material, blank for patients).

## Rule engine

| Data type | Rule types |
|---|---|
| Text | Required, Equals, Not Equals, Contains, Starts With, Ends With, In List, Regex, Length, Custom Expression |
| Number | Required, Equals, Not Equals, Greater Than, Less Than, Between, Outside Range, Percentage Difference, Expected Value Comparison, Decimal Precision, Custom Formula |
| Date | Required, Valid Date, Before, After, Between, Not Future, Custom Expression |
| Boolean | Required, Must be TRUE, Must be FALSE |

Per rule: **severity** (Error blocks approval / Warning flags only), **Apply To** scope
(control / calibration / patient / all), enable-disable, duplicate, delete, drag-to-reorder, and an
optional **IF / THEN** condition on any other field. Per field: **ALL** or **ANY** group logic.

**Custom formulas** are parsed by a restricted recursive-descent evaluator (`expr.js`) supporting
`[Field Name]` references, `+ - * / % ^`, parentheses and a fixed function set
(`abs round floor ceil sqrt min max pow avg`). `eval` and `new Function` are never used, so arbitrary
JavaScript cannot execute; syntax and unknown-field errors surface in the builder via *Validate Formula*.

## Project layout

```
index.html                  app shell: login, sidebar, header, modal/drawer/toast roots
assets/css/styles.css       design tokens + all component styles (light, responsive, print)
assets/js/util.js           DOM helpers, formatters, icons, CSV parse/serialise, type inference
assets/js/expr.js           safe expression compiler/evaluator for custom formula rules
assets/js/rules.js          rule catalogue (schemas + evaluators) and the validation engine
assets/js/seed.js           demo catalogue, deterministic data generator, suggestion engines
assets/js/store.js          state, analytic lifecycle, state machine, versioning, audit, persistence
assets/js/ui.js             toasts, modals, drawers, confirm/reason dialogs, badges, data table
assets/js/screens-core.js   dashboard, analytics list, create analytic, overview, workflow shell
assets/js/screens-workflow.js   multi-file upload, preview, analytics detection, classification,
                            field selection, rule config, rule builder, rule test
assets/js/screens-validation.js QC validation, correction drawer, re-test, approval, history
assets/js/screens-patient.js    patient lock/unlock, progress run, results, result detail
assets/js/screens-admin.js      rules engine, QC index, patient index, history, reports, audit, settings
assets/js/app.js            bootstrap, auth, hash router, sidebar/header chrome
sample-data/*.csv           realistic sample files (analyte column + controls + calibrators + patients
                            in one file; the lipid file carries three analytes)
```

## State machine

```
DRAFT → FILES_UPLOADED → ANALYTICS_SELECTED → CLASSIFIED → FIELDS_SELECTED → RULES_CONFIGURED
      → VALIDATING_CONTROL_CALIBRATION
          ├── VALIDATION_FAILED → (correct rule or data) → re-test ─┐
          └── VALIDATION_PASSED → APPROVAL ──────────────────────────┴→ PATIENT_TESTING_UNLOCKED
                                                                        → PATIENT_TESTING → RESULTS
```

`Store.stateOf(analytic)` derives the state from data (never a stored flag), and `Store.stepStates()`
maps it to the 9-step stepper (`done` / `current` / `pending` / `failed` / `locked`).

Any of these changes invalidates an approval, creates a new configuration version and re-locks patient
testing: adding/removing a **file**, changing the **analytics scope**, changing the **sample
classification**, changing the **selected fields**, or adding/editing/deleting/reordering/disabling a
**rule** (including group logic).

## Backend readiness

State mutations are funnelled through `Store` (`attachFile`, `applyClassification`, `addRule`,
`updateRule`, `runQCValidation`, `approve`, `correctData`, `runPatientTesting`, …), so each one maps
cleanly onto a REST endpoint without touching screen code. Screens read from `Store` and re-render;
they never hold their own copy of domain state. `Rules.runSet` / `Rules.evalRecord` are pure functions
over `(records, scope, rules)` and can be replaced by server-side validation with the same result shape.

## Prototype boundaries

- **XLSX/XLS**: CSV is parsed for real. Binary spreadsheets need a reader library or a server, so the
  prototype clearly flags it and substitutes an equivalent generated dataset to keep the workflow
  exercisable end to end.
- **Persistence**: state lives in `localStorage` (key `analytix.state.v1`). Bulk record sets are not
  persisted — demo files regenerate deterministically; files you upload yourself stay in memory for the
  session (after a reload the workflow asks for them again). Reset everything under
  *Settings → Prototype data*.
- **Progress runs**: validation and patient testing animate a batch run; the pass/fail outcome itself is
  computed by the real rule engine, not faked.
