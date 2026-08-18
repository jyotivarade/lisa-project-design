# LISA — I. Configuration Model & J. Snapshot Strategy

## I. Configuration model

Three layers, each with a different lifetime:

| layer | table | lifetime | who edits |
|---|---|---|---|
| **Rule catalogue** — what rules exist, their parameters, units, valid ranges, defaults | `rule_definitions` | application-lifetime, seeded by migration | ADMIN |
| **Analytics configuration** — the values for one assay | `analytics_configuration_versions` (append-only) | versioned forever | ADMIN, ANALYST (`configuration:write`) |
| **Session snapshot** — what was actually used for one run | `processing_sessions.config_snapshot` | immutable, forever | nobody |

Everything the specification calls out as configurable lives in the version payload
(full shape in `docs/01-DATA-MODEL.md` §2) — calibration tolerance, control tolerance,
reference-ratio formula and adjustment, zero-ratio policy, RT mode and adjustment, ISTD
suppression threshold and basis, cut-off source, required calibrators, required controls,
per-rule enable/mandatory/priority, value tokens, column mappings, classification rules,
correction policy, analyte scope. **No business value is defined anywhere else.**

### Where each value is enforced
`rule_definitions.parameter_schema` carries the type, unit, min and max for every parameter.
That single definition drives: the Configuration UI form controls, the Zod schema on the
client, the Pydantic validator on the server, and the pre-processing configuration check —
so a tolerance cannot be out of range on one side of the wire and accepted on the other.

### Versioning
Editing configuration **never updates a row**. It:
1. validates the proposed payload,
2. inserts `analytics_configuration_versions` version N+1 with a change note and author,
3. repoints `analytics_configurations.active_version_id`,
4. writes `CONFIG_CHANGED` to the audit log with old and new payloads,
5. returns `affected_sessions: 0`.

Non-terminal sessions holding a stale snapshot have their verdicts reset to `NOT_REVIEWED`
and drop back to `CALIBRATION_REVIEW`, because a verdict computed under an old configuration
is not a verdict under the new one. **Terminal sessions are never touched.**

## J. Configuration snapshot strategy (AD-1, §22, §35)

At the moment a session is created (upload or rerun), the service **resolves the complete
effective configuration** — active version payload + resolved column mappings + resolved
classification rules + the rule set with enabled/mandatory/priority — and writes it to
`processing_sessions.config_snapshot`, together with `config_version_id` (lineage) and
`engine_version` (§43).

Thereafter:

* `context_builder` reads **only** `config_snapshot`. There is no code path from the criteria
  engine to the live configuration tables; `criteria/` cannot even import them (AD-3).
* Calibration and control validation read the snapshot, so a mid-review configuration change
  cannot half-apply.
* Rerun creates a **new** session with a **freshly resolved** snapshot — that is the supported
  way to apply changed configuration to old data, and it leaves the old session intact.

### The §35 acceptance test, written as it will be implemented

```
Day 1  configuration v1: calibration_tolerance_percent = 25
       Session A processes file F   →   Cal_4 %Diff 27.87 → FAIL, results R_A

Day 2  ADMIN sets calibration_tolerance_percent = 10   →   configuration v2

Assert GET /api/processing/{A}.config_snapshot.calibration.tolerance_percent == 25
Assert results of A are byte-identical to R_A
Assert A.config_version_id still points at v1
Assert rerunning F creates session B with snapshot v2, and A is unchanged
```

### Reproducibility inputs (§43)
A result is reproducible from exactly six things, all persisted:

```
original file (immutable, sha256)
  + calibrator_selections
  + control_selections
  + row_corrections
  + config_snapshot
  + engine_version
        ⇒ processing_results + rule_results, deterministically
```

A `replay(session_id)` test rebuilds the context from those six inputs alone and asserts the
regenerated results equal the stored ones — the strongest available check that nothing in the
pipeline depends on wall-clock, ordering, or live configuration.
