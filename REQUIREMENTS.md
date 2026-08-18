# LISA — Requirements Traceability

`TODO` · `IN PROGRESS` · `COMPLETED` · `BLOCKED`
Nothing is marked `COMPLETED` without a passing automated test named in Evidence.

**Current state: Phase 5 complete (pure criteria engine). Phase 6 (validation + the processing gate) is next.**

Evidence names the test that proves the row. Rows without evidence are not COMPLETED.

| § | Requirement | Phase | Status | Design | Evidence |
|---|---|---|---|---|---|
| 1.1–1.8 | Accept, store, unlimited uploads, parse, identify analytes/calibrators/controls/patients | 4 | COMPLETED | `docs/02` N | test_upload.py, test_preview.py |
| 1.9–1.11 | Validate calibrators & controls; block patient processing on failure | 6 | TODO | `docs/02` K, L, G | |
| 1.12–1.14 | UI correction of calibration/control data; select/unselect; recalculate | 6 | TODO | `docs/01` §5, `docs/04` | |
| 1.15–1.17 | Gate; sequential row processing; all configured rules | 6, 7 | TODO | `docs/02` M | |
| 1.18–1.21 | Passed results, failed results, original structure preserved, detailed reasons | 7, 8 | TODO | `docs/02` outputs | |
| 1.22–1.24 | Downloads, rerun, full history | 8 | TODO | `docs/03` | |
| 1.25 | Historical results immune to configuration change | 3, 6 | TODO | `docs/05` J | |
| 1.26–1.27 | Dashboard from real data; no dummy data | 9 | TODO | `docs/03` dashboard | |
| 2 | Analyse before coding; document ambiguities | 0 | COMPLETED | this deliverable | docs/00-07, DECISIONS.md |
| 3 / AD-1 | Configuration snapshot per session; engine reads snapshot only | 3, 6 | TODO | `docs/05` J | |
| 3 / AD-2 | Three-layer gate; 409 on violation | 6 | TODO | `docs/02` G | |
| 3 / AD-3 | Pure criteria engine, no framework imports | 5 | COMPLETED | `docs/02` F | test_purity.py (36) — verified to fail on injected sqlalchemy/random imports |
| 4.1 | Auth: Argon2, JWT, refresh rotation, RBAC, user profile | 2 | COMPLETED | `docs/00` O | test_auth.py (36), test_rbac.py (23), test_security.py (22), auth.test.tsx (9) |
| 4.2 | Dashboard metrics & analytics summary | 9 | TODO | `docs/03` | |
| 4.3 | Analytics management | 3 | COMPLETED | `docs/01` §2 | test_analytics.py::TestAnalyticsCrud (11) |
| 4.4 | File management, no overwrite, duplicate detection without deletion | 4 | COMPLETED | `docs/01` §3 | test_upload.py (23) — additive, hash-flagged duplicates, byte-identical download |
| 4.5 | CSV parser: headers, order, tokens, malformed/empty rows, source row number | 4 | COMPLETED | `docs/02` N | test_csv_parser.py (30) — header verbatim, blank skipped, malformed flagged |
| 5 | Calibrator / control / patient identification, configurable | 4 | COMPLETED | `docs/02` classification | test_classifier.py (21) — Sample Type AND Sample ID, blanks never patients |
| 6 | Calibration validation, configurable tolerance | 6 | IN PROGRESS | `docs/02` K, D-03 | rule proven (27.87 fails at 25%, passes at 30%); selection, revalidation and gating are Phase 6 |
| 7 | Control validation, configurable tolerance | 6 | IN PROGRESS | `docs/02` L, D-04 | rule proven (61.22/73.90 fail; UC `----` SKIPPED); selection and gating are Phase 6 |
| 8 | ISTD missing + suppression, configurable threshold and basis | 5, 7 | COMPLETED | D-05 **OPEN** | test_rules_patient.py::TestInternalStandard (13) — basis always reported |
| 9 | Concentration cut-off from WCS1; original never lost | 5, 7 | COMPLETED | D-10 | test_rules_patient.py::TestConcentrationCutoff (8) — original never overwritten |
| 10 | Ion ratio: span formula, configurable %, zero-ratio policy, full transparency | 5, 6 | COMPLETED | D-01, D-02, D-07 | test_derivations.py — spec example 40/62@10% gives 37.8–64.2; all 3 zero policies |
| 11 | Retention time: average, configurable %, absolute mode | 5, 6 | COMPLETED | D-06 | test_derivations.py::TestRetentionTime — PERCENTAGE, ABSOLUTE, MEAN, MEDIAN |
| 12 | N.I. High → OVER_CALIBRATION_RANGE in failure logic | 5 | COMPLETED | D-12 | test_rules_patient.py::TestCalibrationRange (8) — N.I. High/Low, FLAG_ONLY |
| 13 | Row-by-row processing, no stop at first failure, all failures | 7 | IN PROGRESS | `docs/02` M | engine proven on all four real runs; persistence and progress are Phase 7 |
| 14 | Detailed evaluation payload, mandatory-rule semantics | 5, 7 | IN PROGRESS | `docs/02` F | engine payload complete; persisting it to rule_results is Phase 7 |
| 15 | PASSED file + EXCEPTION report with all listed fields | 8 | TODO | `docs/02` outputs | |
| 16 | Explicit state machine; 409 on bypass | 6 | IN PROGRESS | `docs/02` G | state machine complete and closed (test_state_machine.py); the gate lands in Phase 6 |
| 17 | UI: navigation, dashboard, analytics, calibration, control, patient screens | 3–9 | TODO | `docs/04` | |
| 18 | Configuration UI; every change creates a new version | 3 | COMPLETED | `docs/05` I | test_upload.py::test_the_stored_file_is_byte_identical_to_the_upload |
| 19 | Corrections with original/corrected/who/when/reason; revalidate; audited | 6 | TODO | D-14 **OPEN** | |
| 20 | Rerun creates a new session; history unchanged | 8 | TODO | D-15 | |
| 21 | Normalised schema, UUIDs, indexes, FKs, transactions, JSONB where appropriate | 1 | COMPLETED | `docs/01` | test_schema.py (21 tables, indexes, NUMERIC, CHECKs) |
| 22 | config_snapshot JSONB; engine reads only it | 3, 6 | COMPLETED | `docs/05` J | test_snapshot.py (4) — resolve_snapshot is a copy, not a live view |
| 23 | Audit logging of all listed actions | 10 | IN PROGRESS | `docs/01` §7 | LOGIN/LOGIN_FAILED/LOGOUT/USER_*/ROLE_CHANGED written and asserted — test_auth.py::TestAuditTrail |
| 24 | REST API surface & status codes | 2–9 | IN PROGRESS | `docs/03` | /api/auth/*, /api/admin/* complete |
| 25 | Standardised errors; no raw exceptions | 1 | COMPLETED | `docs/02` errors | test_errors.py, test_health.py |
| 26 | Full test suite **incl. the API-level gate rejection test** | 5–11 | IN PROGRESS | `docs/07` | config validation asserted; the gate test lands in Phase 6 |
| 27 | Real CSV structure; fixtures test-only; no dummy seed | 4, 11 | **BLOCKED** | B-1 — Mitragynine/Temazepam files not supplied | fixtures restored; test_seed.py asserts no business data |
| 28 | Data quality: `----`, blank, 0, N.I. High/Low, negatives; no silent conversion | 4, 5 | COMPLETED | `docs/02` N | test_values.py (26) — `----` is MISSING, never 0; N.I. High/Low kept distinct |
| 29 | Multi-analyte support; per-Analytics configuration | 3, 4 | COMPLETED | D-13 **OPEN** | test_upload.py::TestAnalyteScope — STRICT and ALL both proven |
| 30 | Unlimited analytics and files, independently traceable | 3, 4 | COMPLETED | `docs/01` | test_upload.py::test_uploads_are_additive_and_never_overwrite |
| 31 | Security controls | 2, 12 | IN PROGRESS | `docs/00` O | Argon2id, JWT, rotation+reuse detection, lockout, rate limit, RBAC — test_security.py, test_auth.py. Secure headers/CORS hardening in Phase 12 |
| 32 | Streaming/chunked processing; deterministic | 4, 7 | COMPLETED | `docs/00` NFR | test_performance.py — 500k rows, 34MB file, 74MB peak RSS growth |
| 33 | FileStorage abstraction; local now, S3 later | 4 | COMPLETED | `docs/00` D | FileStorage protocol + LocalFileStorage; S3 in Phase 12 |
| 34 | UI/UX: clear PASS/FAIL/BLOCKED, confirmations, always explain blocking | 6, 9 | TODO | `docs/04` | |
| 35 | Historical immutability | 3, 11 | IN PROGRESS | `docs/05` J | append-only versions + snapshot proven; the full day-1/day-2 suite lands with sessions in Phase 6 |
| 36 | Transactional processing start with lock | 6 | TODO | `docs/01` §8 |  |
| 37 | Administration surface | 2, 3 | COMPLETED | `docs/03` | test_rbac.py::TestUserAdministration, TestRoleCatalogue |
| 38 | Reporting: summary, calibration, control, patient, exception, audit | 8, 10 | TODO | `docs/03` | |
| 39 | Backend/frontend folder structure | 1 | COMPLETED | `docs/00` D, E | repository layout |
| 40 | Phased delivery with a report after each phase | all | TODO | `docs/06` | |
| 41 | Configurable defaults for the eight named conflicts | 3 | COMPLETED | `DECISIONS.md` | test_analytics.py::test_defaults_match_the_decisions_log, test_rule_catalog.py |
| 42 | Architecture-first deliverable (A–S) | 0 | COMPLETED | `docs/00`–`07` | docs/00-07 |
| 43 | Production rules: no hard-coded business values, reproducible results | all | IN PROGRESS | `docs/05` J | no-business-constants.test.ts enforces it (verified to fail on an injected literal); reproducibility replay lands in Phase 8 |
