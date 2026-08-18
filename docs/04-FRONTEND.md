# LISA — Frontend Architecture (E)

React 18 · TypeScript strict · Vite · React Router 6 · TanStack Query · TanStack Table ·
react-hook-form + Zod · Tailwind + shadcn/ui (Radix) · Recharts · Vitest + RTL + MSW ·
Playwright. Folder layout is in `docs/00-ARCHITECTURE.md` §E.

**Rule enforced in review:** no numeric business constant may appear under `src/`. Every
tolerance, adjustment, threshold, calibrator ID and control ID is rendered from
`GET /api/rule-definitions` and the analytics configuration (§43).

---

## Navigation (§17)

`Dashboard · Analytics · Files · Processing · Results · Profile · Administration`
Administration is visible only with `users:read`; every action is gated by
`usePermission("processing:execute")` etc., mirroring the backend permission codes.

## Routes

| path | page | permission |
|---|---|---|
| `/login` | LoginPage | public |
| `/` | DashboardPage | `analytics:read` |
| `/analytics` | AnalyticsListPage | `analytics:read` |
| `/analytics/:id` | AnalyticsDetailPage — 8 tabs | `analytics:read` |
| `/files` | FilesPage (all analytics) | `files:read` |
| `/files/:fileId` | FileDetailPage — preview, sessions, downloads | `files:read` |
| `/processing/:sessionId` | ProcessingPage — the workflow | `processing:read` |
| `/processing/:sessionId/results` | ResultsPage | `results:read` |
| `/profile` | ProfilePage | self |
| `/administration/{users,roles,rules}` | Administration | `users:read` |

## Analytics detail tabs (§17)
`Overview · Configuration · Files · Calibration · Controls · Patients · Processing History · Results`

---

## The processing page — state comes from the server, always

The stepper renders from `session.state`; the client never computes readiness.

```
① Preview      ② Calibration    ③ Controls       ④ Gate           ⑤ Patients / Results
columns,       select/unselect  select/unselect  PASS/FAIL both   progress, results table,
streams,       correct,         correct,         [Process] gated  drill-down, downloads
warnings       validate         validate         reason shown
```

### GateCard (§16, §34)

```
┌──────────────────────────────────────────────────────────┐
│ ANALYSIS READINESS                                       │
│ Calibration   7 / 7 selected      PASS                   │
│ Controls      2 / 3 passing       FAIL                   │
│ Overall                            BLOCKED               │
│                                                          │
│ Patient processing is blocked because WCS2 failed        │
│ control validation (%Diff 73.90, tolerance 25%).         │
│                                                          │
│           [ Process Patient Records ]  ← disabled        │
└──────────────────────────────────────────────────────────┘
```

The button mirrors server state; it is never the control. A `409` from the API renders as this
banner with the returned `error_code` and `details`, not as a transient toast — being blocked
is a workflow state the user must understand, not an accident to dismiss.

### Calibration screen (§17)
Table: `Calibrator · Sample ID · Sample Type · %Diff · Ref Ratio · Found RT · Std Conc ·
Conc · Selected · Value state · In range? · Validation · Reason`, with a correction action
per editable cell and a live summary panel:

```
Selected calibrators   7 / 7            Ion-ratio range (SPAN)
Minimum ratio          25.31            range       8.60
Maximum ratio          33.91            adjustment  10 %  → 0.86
                                        lower       24.45
Excluded                                upper       34.77
  Cal_3  ZERO_EXCLUDED (ratio 0)
                                        Retention time (PERCENTAGE)
Calibration status     PASS             average 4.3484 · ±20 %
                                        3.4787 … 5.2181
```

Every exclusion states its reason, so an invalid `Cal_1` visibly does not move the range (§10).

### Control screen (§17)
`Sample ID · Role · %Diff · Selected · Expected · Actual · Status · Reason`, with
`Selected / Passed / Failed / Missing` counters and the cut-off source called out
(`WCS1 → cut-off 1.5 ng/mL`). `UC` shows as `DISCOVERED — not evaluated`.

### Patient screen (§17)
`Sample ID · Analyte · Original Conc · Final Conc · ISTD · Ion Ratio · Found RT ·
Calibration Range · Final Result`. Clicking a row opens the full evaluation:

```
2606251021 · Cocaine · FAILED
  PASS  Internal Standard    13 395 265 (98.4 % of basis, threshold 90 %)
  FAIL  Concentration Cutoff 0.6582 · cut-off 1.5 · CONCENTRATION_BELOW_CUTOFF
  PASS  Ion Ratio            31.18 within 24.45 – 34.77
  PASS  Retention Time       4.355 within 3.4787 – 5.2181
  PASS  Calibration Range    within 1 – 100
Original 0.6582 → adjusted 0
```
plus the complete original row, so a reviewer never opens the CSV to understand a verdict.

### Corrections (§19)
`CorrectionDialog` shows original value, new value and a **required reason**, warns that the
uploaded file is never modified, and on submit resets the verdict — the wizard visibly
returns to the review step, because a stale PASS must not survive a data change.

---

## State management
* **Server state → TanStack Query only.** Keys `['session', id]`, `['session', id, 'gate']`,
  `['session', id, 'calibrators']`, `['analytics', id, 'configuration']`. Selection,
  correction and validation mutations invalidate the session, the gate and the traces together.
* **Client state → Zustand**, minimal: auth token (memory only), sidebar, table density,
  column visibility. Never business values.
* **Forms → react-hook-form + Zod**, with bounds sourced from `/api/rule-definitions`.
* **Confirmation dialogs** before Process, Rerun and Correction (§34).
* **Progress** — `useProgress` polls `/progress` at 1.5 s only while `PROCESSING_PATIENTS`.

## Large files (§32)
The browser never parses a CSV. Upload streams to the API; preview, counts and warnings come
from `/files/{id}/preview`; result tables are server-paginated and server-sorted; downloads
are streamed responses. A 130-row file and a 500 000-row file behave identically in the client.

## Quality bar
TypeScript strict, no `any` in `features/` or `services/`; types generated from OpenAPI;
one `DataTable` implementation; keyboard-operable tables and dialogs; status conveyed by icon
**and** text, never colour alone — a result that reads as "green" to one reviewer and nothing
to another is a defect in a laboratory system.
