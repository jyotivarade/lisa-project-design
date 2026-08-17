/* ============================================================
   store.js — application state, analytic lifecycle, state machine,
   configuration versioning, audit trail, notifications, persistence.
   Shaped so every mutation could become a REST call later.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'analytix.state.v1';

  var DEMO_USER = { name: 'Admin User', email: 'admin@analytics.com', role: 'Administrator', initials: 'AU' };
  var CREDENTIALS = { email: 'admin@analytics.com', password: 'Admin@123' };

  /* Workflow states — mirrors the documented state machine. */
  var STATES = {
    DRAFT: 'DRAFT',
    FILES_UPLOADED: 'FILES_UPLOADED',
    ANALYTICS_SELECTED: 'ANALYTICS_SELECTED',
    CLASSIFIED: 'CLASSIFIED',
    FIELDS_SELECTED: 'FIELDS_SELECTED',
    RULES_CONFIGURED: 'RULES_CONFIGURED',
    VALIDATING: 'VALIDATING_CONTROL_CALIBRATION',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    VALIDATION_PASSED: 'VALIDATION_PASSED',
    APPROVED: 'PATIENT_TESTING_UNLOCKED',
    PATIENT_TESTING: 'PATIENT_TESTING',
    RESULTS: 'RESULTS'
  };

  var STEPS = [
    { key: 'upload', label: 'Upload Files', hint: 'One or many data files' },
    { key: 'analytics', label: 'Analytics', hint: 'Analytics found in the files' },
    { key: 'mapping', label: 'Sample Types', hint: 'Control / calibration / patient' },
    { key: 'fields', label: 'Fields', hint: 'Fields used for validation' },
    { key: 'rules', label: 'Rules', hint: 'Validation configuration' },
    { key: 'validation', label: 'QC Validation', hint: 'Control + calibration run' },
    { key: 'approval', label: 'Approval', hint: 'Sign-off configuration' },
    { key: 'patient', label: 'Patient Testing', hint: 'Run patient samples' },
    { key: 'results', label: 'Results', hint: 'Pass / fail outcome' }
  ];

  var S = {
    user: null,
    loggedIn: false,
    analytics: [],
    notifications: [],
    activityLog: [],       // platform-level audit (login, analytic created, …)
    ui: { sidebarCollapsed: false, lastRoute: 'dashboard' },
    settings: {
      autoLockOnRuleChange: true,
      requireReasonOnRuleChange: true,
      warnAsFailure: false,
      pageSize: 25,
      dateFormat: 'DD MMM YYYY',
      notifyOnFailure: true,
      notifyOnApproval: true,
      missingTokens: U.MISSING_TOKENS.join(', ')
    },
    _hydrated: {}
  };

  /* ------------------------------------------------------------
     Persistence — records are bulky, so they are re-derivable
     (seeded analytics regenerate; large uploads stay in memory).
     ------------------------------------------------------------ */
  function persistable() {
    var copy = {
      user: S.user, loggedIn: S.loggedIn, notifications: S.notifications.slice(0, 40),
      activityLog: S.activityLog.slice(0, 400), ui: S.ui, settings: S.settings,
      analytics: S.analytics.map(function (a) {
        var b = Object.assign({}, a);
        if (b.file) {
          b.file = Object.assign({}, b.file);
          delete b.file.records;           // rebuilt on load
        }
        b.files = (b.files || []).map(function (f) {
          var g = Object.assign({}, f);
          delete g.records;                // bulk rows are re-derivable
          return g;
        });
        b.patientTesting = Object.assign({}, b.patientTesting);
        // keep only exception rows; full result set is recomputed on demand
        b.patientTesting.results = (b.patientTesting.results || [])
          .filter(function (r) { return r.status !== 'pass'; }).slice(0, 400);
        b.patientTesting.resultsPartial = true;
        b.audit = (b.audit || []).slice(0, 120);
        return b;
      })
    };
    return copy;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(persistable())); }
    catch (e) { /* quota — the prototype keeps working from memory */ }
  }

  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return false;
    try {
      var d = JSON.parse(raw);
      S.user = d.user || null;
      S.loggedIn = !!d.loggedIn;
      S.notifications = d.notifications || [];
      S.activityLog = d.activityLog || [];
      S.ui = Object.assign(S.ui, d.ui || {});
      S.settings = Object.assign(S.settings, d.settings || {});
      if (d.settings && d.settings.missingTokens) U.setMissingTokens(String(d.settings.missingTokens).split(','));
      S.analytics = (d.analytics || []).map(function (a) {
        a.file = a.file || null;
        a.files = a.files || [];
        a.analyteScope = a.analyteScope || { field: '', values: [], applied: false, detected: [] };
        a.selectedFields = a.selectedFields || [];
        return a;
      });
      // restore record sets for anything derived from the demo generator
      S.analytics.forEach(function (a) {
        if (a.seed && a.files.length) attachSeedRecords(a);
        else if (a.files.length) {
          // a user-uploaded file cannot be rebuilt after a reload
          a.files = []; a.file = null; a.fields = [];
          a.classification = { field: '', control: '', calibration: '', patient: '', applied: false, counts: null, suggested: null };
          a.analyteScope = { field: '', values: [], applied: false, detected: [] };
          a.selectedFields = []; a.rules = a.rules || [];
        }
        invalidateMergeCache(a);
      });
      return S.analytics.length > 0;
    } catch (e) { return false; }
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    S.analytics = []; S.notifications = []; S.activityLog = [];
    S.user = null; S.loggedIn = false;
    bootstrap();
  }

  /* ------------------------------------------------------------
     Analytic construction
     ------------------------------------------------------------ */
  function blankAnalytic(o) {
    var now = new Date().toISOString();
    return Object.assign({
      id: U.uid('AN').toUpperCase(),
      name: 'Untitled Analytic',
      code: '',
      description: '',
      status: 'draft',
      color: '#1A6BC4',
      version: '0.1',
      createdAt: now,
      updatedAt: now,
      seed: null,
      files: [],                 // every uploaded file lives in ONE workflow
      file: null,                // derived dataset summary (label, totals) for list/dashboard cards
      fields: [],
      analyteScope: { field: '', values: [], applied: false, detected: [] },
      selectedFields: [],        // [] until the user confirms; drives which rules run
      classification: {
        field: '', control: '', calibration: '', patient: '', applied: false, counts: null, suggested: null,
        mode: 'values',          // 'values' | 'patterns' (LISA Sample ID + Sample Type rules)
        patterns: null
      },
      /* --- LISA analyte / assay configuration --- */
      assay: {
        analyteName: '', analyteCode: '', assayName: '', matrix: '',
        referenceRatioAdjustment: 10,      // % widening applied to the calibrator ion-ratio range
        cutoffMode: 'wcs1',                // 'wcs1' (dynamic, from the cut-off control) | 'fixed'
        cutoffSampleId: 'WCS1',
        cutoffValue: null,
        ignoreZeroRatios: true,
        criteriaVersion: '1.0',
        updatedAt: null, updatedBy: null
      },
      criteria: null,            // built from Criteria.defaultConfig() on first use
      columnMap: null,           // criterion column roles → real uploaded columns
      processing: { runs: {} },  // per-file processing results, keyed by file id
      rules: [],
      fieldLogic: {},
      ruleTest: null,
      validation: { ranAt: null, controls: null, calibration: null, approved: false, approvedAt: null, approvedBy: null, approvedVersion: null },
      patientTesting: { unlocked: false, startedAt: null, completedAt: null, summary: null, results: [], resultsPartial: false },
      versions: [],
      audit: [],
      dataEdits: {}
    }, o || {});
  }

  function attachSeedRecords(a) {
    var spec = Seed.CATALOG.filter(function (c) { return c.id === a.seed.catalogId; })[0];
    if (!spec) return;
    (a.files || []).forEach(function (f, i) {
      var ds = Seed.generateDataset(spec.gen, spec.seedNo + i * 17, f.seedPart);
      f.records = ds.rows;
      f.columns = ds.columns;
    });
    invalidateMergeCache(a);
    if (!a.fields || !a.fields.length) refreshFields(a);
  }

  /* ------------------------------------------------------------
     Merged dataset across every uploaded file
     ------------------------------------------------------------ */
  var mergeCache = {};
  function invalidateMergeCache(a) { delete mergeCache[a.id]; }
  function mergeToken(a) {
    return (a.files || []).map(function (f) { return f.id + ':' + (f.records ? f.records.length : 0); }).join('|') +
      '#' + (a.editVersion || 0);
  }

  /** Every record from every file, annotated with its source, plus corrections applied. */
  function recordsOf(a) {
    var token = mergeToken(a);
    var cached = mergeCache[a.id];
    if (cached && cached.token === token) return cached.rows;

    var edits = a.dataEdits || {};
    var rows = [];
    (a.files || []).forEach(function (f) {
      (f.records || []).forEach(function (r, i) {
        var edit = edits[f.id + ':' + i];
        var rec = edit ? Object.assign({}, r, edit) : r;
        rec.__src = f.name;
        rec.__fid = f.id;
        rec.__row = i;
        rec.__i = rows.length;
        rows.push(rec);
      });
    });
    mergeCache[a.id] = { token: token, rows: rows };
    return rows;
  }

  function filesOf(a) { return a.files || []; }
  function hasData(a) { return !!(a.files && a.files.length); }
  /** The original (uncorrected) row behind a merged record. */
  function sourceRecord(a, rec) {
    var f = (a.files || []).filter(function (x) { return x.id === rec.__fid; })[0];
    return f && f.records ? f.records[rec.__row] : null;
  }

  /** Union of columns across files (files may differ in shape). */
  function columnsOf(a) {
    var seen = {}, out = [];
    (a.files || []).forEach(function (f) {
      (f.columns || []).forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } });
    });
    return out;
  }

  /** Re-profile fields from the merged dataset and refresh the dataset summary. */
  function refreshFields(a) {
    invalidateMergeCache(a);
    var cols = columnsOf(a);
    var recs = recordsOf(a);
    a.fields = U.describeFields(cols, recs);
    var totalRecords = recs.length;
    var latest = (a.files || []).map(function (f) { return f.uploadedAt; }).sort().slice(-1)[0] || null;
    a.file = !a.files.length ? null : {
      name: a.files.length === 1 ? a.files[0].name : a.files.length + ' files',
      fileCount: a.files.length,
      names: a.files.map(function (f) { return f.name; }),
      size: U.sum(a.files.map(function (f) { return f.size || 0; })),
      recordCount: totalRecords,
      columnCount: cols.length,
      columns: cols,
      uploadedAt: latest,
      simulated: a.files.some(function (f) { return f.simulated; })
    };
    return a.fields;
  }

  function fieldNames(a) { return (a.fields || []).map(function (f) { return f.name; }); }
  function ctxOf(a) { return { fieldNames: fieldNames(a), fieldLogic: a.fieldLogic || {} }; }

  /** Fields chosen for validation ([] before the user confirms → all fields). */
  function selectedFields(a) {
    if (a.selectedFields && a.selectedFields.length) {
      var names = fieldNames(a);
      return a.selectedFields.filter(function (f) { return names.indexOf(f) > -1; });
    }
    return fieldNames(a);
  }
  function fieldsConfirmed(a) { return !!(a.selectedFields && a.selectedFields.length); }
  function isFieldSelected(a, name) { return selectedFields(a).indexOf(name) > -1; }

  /** Only enabled rules on selected fields take part in a validation run. */
  function activeRules(a) {
    var sel = selectedFields(a);
    return (a.rules || []).filter(function (r) { return r.enabled && sel.indexOf(r.field) > -1; });
  }

  /** Records limited to the analytics the user chose to validate. */
  function scopedRecords(a) {
    var recs = recordsOf(a);
    var s = a.analyteScope;
    if (!s || !s.field || !s.values || !s.values.length) return recs;
    return recs.filter(function (r) {
      return s.values.some(function (v) { return sameVal(r[s.field], v); });
    });
  }

  /** Split the in-scope records by the user's sample-type classification. */
  function groups(a) {
    var recs = scopedRecords(a);
    var c = a.classification;
    var out = { control: [], calibration: [], patient: [], unmatched: [] };
    if (!c) { out.unmatched = recs; return out; }

    if (c.mode === 'patterns' && c.patterns) {
      var order = [['calibration', 'calibrator'], ['control', 'control'], ['patient', 'patient']];
      recs.forEach(function (r) {
        var hit = null;
        order.some(function (pair) {
          if (matchesPattern(r, c.patterns[pair[1]], c)) { hit = pair[0]; return true; }
          return false;
        });
        out[hit || 'unmatched'].push(r);
      });
      return out;
    }

    if (!c.field) { out.unmatched = recs; return out; }
    recs.forEach(function (r) {
      var v = String(r[c.field] === undefined ? '' : r[c.field]).trim();
      if (c.control && sameVal(v, c.control)) out.control.push(r);
      else if (c.calibration && sameVal(v, c.calibration)) out.calibration.push(r);
      else if (c.patient && sameVal(v, c.patient)) out.patient.push(r);
      else out.unmatched.push(r);
    });
    return out;
  }

  /**
   * LISA-style stream match: a row belongs to a stream when its Sample Type is
   * one of the configured values AND/OR its Sample ID matches the pattern.
   */
  function matchesPattern(row, p, c) {
    if (!p) return false;
    var typeOk = true, idOk = true;
    if (p.types && p.types.length) {
      var tv = String(row[c.typeField] === undefined ? '' : row[c.typeField]).trim().toLowerCase();
      typeOk = p.types.some(function (t) { return String(t).trim().toLowerCase() === tv; });
    }
    if (p.idPattern) {
      var idv = String(row[c.idField] === undefined ? '' : row[c.idField]).trim();
      try { idOk = new RegExp(p.idPattern, 'i').test(idv); }
      catch (e) { idOk = false; }
    }
    if (p.match === 'either') return typeOk || idOk;
    return typeOk && idOk;
  }

  /**
   * Suggest LISA sample-stream patterns from the data:
   *   calibrators  Sample ID Cal_1…Cal_n  / Sample Type "Standard"
   *   controls     Sample ID WSC_* / WCS* / UC  / Sample Type "Control"
   *   patients     numeric Sample ID              / Sample Type "Unknown"
   */
  function suggestPatterns(a) {
    var recs = recordsOf(a);
    if (!recs.length) return null;
    var map = Criteria.autoMap(a.fields);
    var idField = map.sampleId, typeField = map.sampleType;
    if (!idField && !typeField) return null;

    function typesMatching(re) {
      if (!typeField) return [];
      var seen = {};
      recs.forEach(function (r) {
        var v = String(r[typeField] === undefined ? '' : r[typeField]).trim();
        if (v && re.test(v)) seen[v] = 1;
      });
      return Object.keys(seen);
    }
    function anyId(re) {
      return !!idField && recs.some(function (r) { return re.test(String(r[idField] || '').trim()); });
    }

    var calTypes = typesMatching(/standard|calib|^std$/i);
    var ctlTypes = typesMatching(/control|^qc$/i);
    var patTypes = typesMatching(/unknown|patient|specimen|sample$/i);

    var out = {
      idField: idField, typeField: typeField,
      calibrator: {
        types: calTypes,
        idPattern: anyId(/^cal[_\-\s]?\d+$/i) ? '^Cal[_\\-\\s]?\\d+$' : '',
        match: calTypes.length ? 'either' : 'all'
      },
      control: {
        types: ctlTypes,
        idPattern: anyId(/^(wsc|wcs|uc)/i) ? '^(WSC|WCS|UC)' : '',
        match: ctlTypes.length ? 'either' : 'all'
      },
      patient: {
        types: patTypes,
        idPattern: anyId(/^\d+$/) ? '^\\d+$' : '',
        match: patTypes.length && anyId(/^\d+$/) ? 'all' : 'either'
      }
    };
    return out;
  }

  /** Apply LISA pattern classification. */
  function applyPatternClassification(a, cfg, reason) {
    var prev = a.classification.mode === 'patterns' ? JSON.stringify(a.classification.patterns) : null;
    a.classification = Object.assign({}, a.classification, {
      mode: 'patterns', applied: true,
      idField: cfg.idField, typeField: cfg.typeField,
      field: cfg.typeField || a.classification.field,
      patterns: {
        calibrator: cfg.calibrator, control: cfg.control, patient: cfg.patient
      }
    });
    a.classification.counts = counts(a);
    var next = JSON.stringify(a.classification.patterns);
    audit(a, {
      action: prev ? 'Sample classification changed' : 'Sample classification applied',
      detail: 'LISA pattern rules on [' + (cfg.idField || '—') + '] / [' + (cfg.typeField || '—') + ']',
      prev: prev, next: next, reason: reason || '', kind: prev ? 'warn' : 'info'
    });
    if (prev && prev !== next) invalidateApproval(a, 'Sample classification changed');
    invalidateProcessing(a, 'Sample classification changed');
    touch(a);
    return a.classification.counts;
  }
  function sameVal(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }

  function counts(a) {
    var g = groups(a);
    return {
      control: g.control.length, calibration: g.calibration.length,
      patient: g.patient.length, unmatched: g.unmatched.length,
      inScope: g.control.length + g.calibration.length + g.patient.length + g.unmatched.length,
      total: recordsOf(a).length
    };
  }

  /* ------------------------------------------------------------
     Analytics detected inside the uploaded files
     ------------------------------------------------------------ */
  /**
   * Detect which column identifies the analytic and what it contains.
   * Prefers a column whose values match this analytic's own name/code, then any
   * low-cardinality text column that is not the sample-type field.
   * → { field, options:[{value, count, byFile:{name:count}}] } | null
   */
  function detectAnalytes(a) {
    var recs = recordsOf(a);
    if (!recs.length) return null;
    var candidates = [];
    var clsField = a.classification && a.classification.field;

    (a.fields || []).forEach(function (f) {
      if (f.type !== 'text' || f.name.slice(0, 2) === '__') return;
      if (f.distinctCount < 1 || f.distinctCount > 25) return;
      if (f.name === clsField) return;
      var tally = {}, byFile = {};
      recs.forEach(function (r) {
        var v = r[f.name];
        if (U.isBlank(v)) return;
        var key = String(v).trim();
        tally[key] = (tally[key] || 0) + 1;
        (byFile[key] = byFile[key] || {});
        byFile[key][r.__src] = (byFile[key][r.__src] || 0) + 1;
      });
      var values = Object.keys(tally);
      if (!values.length) return;
      var filled = U.sum(values.map(function (v) { return tally[v]; })) / recs.length;
      if (filled < 0.8) return;

      // scoring: does any value look like this analytic's name or code?
      var hay = (a.name + ' ' + a.code).toLowerCase();
      var nameHit = values.some(function (v) {
        var t = v.toLowerCase();
        return hay.indexOf(t) > -1 || t.indexOf(a.code.toLowerCase()) > -1 ||
          (t.length > 3 && hay.split(/\s+/).some(function (w) { return w && t.indexOf(w) > -1; }));
      });
      var score = (nameHit ? 6 : 0) + (/analyt|analyte|test|panel|assay|compound|name/i.test(f.name) ? 3 : 0) +
        (values.length <= 8 ? 1 : 0) + (f.name === (a.analyteScope && a.analyteScope.field) ? 2 : 0);
      if (!score) return;
      candidates.push({
        field: f.name, score: score,
        options: values.sort().map(function (v) {
          return { value: v, count: tally[v], byFile: byFile[v] };
        })
      });
    });

    if (!candidates.length) return null;
    candidates.sort(function (x, y) { return y.score - x.score; });
    return candidates[0];
  }

  /** Which analytics each file contains, for the file → analytics tree. */
  function analyticsByFile(a) {
    var det = a.analyteScope && a.analyteScope.field
      ? { field: a.analyteScope.field }
      : detectAnalytes(a);
    var out = [];
    (a.files || []).forEach(function (f) {
      var tally = {};
      (f.records || []).forEach(function (r) {
        var v = det && det.field ? r[det.field] : null;
        var key = U.isBlank(v) ? '—' : String(v).trim();
        tally[key] = (tally[key] || 0) + 1;
      });
      out.push({
        file: f,
        field: det ? det.field : null,
        analytics: Object.keys(tally).sort().map(function (k) { return { value: k, count: tally[k] }; })
      });
    });
    return out;
  }

  function applyAnalyteScope(a, map) {
    var prev = a.analyteScope && a.analyteScope.applied
      ? a.analyteScope.field + ': ' + (a.analyteScope.values || []).join(', ') : null;
    var next = (map.field || '(all records)') + ': ' + ((map.values || []).join(', ') || 'all');
    var changed = prev && prev !== next;
    a.analyteScope = {
      field: map.field || '', values: (map.values || []).slice(), applied: true,
      detected: a.analyteScope ? a.analyteScope.detected : []
    };
    audit(a, {
      action: prev ? 'Analytics selection changed' : 'Analytics selection applied',
      detail: map.field ? 'Records limited to ' + next : 'All records in the uploaded files are in scope',
      prev: prev, next: next, kind: prev ? 'warn' : 'info'
    });
    if (changed) invalidateApproval(a, 'Analytics selection changed');
    touch(a);
    return counts(a);
  }

  function setSelectedFields(a, list, reason) {
    var prev = (a.selectedFields || []).slice();
    var confirmedBefore = fieldsConfirmed(a);
    a.selectedFields = (list || []).slice();
    var changed = confirmedBefore && (prev.length !== a.selectedFields.length ||
      prev.some(function (f) { return a.selectedFields.indexOf(f) === -1; }));
    audit(a, {
      action: confirmedBefore ? 'Validation fields changed' : 'Validation fields selected',
      detail: a.selectedFields.length + ' of ' + (a.fields || []).length + ' detected fields selected for validation',
      prev: confirmedBefore ? prev.length + ' fields' : null,
      next: a.selectedFields.length + ' fields',
      reason: reason || '', kind: confirmedBefore ? 'warn' : 'info'
    });
    if (changed) invalidateApproval(a, 'Field selection changed');
    touch(a);
    return a.selectedFields;
  }

  /* ------------------------------------------------------------
     State machine
     ------------------------------------------------------------ */
  function stateOf(a) {
    if (!hasData(a)) return STATES.DRAFT;
    if (!a.analyteScope.applied) return STATES.FILES_UPLOADED;
    if (!a.classification.applied) return STATES.ANALYTICS_SELECTED;
    if (!fieldsConfirmed(a)) return STATES.CLASSIFIED;
    if (!activeRules(a).length) return STATES.FIELDS_SELECTED;
    var v = a.validation;
    if (!v.controls && !v.calibration) return STATES.RULES_CONFIGURED;
    if (!validationPassed(a)) return STATES.VALIDATION_FAILED;
    if (!v.approved) return STATES.VALIDATION_PASSED;
    if (a.patientTesting.completedAt) return STATES.RESULTS;
    if (a.patientTesting.startedAt) return STATES.PATIENT_TESTING;
    return STATES.APPROVED;
  }

  function validationPassed(a) {
    var v = a.validation;
    var g = groups(a);
    var ctlOk = !g.control.length || (v.controls && v.controls.failed === 0);
    var calOk = !g.calibration.length || (v.calibration && v.calibration.failed === 0);
    var ran = !!(v.controls || v.calibration);
    return ran && ctlOk && calOk;
  }

  function patientUnlocked(a) { return !!a.validation.approved && validationPassed(a); }

  /** Per-step visual state for the workflow stepper. */
  function stepStates(a) {
    var st = stateOf(a);
    var v = a.validation;
    var out = {};
    out.upload = hasData(a) ? 'done' : 'current';
    out.analytics = !hasData(a) ? 'pending' : (a.analyteScope.applied ? 'done' : 'current');
    out.mapping = !a.analyteScope.applied ? 'pending' : (a.classification.applied ? 'done' : 'current');
    out.fields = !a.classification.applied ? 'pending' : (fieldsConfirmed(a) ? 'done' : 'current');
    out.rules = !fieldsConfirmed(a) ? 'pending' : (activeRules(a).length ? 'done' : 'current');
    if (!activeRules(a).length) out.validation = 'pending';
    else if (!v.controls && !v.calibration) out.validation = 'current';
    else out.validation = validationPassed(a) ? 'done' : 'failed';
    if (out.validation !== 'done') out.approval = 'pending';
    else out.approval = v.approved ? 'done' : 'current';
    if (!patientUnlocked(a)) out.patient = 'locked';
    else if (a.patientTesting.completedAt) out.patient = 'done';
    else out.patient = 'current';
    if (!a.patientTesting.completedAt) out.results = patientUnlocked(a) ? 'pending' : 'locked';
    else out.results = 'done';
    if (st === STATES.RESULTS) out.results = 'done';
    return out;
  }

  /** Card-level status used by the analytics list. */
  function statusOf(a) {
    var st = stateOf(a);
    if ([STATES.DRAFT, STATES.FILES_UPLOADED, STATES.ANALYTICS_SELECTED,
      STATES.CLASSIFIED, STATES.FIELDS_SELECTED].indexOf(st) > -1) return 'draft';
    if (st === STATES.VALIDATION_FAILED) return 'locked';
    if (st === STATES.RULES_CONFIGURED || st === STATES.VALIDATION_PASSED) return 'validation';
    return 'active';
  }
  var STATUS_META = {
    active: { label: 'Active', badge: 'badge-success', cls: 's-active' },
    draft: { label: 'Draft', badge: 'badge-neutral', cls: 's-draft' },
    validation: { label: 'Validation Required', badge: 'badge-warn', cls: 's-validation' },
    locked: { label: 'Locked', badge: 'badge-danger', cls: 's-locked' }
  };

  /* ------------------------------------------------------------
     Versioning
     ------------------------------------------------------------ */
  function bumpVersion(v) {
    var p = String(v || '1.0').split('.');
    var major = parseInt(p[0], 10), minor = parseInt(p[1], 10);
    if (isNaN(major)) major = 1;
    if (isNaN(minor)) minor = 0;
    minor += 1;
    if (minor > 99) { major += 1; minor = 0; }
    return major + '.' + minor;
  }

  function archiveCurrentVersion(a, status) {
    var existing = a.versions.filter(function (x) { return x.version === a.version; })[0];
    var entry = {
      version: a.version,
      rulesVersion: a.version,
      ruleCount: a.rules.length,
      controls: a.validation.controls ? (a.validation.controls.failed === 0 ? 'Passed' : 'Failed') : '—',
      calibration: a.validation.calibration ? (a.validation.calibration.failed === 0 ? 'Passed' : 'Failed') : '—',
      patientTests: a.patientTesting.summary ? a.patientTesting.summary.total : null,
      status: status || 'Archived',
      approvedAt: a.validation.approvedAt,
      createdAt: new Date().toISOString()
    };
    if (existing) Object.assign(existing, entry);
    else a.versions.unshift(entry);
    return entry;
  }

  /**
   * Any change to rules / classification invalidates a completed approval,
   * creates a new configuration version and re-locks patient testing.
   */
  function invalidateApproval(a, reason, opts) {
    opts = opts || {};
    var wasApproved = a.validation.approved;
    var hadValidation = !!(a.validation.controls || a.validation.calibration);
    if (!wasApproved && !hadValidation) { touch(a); return null; }

    if (wasApproved) archiveCurrentVersion(a, 'Archived');
    var oldVersion = a.version;
    a.version = bumpVersion(a.version);
    a.validation = {
      ranAt: null, controls: null, calibration: null,
      approved: false, approvedAt: null, approvedBy: null, approvedVersion: null
    };
    a.patientTesting = {
      unlocked: false, startedAt: null, completedAt: null,
      summary: null, summaryByAnalyte: null, results: [], resultsPartial: false
    };
    a.ruleTest = null;
    audit(a, {
      action: 'Configuration version created',
      detail: reason || 'Validation configuration changed',
      prev: 'v' + oldVersion, next: 'v' + a.version, kind: 'warn',
      reason: opts.reason || ''
    });
    if (wasApproved) {
      audit(a, {
        action: 'Approval invalidated',
        detail: 'Patient testing re-locked — Control & Calibration validation must be repeated for v' + a.version,
        kind: 'bad'
      });
      notify({
        kind: 'warn', title: a.name + ' — approval invalidated',
        text: 'Configuration moved to v' + a.version + '. Patient testing is locked until QC revalidation passes.',
        analyticId: a.id
      });
    }
    touch(a);
    return { from: oldVersion, to: a.version };
  }

  function touch(a) { a.updatedAt = new Date().toISOString(); save(); }

  /* ------------------------------------------------------------
     Audit + notifications
     ------------------------------------------------------------ */
  function audit(a, e) {
    var entry = Object.assign({
      id: U.uid('ev'), ts: new Date().toISOString(),
      user: (S.user && S.user.name) || DEMO_USER.name,
      analyticId: a ? a.id : null, analyticName: a ? a.name : 'Platform',
      version: a ? a.version : null,
      kind: 'info', action: '', detail: '', prev: null, next: null, reason: ''
    }, e || {});
    if (a) a.audit.unshift(entry);
    S.activityLog.unshift(entry);
    if (S.activityLog.length > 600) S.activityLog.length = 600;
    save();
    return entry;
  }

  function notify(n) {
    var entry = Object.assign({ id: U.uid('nt'), ts: new Date().toISOString(), read: false, kind: 'info', title: '', text: '' }, n || {});
    S.notifications.unshift(entry);
    if (S.notifications.length > 40) S.notifications.length = 40;
    save();
    return entry;
  }
  function unreadCount() { return S.notifications.filter(function (n) { return !n.read; }).length; }
  function markAllRead() { S.notifications.forEach(function (n) { n.read = true; }); save(); }

  /* ------------------------------------------------------------
     CRUD
     ------------------------------------------------------------ */
  function all() { return S.analytics; }
  function get(id) { return S.analytics.filter(function (a) { return a.id === id; })[0] || null; }

  function create(data) {
    var a = blankAnalytic({
      name: data.name, code: data.code, description: data.description,
      status: data.status || 'draft',
      color: pickColor(S.analytics.length),
      version: '0.1'
    });
    S.analytics.unshift(a);
    audit(a, { action: 'Analytic created', detail: a.name + ' (' + (a.code || '—') + ')', kind: 'info' });
    save();
    return a;
  }

  function remove(id) {
    var a = get(id);
    S.analytics = S.analytics.filter(function (x) { return x.id !== id; });
    if (a) audit(null, { action: 'Analytic deleted', detail: a.name, kind: 'bad', analyticName: a.name });
    save();
  }

  var PALETTE = ['#1A6BC4', '#0E8F86', '#6B4FD0', '#B3261E', '#E08A0B', '#137A45', '#14549B'];
  function pickColor(i) { return PALETTE[i % PALETTE.length]; }

  /* ------------------------------------------------------------
     File handling
     ------------------------------------------------------------ */
  /**
   * Add one or more files to the SAME workflow.
   * files: [{ meta:{name,size,type,simulated,sections}, columns:[], rows:[] }]
   */
  function addFiles(a, incoming) {
    var added = [];
    (incoming || []).forEach(function (f) {
      var entry = {
        id: U.uid('file'),
        name: uniqueFileName(a, f.meta.name),
        size: f.meta.size || 0, type: f.meta.type || '',
        uploadedAt: new Date().toISOString(),
        columns: f.columns, records: f.rows,
        recordCount: f.rows.length, columnCount: f.columns.length,
        simulated: !!f.meta.simulated,
        sections: f.meta.sections || null,
        seedPart: f.meta.seedPart || null
      };
      a.files.push(entry);
      added.push(entry);
      audit(a, {
        action: 'Data file uploaded',
        detail: entry.name + ' — ' + U.fmtInt(entry.recordCount) + ' records, ' + entry.columnCount + ' columns' +
          (entry.sections && entry.sections.length > 1 ? ' · ' + entry.sections.length + ' analyte sections' : ''),
        kind: 'info'
      });
    });
    afterDatasetChange(a, added.length + ' file(s) added to the dataset');
    return added;
  }

  function uniqueFileName(a, name) {
    var taken = (a.files || []).map(function (f) { return f.name; });
    if (taken.indexOf(name) === -1) return name;
    var base = name.replace(/(\.[^.]+)$/, ''), ext = (name.match(/(\.[^.]+)$/) || [''])[0];
    var n = 2;
    while (taken.indexOf(base + ' (' + n + ')' + ext) > -1) n++;
    return base + ' (' + n + ')' + ext;
  }

  /** Back-compat single-file entry point: replaces the whole dataset. */
  function attachFile(a, meta, columns, rows) {
    a.files = [];
    addFiles(a, [{ meta: meta, columns: columns, rows: rows }]);
    return a.file;
  }

  function removeFileById(a, id) {
    var f = (a.files || []).filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    a.files = a.files.filter(function (x) { return x.id !== id; });
    // drop corrections that belonged to this file
    Object.keys(a.dataEdits || {}).forEach(function (k) {
      if (k.indexOf(f.id + ':') === 0) delete a.dataEdits[k];
    });
    audit(a, { action: 'Data file removed', detail: f.name, kind: 'warn' });
    afterDatasetChange(a, 'File removed from the dataset');
  }

  function removeFile(a) {
    var names = (a.files || []).map(function (f) { return f.name; }).join(', ');
    a.files = []; a.file = null; a.fields = []; a.rules = []; a.fieldLogic = {}; a.ruleTest = null; a.dataEdits = {};
    a.selectedFields = [];
    a.analyteScope = { field: '', values: [], applied: false, detected: [] };
    a.classification = { field: '', control: '', calibration: '', patient: '', applied: false, counts: null, suggested: null };
    a.validation = { ranAt: null, controls: null, calibration: null, approved: false, approvedAt: null, approvedBy: null, approvedVersion: null };
    a.patientTesting = { unlocked: false, startedAt: null, completedAt: null, summary: null, summaryByAnalyte: null, results: [], resultsPartial: false };
    invalidateMergeCache(a);
    audit(a, { action: 'All data files removed', detail: names, kind: 'warn' });
    touch(a);
  }

  /** Shared post-processing whenever the uploaded dataset changes. */
  function afterDatasetChange(a, reason) {
    refreshFields(a);
    a.ruleTest = null;
    var recs = recordsOf(a);
    // keep the user's mapping if it still resolves against the new dataset
    var cls = a.classification;
    var stillValid = cls.applied && fieldNames(a).indexOf(cls.field) > -1;
    if (!stillValid) {
      a.classification = {
        field: '', control: '', calibration: '', patient: '', applied: false, counts: null,
        suggested: recs.length ? Seed.suggestClassification(a.fields, recs) : null
      };
    } else {
      cls.suggested = cls.suggested || Seed.suggestClassification(a.fields, recs);
      cls.counts = counts(a);
    }
    var scope = a.analyteScope;
    if (scope.applied && scope.field && fieldNames(a).indexOf(scope.field) === -1) {
      a.analyteScope = { field: '', values: [], applied: false, detected: [] };
    }
    if (a.selectedFields && a.selectedFields.length) {
      var names = fieldNames(a);
      a.selectedFields = a.selectedFields.filter(function (f) { return names.indexOf(f) > -1; });
    }
    if (a.validation.approved || a.validation.controls || a.validation.calibration) {
      invalidateApproval(a, reason || 'Uploaded dataset changed');
    }
    touch(a);
  }

  function applyClassification(a, map) {
    var prev = a.classification.applied
      ? a.classification.field + ': ' + [a.classification.control, a.classification.calibration, a.classification.patient].join(' / ')
      : null;
    var changed = prev && (map.field !== a.classification.field || map.control !== a.classification.control ||
      map.calibration !== a.classification.calibration || map.patient !== a.classification.patient);

    a.classification = Object.assign({}, a.classification, map, { applied: true });
    a.classification.counts = counts(a);
    audit(a, {
      action: prev ? 'Sample classification changed' : 'Sample classification applied',
      detail: map.field + ' → control "' + map.control + '", calibration "' + map.calibration + '", patient "' + map.patient + '"',
      prev: prev, next: map.field + ': ' + [map.control, map.calibration, map.patient].join(' / '),
      kind: prev ? 'warn' : 'info'
    });
    if (changed && S.settings.autoLockOnRuleChange) invalidateApproval(a, 'Sample classification changed');
    touch(a);
    return a.classification.counts;
  }

  /* ------------------------------------------------------------
     Rule mutations — each one runs the approval-invalidation policy
     ------------------------------------------------------------ */
  function addRule(a, rule, reason) {
    a.rules.push(rule);
    audit(a, {
      action: 'Rule created',
      detail: '[' + rule.field + '] ' + Rules.ruleLabel(rule) + ' — ' + Rules.describe(rule),
      next: Rules.describe(rule), reason: reason || '', kind: 'info'
    });
    afterRuleChange(a, 'Rule created for [' + rule.field + ']', reason);
    return rule;
  }

  function updateRule(a, id, patch, reason) {
    var r = a.rules.filter(function (x) { return x.id === id; })[0];
    if (!r) return null;
    var before = Rules.describe(r), beforeLabel = Rules.ruleLabel(r);
    Object.assign(r, patch);
    r.updatedAt = new Date().toISOString();
    audit(a, {
      action: 'Rule modified',
      detail: '[' + r.field + '] ' + beforeLabel + (Rules.ruleLabel(r) !== beforeLabel ? ' → ' + Rules.ruleLabel(r) : ''),
      prev: before, next: Rules.describe(r), reason: reason || '', kind: 'warn'
    });
    afterRuleChange(a, 'Rule modified for [' + r.field + ']', reason);
    return r;
  }

  function deleteRule(a, id, reason) {
    var r = a.rules.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    a.rules = a.rules.filter(function (x) { return x.id !== id; });
    audit(a, {
      action: 'Rule deleted', detail: '[' + r.field + '] ' + Rules.ruleLabel(r),
      prev: Rules.describe(r), reason: reason || '', kind: 'bad'
    });
    afterRuleChange(a, 'Rule deleted from [' + r.field + ']', reason);
  }

  function duplicateRule(a, id) {
    var r = a.rules.filter(function (x) { return x.id === id; })[0];
    if (!r) return null;
    var copy = U.clone(r);
    copy.id = U.uid('rule');
    copy.createdAt = new Date().toISOString();
    var at = a.rules.indexOf(r) + 1;
    a.rules.splice(at, 0, copy);
    audit(a, { action: 'Rule duplicated', detail: '[' + r.field + '] ' + Rules.ruleLabel(r), kind: 'info' });
    afterRuleChange(a, 'Rule duplicated on [' + r.field + ']');
    return copy;
  }

  function toggleRule(a, id) {
    var r = a.rules.filter(function (x) { return x.id === id; })[0];
    if (!r) return null;
    r.enabled = !r.enabled;
    audit(a, {
      action: r.enabled ? 'Rule enabled' : 'Rule disabled',
      detail: '[' + r.field + '] ' + Rules.ruleLabel(r), kind: 'warn'
    });
    afterRuleChange(a, (r.enabled ? 'Rule enabled' : 'Rule disabled') + ' on [' + r.field + ']');
    return r;
  }

  function reorderRules(a, orderedIds) {
    var map = {};
    a.rules.forEach(function (r) { map[r.id] = r; });
    var next = orderedIds.map(function (id) { return map[id]; }).filter(Boolean);
    a.rules.forEach(function (r) { if (next.indexOf(r) === -1) next.push(r); });
    a.rules = next;
    audit(a, { action: 'Rule order changed', detail: 'Evaluation order updated', kind: 'info' });
    touch(a);
  }

  function setFieldLogic(a, field, logic) {
    a.fieldLogic = a.fieldLogic || {};
    var prev = a.fieldLogic[field] || 'ALL';
    if (prev === logic) return;
    a.fieldLogic[field] = logic;
    audit(a, {
      action: 'Rule group logic changed', detail: '[' + field + '] conditions now require ' + logic,
      prev: prev + ' conditions', next: logic + ' conditions', kind: 'warn'
    });
    afterRuleChange(a, 'Group logic changed on [' + field + ']');
  }

  function afterRuleChange(a, reasonText, userReason) {
    a.ruleTest = null;
    if (S.settings.autoLockOnRuleChange) invalidateApproval(a, reasonText, { reason: userReason });
    touch(a);
  }

  /* ------------------------------------------------------------
     Validation runs
     ------------------------------------------------------------ */
  function runQCValidation(a) {
    var g = groups(a);
    var ctx = ctxOf(a);
    var rules = activeRules(a);
    var ctl = Rules.runSet(g.control, 'control', rules, ctx);
    var cal = Rules.runSet(g.calibration, 'calibration', rules, ctx);
    a.validation.controls = summarize(ctl);
    a.validation.calibration = summarize(cal);
    a.validation.ranAt = new Date().toISOString();
    var pass = validationPassed(a);
    audit(a, {
      action: pass ? 'Control & Calibration validation passed' : 'Control & Calibration validation failed',
      detail: 'Controls ' + ctl.passed + '/' + ctl.total + ' passed · Calibration ' + cal.passed + '/' + cal.total + ' passed',
      kind: pass ? 'ok' : 'bad'
    });
    if (!pass && S.settings.notifyOnFailure) {
      notify({
        kind: 'error', title: a.name + ' — QC validation failed',
        text: (ctl.failed + cal.failed) + ' QC sample(s) failed on configuration v' + a.version + '. Patient testing stays locked.',
        analyticId: a.id
      });
    }
    touch(a);
    return { controls: ctl, calibration: cal, passed: pass };
  }

  function summarize(res) {
    return {
      total: res.total, passed: res.passed, failed: res.failed, warning: res.warning,
      rows: res.rows.map(function (r) {
        return {
          index: r.record.__i !== undefined ? r.record.__i : r.index,
          fid: r.record.__fid, row: r.record.__row, src: r.record.__src,
          status: r.status,
          failures: r.failures, warnings: r.warnings
        };
      })
    };
  }

  function approve(a, note) {
    if (!validationPassed(a)) return false;
    a.validation.approved = true;
    a.validation.approvedAt = new Date().toISOString();
    a.validation.approvedBy = (S.user && S.user.name) || DEMO_USER.name;
    a.validation.approvedVersion = a.version;
    a.patientTesting.unlocked = true;
    a.status = 'active';
    archiveCurrentVersion(a, 'Active');
    a.versions.forEach(function (v) { if (v.version !== a.version && v.status === 'Active') v.status = 'Archived'; });
    audit(a, {
      action: 'Validation approved',
      detail: 'Configuration v' + a.version + ' approved — patient testing unlocked',
      reason: note || '', kind: 'ok'
    });
    if (S.settings.notifyOnApproval) {
      notify({
        kind: 'success', title: a.name + ' — validation approved',
        text: 'Configuration v' + a.version + ' signed off. Patient testing is now unlocked.', analyticId: a.id
      });
    }
    touch(a);
    return true;
  }

  /** Correct one value on one record. `rec` is a merged record (carries its source file). */
  function correctData(a, rec, field, value, reason) {
    a.dataEdits = a.dataEdits || {};
    var key = rec.__fid + ':' + rec.__row;
    var edits = a.dataEdits[key] || {};
    var source = sourceRecord(a, rec) || {};
    var prev = source[field];
    edits[field] = value;
    a.dataEdits[key] = edits;
    a.editVersion = (a.editVersion || 0) + 1;
    invalidateMergeCache(a);
    audit(a, {
      action: 'Sample data corrected',
      detail: (rec.__src ? rec.__src + ' · ' : '') + 'row ' + (rec.__row + 1) + ' · [' + field + ']',
      prev: String(prev), next: String(value), reason: reason || '', kind: 'warn'
    });
    touch(a);
  }

  function runPatientTesting(a) {
    var g = groups(a);
    var ctx = ctxOf(a);
    var res = Rules.runSet(g.patient, 'patient', activeRules(a), ctx);
    a.patientTesting.results = res.rows.map(function (r) {
      return {
        index: r.record.__i, fid: r.record.__fid, row: r.record.__row, src: r.record.__src,
        status: r.status, failures: r.failures, warnings: r.warnings
      };
    });
    a.patientTesting.resultsPartial = false;
    a.patientTesting.summary = { total: res.total, passed: res.passed, failed: res.failed, warning: res.warning };
    a.patientTesting.summaryByAnalyte = breakdownByAnalyte(a, res.rows);
    a.patientTesting.completedAt = new Date().toISOString();
    a.patientTesting.configVersion = a.version;
    audit(a, {
      action: 'Patient testing completed',
      detail: U.fmtInt(res.total) + ' samples tested — ' + U.fmtInt(res.passed) + ' passed, ' +
        U.fmtInt(res.failed) + ' failed, ' + U.fmtInt(res.warning) + ' warning',
      kind: res.failed ? 'warn' : 'ok'
    });
    var v = a.versions.filter(function (x) { return x.version === a.version; })[0];
    if (v) v.patientTests = res.total;
    touch(a);
    return a.patientTesting.summary;
  }

  function runRuleTest(a) {
    var g = groups(a);
    var ctx = ctxOf(a);
    var rules = activeRules(a);
    var out = { total: 0, passed: 0, failed: 0, warning: 0, byScope: {}, failedRows: [] };
    [['control', g.control], ['calibration', g.calibration], ['patient', g.patient]].forEach(function (pair) {
      var res = Rules.runSet(pair[1], pair[0], rules, ctx);
      out.byScope[pair[0]] = { total: res.total, passed: res.passed, failed: res.failed, warning: res.warning };
      out.total += res.total; out.passed += res.passed; out.failed += res.failed; out.warning += res.warning;
      res.rows.forEach(function (r) {
        if (r.status !== 'pass' && out.failedRows.length < 500) {
          out.failedRows.push({
            index: r.record.__i, src: r.record.__src, scope: pair[0], status: r.status,
            failures: r.failures, warnings: r.warnings
          });
        }
      });
    });
    out.ranAt = new Date().toISOString();
    out.ruleCount = rules.length;
    a.ruleTest = out;
    audit(a, {
      action: 'Rules tested against sample data',
      detail: U.fmtInt(out.total) + ' records · ' + U.fmtInt(out.passed) + ' passed, ' +
        U.fmtInt(out.failed) + ' failed, ' + U.fmtInt(out.warning) + ' warning',
      kind: out.failed ? 'warn' : 'ok'
    });
    touch(a);
    return out;
  }

  /** Pass/fail split per analytic value (files may hold several analytics). */
  function breakdownByAnalyte(a, rows) {
    var field = a.analyteScope && a.analyteScope.field;
    if (!field) return null;
    var out = {};
    rows.forEach(function (r) {
      var key = U.isBlank(r.record[field]) ? '—' : String(r.record[field]).trim();
      var o = out[key] = out[key] || { total: 0, passed: 0, failed: 0, warning: 0 };
      o.total++;
      if (r.status === 'pass') o.passed++;
      else if (r.status === 'fail') o.failed++;
      else o.warning++;
    });
    return out;
  }

  /* ------------------------------------------------------------
     FAILED RECORDS ONLY — there is deliberately no "passed" export.
     Passed records stay part of the original uploaded dataset.
     ------------------------------------------------------------ */
  var FAIL_META = ['Analytics', 'Sample Type', 'Source File', 'Failed Field', 'Failed Rule',
    'Failure Reason', 'Severity', 'Validation Timestamp'];

  /**
   * Build the failed-record extract.
   * scope: 'qc' (control + calibration) or 'patient'
   * → { columns, rows, recordCount, failureCount }
   */
  function failedRecords(a, scope) {
    var recs = recordsOf(a);
    var cols = selectedFields(a);
    var stamp = new Date().toISOString();
    var sets = [];
    if (scope === 'patient') {
      sets.push({ kind: 'patient', rows: (a.patientTesting.results || []), ranAt: a.patientTesting.completedAt });
    } else {
      if (a.validation.controls) sets.push({ kind: 'control', rows: a.validation.controls.rows || [], ranAt: a.validation.ranAt });
      if (a.validation.calibration) sets.push({ kind: 'calibration', rows: a.validation.calibration.rows || [], ranAt: a.validation.ranAt });
    }

    var out = [], recordIds = {};
    sets.forEach(function (set) {
      set.rows.forEach(function (r) {
        if (r.status === 'pass') return;                    // failed (and flagged) records only
        var rec = recs[r.index] || {};
        recordIds[r.index] = 1;
        var issues = (r.failures || []).concat(r.warnings || []);
        if (!issues.length) return;
        issues.forEach(function (f) {
          var line = {};
          cols.forEach(function (c) { line[c] = rec[c] === undefined ? '' : rec[c]; });
          line['Analytics'] = a.analyteScope.field ? (rec[a.analyteScope.field] || a.name) : a.name;
          line['Sample Type'] = U.titleCase(set.kind);
          line['Source File'] = r.src || rec.__src || '';
          line['Failed Field'] = f.field;
          line['Failed Rule'] = f.rule + (f.description ? ' (' + f.description + ')' : '');
          line['Failure Reason'] = f.message;
          line['Severity'] = f.severity === 'warning' ? 'Warning' : 'Error';
          line['Validation Timestamp'] = U.fmtDateTime(set.ranAt || stamp);
          out.push(line);
        });
      });
    });

    return {
      columns: cols.concat(FAIL_META),
      rows: out,
      recordCount: Object.keys(recordIds).length,
      failureCount: out.length
    };
  }

  function failedFileName(a, scope) {
    var base = (a.code || a.name || 'analytic').replace(/[^A-Za-z0-9]+/g, '_');
    return base + (scope === 'patient' ? '_Patient_Failed_v' : '_QC_Failed_v') + a.version + '.csv';
  }

  /* ------------------------------------------------------------
     Demo bootstrap — builds the catalogue at the documented stages
     ------------------------------------------------------------ */
  function daysAgo(n, h, m) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    if (h !== undefined) d.setHours(h, m || 0, 0, 0);
    return d.toISOString();
  }

  function bootstrap() {
    S.analytics = Seed.CATALOG.map(function (spec, i) {
      var a = blankAnalytic({
        id: spec.id, name: spec.name, code: spec.code, description: spec.description,
        color: spec.color, version: spec.version, seed: { catalogId: spec.id },
        createdAt: daysAgo(60 - i * 5, 9, 15), updatedAt: daysAgo(3, 11, 20)
      });
      hydrateStage(a, spec);
      return a;
    });
    S.activityLog.sort(function (x, y) { return new Date(y.ts) - new Date(x.ts); });
    save();
  }

  /** Build a seeded analytic up to its documented workflow stage. */
  function hydrateStage(a, spec) {
    if (spec.stage === 'draft') {
      a.status = 'draft';
      pushAudit(a, daysAgo(21, 10, 5), { action: 'Analytic created', detail: a.name + ' (' + a.code + ')', kind: 'info' });
      return;
    }

    // 1. files — the demo splits some catalogues over several run files
    var parts = spec.gen.parts || [null];
    a.files = parts.map(function (part, i) {
      var ds = Seed.generateDataset(spec.gen, spec.seedNo + i * 17, part);
      var name = parts.length > 1
        ? spec.gen.file.replace(/(\.[^.]+)$/, '_run' + (i + 1) + '$1')
        : spec.gen.file;
      return {
        id: 'seedfile_' + a.id + '_' + i, name: name,
        size: ds.rows.length * (ds.columns.length * 8) + 400, type: 'text/csv',
        uploadedAt: daysAgo(9, 9, 40 + i * 6), columns: ds.columns, records: ds.rows,
        recordCount: ds.rows.length, columnCount: ds.columns.length, simulated: false, seedPart: part
      };
    });
    refreshFields(a);
    pushAudit(a, daysAgo(21, 10, 5), { action: 'Analytic created', detail: a.name + ' (' + a.code + ')', kind: 'info' });
    a.files.forEach(function (f, i) {
      pushAudit(a, daysAgo(9, 9, 40 + i * 6), {
        action: 'Data file uploaded',
        detail: f.name + ' — ' + U.fmtInt(f.recordCount) + ' records, ' + f.columnCount + ' columns', kind: 'info'
      });
    });

    // 2. analytics present in the files
    var det = detectAnalytes(a);
    if (det) {
      var mine = det.options.filter(function (o) {
        var t = o.value.toLowerCase();
        return (spec.gen.analyte || '').toLowerCase() === t;
      });
      a.analyteScope = {
        field: det.field,
        values: (mine.length ? mine : det.options.slice(0, 1)).map(function (o) { return o.value; }),
        applied: true, detected: det.options
      };
      pushAudit(a, daysAgo(9, 9, 48), {
        action: 'Analytics selection applied',
        detail: 'Records limited to ' + det.field + ': ' + a.analyteScope.values.join(', '), kind: 'info'
      });
    } else {
      a.analyteScope = { field: '', values: [], applied: true, detected: [] };
    }

    // 3. classification
    var allRecs = recordsOf(a);
    var cls = Seed.suggestClassification(a.fields, allRecs) || { field: '', control: '', calibration: '', patient: '' };
    a.classification = Object.assign({}, cls, { applied: true, suggested: cls });
    a.classification.counts = counts(a);
    pushAudit(a, daysAgo(9, 9, 52), {
      action: 'Sample classification applied',
      detail: cls.field + ' → control "' + cls.control + '", calibration "' + cls.calibration + '", patient "' + cls.patient + '"',
      kind: 'info'
    });

    // 4. fields chosen for validation (the analytics column itself is informational)
    a.selectedFields = fieldNames(a).filter(function (f) {
      return !a.analyteScope.field || f !== a.analyteScope.field;
    });
    pushAudit(a, daysAgo(9, 10, 2), {
      action: 'Validation fields selected',
      detail: a.selectedFields.length + ' of ' + a.fields.length + ' detected fields selected for validation', kind: 'info'
    });

    // 5. rules
    var scoped = scopedRecords(a);
    var sug = Seed.suggestRules(a.fields.filter(function (f) { return a.selectedFields.indexOf(f.name) > -1; }), scoped, cls);
    a.rules = sug.rules;
    a.fieldLogic = {};
    pushAudit(a, daysAgo(9, 10, 12), {
      action: 'Validation rules configured',
      detail: a.rules.length + ' rules across ' + a.selectedFields.length + ' selected fields', kind: 'info'
    });

    if (spec.stage === 'rules_ready') { a.status = 'draft'; return; }

    // 6. first QC run (fails by construction — the generator injects QC drift)
    var first = runQCValidationQuiet(a, daysAgo(8, 14, 30));
    pushAudit(a, daysAgo(8, 14, 30), {
      action: 'Control & Calibration validation failed',
      detail: 'Controls ' + first.controls.passed + '/' + first.controls.total + ' passed · Calibration ' +
        first.calibration.passed + '/' + first.calibration.total + ' passed', kind: 'bad'
    });

    if (spec.stage === 'control_failed') {
      a.status = 'locked';
      a.versions = [{
        version: a.version, rulesVersion: a.version, ruleCount: a.rules.length,
        controls: first.controls.failed ? 'Failed' : 'Passed',
        calibration: first.calibration.failed ? 'Failed' : 'Passed',
        patientTests: null, status: 'Failed', createdAt: daysAgo(8, 14, 30)
      }];
      return;
    }

    // 7. correction of the drifting QC samples, then a passing re-test
    var g = groups(a);
    var mergedNow = recordsOf(a);
    var failedRows = [];
    (a.validation.controls.rows || []).concat(a.validation.calibration.rows || []).forEach(function (r) {
      if (r.status === 'fail') failedRows.push(r);
    });
    failedRows.forEach(function (r) {
      var rec = mergedNow[r.index];
      var resultField = sug.resultField, refField = sug.referenceField;
      if (!rec || !resultField || !refField) return;
      var target = U.toNumber(rec[refField]);
      var dp = U.decimalsOf(rec[resultField]);
      var corrected = (target * 1.008).toFixed(dp);
      a.dataEdits[rec.__fid + ':' + rec.__row] = {};
      a.dataEdits[rec.__fid + ':' + rec.__row][resultField] = corrected;
      a.editVersion = (a.editVersion || 0) + 1;
      pushAudit(a, daysAgo(8, 15, 5), {
        action: 'Sample data corrected',
        detail: rec.__src + ' · row ' + (rec.__row + 1) + ' · [' + resultField + '] on sample ' +
          (rec[a.fields[0].name] || ''),
        prev: String(rec[resultField]), next: corrected,
        reason: 'Instrument recalibrated and QC material re-run', kind: 'warn'
      });
    });
    invalidateMergeCache(a);
    var second = runQCValidationQuiet(a, daysAgo(8, 15, 20));
    pushAudit(a, daysAgo(8, 15, 20), {
      action: 'Control & Calibration re-test passed',
      detail: 'Controls ' + second.controls.passed + '/' + second.controls.total + ' passed · Calibration ' +
        second.calibration.passed + '/' + second.calibration.total + ' passed', kind: 'ok'
    });

    // 8. approval + patient run history
    var prevVersion = '1.' + Math.max(0, (parseInt(String(a.version).split('.')[1], 10) || 1) - 1);
    a.versions = [
      {
        version: prevVersion, rulesVersion: prevVersion, ruleCount: Math.max(1, a.rules.length - 2),
        controls: 'Passed', calibration: 'Passed',
        patientTests: Math.round(g.patient.length * 0.74), status: 'Archived',
        approvedAt: daysAgo(30, 12, 0), createdAt: daysAgo(34, 9, 0)
      },
      {
        version: '1.0', rulesVersion: '1.0', ruleCount: Math.max(1, a.rules.length - 5),
        controls: 'Failed', calibration: 'Failed', patientTests: null, status: 'Failed',
        createdAt: daysAgo(48, 15, 30)
      }
    ];
    a.validation.approved = true;
    a.validation.approvedAt = daysAgo(8, 15, 45);
    a.validation.approvedBy = DEMO_USER.name;
    a.validation.approvedVersion = a.version;
    a.patientTesting.unlocked = true;
    pushAudit(a, daysAgo(8, 15, 45), {
      action: 'Validation approved',
      detail: 'Configuration v' + a.version + ' approved — patient testing unlocked',
      reason: 'QC within acceptance limits after recalibration', kind: 'ok'
    });

    if (spec.stage === 'revalidation') {
      // an approved configuration whose rules were later edited → locked again
      var target = a.rules.filter(function (r) { return r.type === 'between' && r.scope.indexOf('patient') > -1 && r.severity === 'error'; })[0];
      var before = target ? Rules.describe(target) : '—';
      if (target) target.params.max = Number((U.toNumber(target.params.max) * 1.1).toFixed(2));
      archiveCurrentVersion(a, 'Archived');
      pushAudit(a, daysAgo(2, 10, 42), {
        action: 'Rule modified',
        detail: target ? '[' + target.field + '] Between' : 'Rule updated',
        prev: before, next: target ? Rules.describe(target) : '—',
        reason: 'Analytical measuring range extended after method verification', kind: 'warn'
      });
      var oldV = a.version;
      a.version = bumpVersion(a.version);
      a.validation = { ranAt: null, controls: null, calibration: null, approved: false, approvedAt: null, approvedBy: null, approvedVersion: null };
      a.patientTesting = { unlocked: false, startedAt: null, completedAt: null, summary: null, results: [], resultsPartial: false };
      a.status = 'validation';
      pushAudit(a, daysAgo(2, 10, 42), {
        action: 'Configuration version created', detail: 'Rule change requires QC revalidation',
        prev: 'v' + oldV, next: 'v' + a.version, kind: 'warn'
      });
      pushAudit(a, daysAgo(2, 10, 42), {
        action: 'Approval invalidated',
        detail: 'Patient testing re-locked — Control & Calibration validation must be repeated for v' + a.version, kind: 'bad'
      });
      return;
    }

    // approved stage → patient testing already completed
    var res = Rules.runSet(groups(a).patient, 'patient', activeRules(a), ctxOf(a));
    a.patientTesting.results = res.rows.map(function (r) {
      return {
        index: r.record.__i, fid: r.record.__fid, row: r.record.__row, src: r.record.__src,
        status: r.status, failures: r.failures, warnings: r.warnings
      };
    });
    a.patientTesting.summary = { total: res.total, passed: res.passed, failed: res.failed, warning: res.warning };
    a.patientTesting.summaryByAnalyte = breakdownByAnalyte(a, res.rows);
    a.patientTesting.startedAt = daysAgo(8, 16, 0);
    a.patientTesting.completedAt = daysAgo(8, 16, 12);
    a.patientTesting.configVersion = a.version;
    a.status = 'active';
    archiveCurrentVersion(a, 'Active');
    pushAudit(a, daysAgo(8, 16, 0), { action: 'Patient testing started', detail: U.fmtInt(res.total) + ' patient samples queued', kind: 'info' });
    pushAudit(a, daysAgo(8, 16, 12), {
      action: 'Patient testing completed',
      detail: U.fmtInt(res.total) + ' samples tested — ' + U.fmtInt(res.passed) + ' passed, ' +
        U.fmtInt(res.failed) + ' failed, ' + U.fmtInt(res.warning) + ' warning', kind: 'ok'
    });
  }

  function runQCValidationQuiet(a, ts) {
    var g = groups(a), ctx = ctxOf(a), rules = activeRules(a);
    var ctl = Rules.runSet(g.control, 'control', rules, ctx);
    var cal = Rules.runSet(g.calibration, 'calibration', rules, ctx);
    a.validation.controls = summarize(ctl);
    a.validation.calibration = summarize(cal);
    a.validation.ranAt = ts || new Date().toISOString();
    return { controls: ctl, calibration: cal };
  }

  function pushAudit(a, ts, e) {
    var entry = Object.assign({
      id: U.uid('ev'), ts: ts, user: DEMO_USER.name,
      analyticId: a.id, analyticName: a.name, version: a.version,
      kind: 'info', action: '', detail: '', prev: null, next: null, reason: ''
    }, e);
    a.audit.unshift(entry);
    S.activityLog.push(entry);
    return entry;
  }

  /* ------------------------------------------------------------
     Auth
     ------------------------------------------------------------ */
  function login(email, password) {
    if (String(email).trim().toLowerCase() !== CREDENTIALS.email || password !== CREDENTIALS.password) {
      return { ok: false, error: 'Invalid credentials. Use the prototype account shown below.' };
    }
    S.user = Object.assign({}, DEMO_USER);
    S.loggedIn = true;
    audit(null, { action: 'User signed in', detail: DEMO_USER.email, kind: 'info', analyticName: 'Platform' });
    save();
    return { ok: true, user: S.user };
  }
  function logout() {
    audit(null, { action: 'User signed out', detail: (S.user && S.user.email) || '', kind: 'info', analyticName: 'Platform' });
    S.loggedIn = false;
    save();
  }

  function init() {
    var restored = load();
    if (!restored) { bootstrap(); }
    if (!S.user) S.user = Object.assign({}, DEMO_USER);
    if (!S.notifications.length) seedNotifications();
    return S;
  }

  function seedNotifications() {
    var locked = S.analytics.filter(function (a) { return statusOf(a) === 'locked'; })[0];
    var reval = S.analytics.filter(function (a) { return stateOf(a) === STATES.RULES_CONFIGURED && a.versions.length; })[0];
    var active = S.analytics.filter(function (a) { return statusOf(a) === 'active'; })[0];
    if (locked) {
      notify({
        kind: 'error', title: locked.name + ' — QC validation failed', analyticId: locked.id,
        text: 'Control and calibration acceptance limits not met. Patient testing is locked.'
      });
    }
    if (reval) {
      notify({
        kind: 'warn', title: reval.name + ' — revalidation required', analyticId: reval.id,
        text: 'Rule configuration changed to v' + reval.version + '. Re-run control & calibration validation.'
      });
    }
    if (active) {
      notify({
        kind: 'success', title: active.name + ' — validation approved', analyticId: active.id,
        text: 'Configuration v' + active.version + ' is active and patient testing is unlocked.'
      });
    }
    S.notifications.forEach(function (n, i) { if (i > 0) n.read = true; });
    save();
  }

  /* ------------------------------------------------------------
     Aggregates for dashboards / reports
     ------------------------------------------------------------ */
  function overview() {
    var o = {
      total: S.analytics.length, active: 0, draft: 0, locked: 0, validation: 0,
      patientsTested: 0, patientsPassed: 0, patientsFailed: 0, patientsWarning: 0,
      qcSamples: 0, qcFailed: 0, awaitingApproval: 0, lockedNames: []
    };
    S.analytics.forEach(function (a) {
      var s = statusOf(a);
      o[s] = (o[s] || 0) + 1;
      if (s === 'locked') o.lockedNames.push(a.name);
      if (stateOf(a) === STATES.VALIDATION_PASSED) o.awaitingApproval++;
      var pt = a.patientTesting.summary;
      if (pt) {
        o.patientsTested += pt.total; o.patientsPassed += pt.passed;
        o.patientsFailed += pt.failed; o.patientsWarning += pt.warning;
      }
      ['controls', 'calibration'].forEach(function (k) {
        var v = a.validation[k];
        if (v) { o.qcSamples += v.total; o.qcFailed += v.failed; }
      });
    });
    o.passRate = o.patientsTested ? (o.patientsPassed / o.patientsTested) * 100 : null;
    return o;
  }

  global.Store = {
    S: S, STATES: STATES, STEPS: STEPS, STATUS_META: STATUS_META, CREDENTIALS: CREDENTIALS,
    init: init, save: save, reset: reset, bootstrap: bootstrap,
    login: login, logout: logout,
    all: all, get: get, create: create, remove: remove,
    blankAnalytic: blankAnalytic, attachFile: attachFile, removeFile: removeFile,
    addFiles: addFiles, removeFileById: removeFileById, filesOf: filesOf, hasData: hasData,
    columnsOf: columnsOf, refreshFields: refreshFields, sourceRecord: sourceRecord,
    recordsOf: recordsOf, scopedRecords: scopedRecords, fieldNames: fieldNames, ctxOf: ctxOf,
    groups: groups, counts: counts,
    selectedFields: selectedFields, fieldsConfirmed: fieldsConfirmed, isFieldSelected: isFieldSelected,
    setSelectedFields: setSelectedFields, activeRules: activeRules,
    detectAnalytes: detectAnalytes, analyticsByFile: analyticsByFile, applyAnalyteScope: applyAnalyteScope,
    failedRecords: failedRecords, failedFileName: failedFileName, FAIL_META: FAIL_META,
    stateOf: stateOf, stepStates: stepStates, statusOf: statusOf,
    validationPassed: validationPassed, patientUnlocked: patientUnlocked,
    applyClassification: applyClassification,
    addRule: addRule, updateRule: updateRule, deleteRule: deleteRule,
    duplicateRule: duplicateRule, toggleRule: toggleRule, reorderRules: reorderRules,
    setFieldLogic: setFieldLogic,
    runQCValidation: runQCValidation, runRuleTest: runRuleTest, runPatientTesting: runPatientTesting,
    approve: approve, correctData: correctData,
    invalidateApproval: invalidateApproval, bumpVersion: bumpVersion, archiveCurrentVersion: archiveCurrentVersion,
    audit: audit, notify: notify, unreadCount: unreadCount, markAllRead: markAllRead,
    overview: overview
  };
}(typeof window !== 'undefined' ? window : this));
