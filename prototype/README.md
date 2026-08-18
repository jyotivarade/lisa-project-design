# LISA — Laboratory Information System Analysis (Frontend Prototype)

A clickable prototype of the **Analytics** section of LISA: upload an Excel file, get analytics back,
and keep every upload and its analytics for as long as you need them.

Built with **HTML5 + CSS3 + vanilla JavaScript only** — no framework, no build step, no dependency
install.

## Run it

Open `index.html` in a browser.

```
open index.html          # macOS
```

Prototype credentials:

```
Email:    admin@analytics.com
Password: Admin@123
```

## The flow

There is one flow, and it is the whole application:

```
Analytics → Upload Excel File → Process File → Generate Analytics
          → Save Upload History → View Previous Uploads / Analytics
```

1. **Analytics** — a list of analytics (HbA1c, Cocaine, …). Each one is a folder that holds uploads.
2. **Upload Excel File** — drag a file onto the drop zone, or use `Upload Excel File`. Available on
   the analytic screen and on every analytics card. Multiple files at once are fine, and there is no
   limit on how many you upload.
3. **Process File** — the file is parsed and processed the moment it arrives. Nothing to configure,
   no step to advance, no approval to obtain.
4. **Generate Analytics** — one report per upload (see below).
5. **Save Upload History** — the upload joins the analytic's history with its file name, date and
   time, user, status and the analytics it produced.
6. **View Previous Uploads / Analytics** — the history table lists every upload ever made; click any
   row to reopen the report generated from it, however old.

**Each upload is independent.** Uploading a new file never re-processes, re-scores or invalidates an
earlier one. Upload #7's report is the same tomorrow as it was the day it was created.

## What is tracked per upload

| Tracked | Where it comes from |
|---|---|
| Upload number | Sequential within the analytic — `#1`, `#2`, … |
| File name | The uploaded file, kept verbatim |
| Upload date & time | When it arrived |
| Uploaded by | The signed-in user |
| Upload status | `Completed` · `Exceptions` · `Failed` |
| Analytics generated | Passed / failed / warning counts, linked to the full report |
| File size, rows, columns | Read from the file; blank spacer rows are counted and reported, not silently dropped |

## The analytics report

Every upload gets its own page (`#/analytic/{id}/upload/{uploadId}`) carrying:

* **Headline counts** — rows processed, passed, failed, warnings, and how many rows no criterion
  could be evaluated against.
* **Upload details** — everything in the table above, plus when it was processed and how long it
  took.
* **Sample classification** — calibrators / controls / patient samples / unclassified, read from the
  file's own `Sample ID` and `Sample Type` values (`Cal_n` or *Standard* → calibrator, `WSC*` /
  `WCS*` / `UC` or *Control* → control, numeric ID or *Unknown* → patient).
* **Criteria outcome** — for each of the seven criteria: which stream it applies to, which column of
  *this* file it read, the rule that was applied, and how many rows it evaluated, failed and warned.
* **Values derived from this file** — cut-off, ion-ratio range, retention-time window and calibrated
  measuring range, each shown with the calibrators or controls it was computed from.
* **Exceptions** — one row per finding, searchable and filterable by failure or warning, with sample
  ID, stream, criterion, column, actual value, expected range and the reason.
* **Column profile** — every column with its inferred type, how populated it is, distinct count,
  min / max / mean and example values. This is the part that works for *any* spreadsheet, including
  one the criteria cannot read.
* **Downloads** — `Download Passed Rows` (rows with no finding, in the file's own columns and values)
  and `Download Exceptions` (one row per finding, with the original record alongside it).
* **Preview rows** — the uploaded rows exactly as they arrived, with each row's outcome.

## The criteria

Processing runs the seven LISA criteria, with no configuration screen: thresholds are the documented
defaults and every limit is derived from the uploaded file itself.

| Criterion | Applies to | Reads | Rule |
|---|---|---|---|
| Check Calibrator Accuracy | Calibrator | `% Diff` | > 25 % → fail |
| Check Control Accuracy | Control | `% Diff` | > 25 % → fail |
| Check Internal Standard Errors | Patient | `ISTD Area`, `% Recovery` | missing peak · recovery ratio < 90 % |
| Flag Concentrations Below Cut-off | Patient | `Conc. (ng/mL)` | below the cut-off → warning |
| Check Ion Ratio | Patient | `Ref 1 Actual Ratio` | outside the calibrator range ± 10 % |
| Check Retention Time | Patient | `Found RT` | outside the calibrator average ± 20 % |
| Check Calibration Range | Patient | `Conc. (ng/mL)` | outside the lowest–highest calibrator → warning |

Columns are **matched to whatever the file contains** — nothing is hardcoded to a file layout. A
criterion whose column is absent is reported as *not in file* rather than silently skipped.

### Uploaded values are never rewritten

Processing reads and reports; it never writes a value back into a row. A concentration below the
cut-off is *flagged*, not zeroed. The passed-rows export carries the file's own columns, in its own
order, with the values exactly as uploaded.

### A row nothing applied to is not a passing row

If no criterion could be evaluated against a row — the file has none of the columns they read — that
row is counted as **not evaluated**, never as passed. A file the criteria cannot read reports zero
passes and says so, instead of showing a clean green run that means nothing.

## Everything is dynamic

Nothing about a file is assumed:

* **Columns** come from the file. Types (`text` / `number` / `date` / `boolean`) are inferred from the
  values (`U.inferType`, `U.describeFields`).
* **Sample streams** come from the file's own Sample ID / Sample Type values.
* **Limits** (cut-off, ion-ratio range, RT window, calibrated range) are computed from the
  calibrators and controls in that file, and shown with their provenance.
* **Instrument "no result" tokens** (`----`, `N.I.(High)`, `N/A`, …) are treated as missing
  everywhere, so a numeric column is still detected as numeric. The token list is editable in
  *Settings*.

## Screens

```
#/dashboard                          totals across every analytic + recent uploads
#/analytics                          the analytics list
#/analytic/{id}                      one analytic: drop zone + upload history
#/analytic/{id}/upload/{uploadId}    the analytics generated from one upload
#/settings                           profile, table defaults, prototype data reset
```

That is every screen. There is no stepper, no approval, no lock, no rule builder and no separate QC
or patient-testing run.

## Project layout

```
index.html                    app shell: login, sidebar, header, modal/drawer/toast roots
assets/css/styles.css         design tokens + component styles (light, responsive, print)
assets/js/util.js             DOM helpers, formatters, icons, CSV parsing, type inference
assets/js/criteria.js         the seven criteria: catalogue, derivation and the row engine
assets/js/analyze.js          one file in → one analytics report out
assets/js/seed.js             demo catalogue + deterministic sample-data generator
assets/js/store.js            state, analytics, uploads, outputs, persistence
assets/js/ui.js               toasts, modals, drawers, badges, data table, forms
assets/js/screens-core.js     dashboard, analytics list, create/edit analytic, settings
assets/js/screens-uploads.js  the analytic screen, uploading, and the analytics report
assets/js/app.js              bootstrap, auth, hash router, sidebar/header chrome
```

## Data model

```
Analytic  { id, name, code, description, uploads: [ … ] }
   └── Upload  { no, fileName, uploadedAt, uploadedBy, status,
                 size, rowCount, columnCount, columns, records, report }
          └── report  { total, passed, failed, warnings, notEvaluated,
                        streamCounts, columnMap, derived, byCriterion,
                        criteriaApplied, profile, exceptions }
```

Mutations go through `Store` (`create`, `update`, `addUpload`, `deleteUpload`, `remove`), so each one
maps onto a REST call later without touching screen code. `Analyze.run(file)` is a pure function from
a file to a report and can be replaced by server-side processing returning the same shape.

## Trying it out

The prototype ships with four demo analytics:

* **Cocaine** — four LC-MS/MS run files already uploaded, each with its own report. All seven criteria
  apply; every run carries deliberate QC drift, so calibrator, control, ion-ratio, retention-time and
  cut-off findings are all visible.
* **HbA1c Analysis** and **Lipid Profile** — generic QC exports. Only the accuracy criteria have
  columns to read, so their reports lean on the classification and column profile — the shape any
  arbitrary spreadsheet produces.
* **Complete Blood Count** — no uploads yet, for the empty-state journey.

Inside any analytic, `Download Template` gives you a correctly shaped file to populate, and
`Use a demo file` generates and uploads one so the flow can be exercised without leaving the browser.

## Prototype boundaries

* **XLSX / XLS** — CSV is parsed for real. Binary spreadsheets need a reader library or a server, so
  the prototype says so plainly and substitutes an equivalent generated dataset (marked
  *simulated parse*) to keep the flow exercisable end to end.
* **Persistence** — state lives in `localStorage` (key `lisa.state.v2`). Demo rows regenerate
  deterministically; rows you upload yourself are stored verbatim. If the browser's quota is
  exceeded, the upload history and reports are kept and the rows are dropped, and the app says so
  rather than failing quietly. Reset everything under *Settings → Prototype data*.
* **Processing run** — the progress bar is animated, but the pass / fail outcome behind it is
  computed by the real criteria engine, not faked.
