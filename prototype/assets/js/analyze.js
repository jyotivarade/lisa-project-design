/* ============================================================
   analyze.js — turn ONE uploaded file into ONE analytics report.

       Uploaded file → classify rows → run criteria → report

   Everything here is derived from the file itself: the sample streams
   come from the file's own Sample ID / Sample Type values, the criteria
   columns are matched against the file's own headers, and the limits
   (cut-off, ion-ratio range, RT window, calibrated range) are computed
   from the calibrators and controls that file happens to contain.

   There is no configuration screen and no per-analytic setup — an upload
   is processed the moment it arrives, and its report never changes
   afterwards. A later upload produces its own separate report.
   ============================================================ */
(function (global) {
  'use strict';

  /* Fixed assay defaults. LISA thresholds live in Criteria.defaultConfig();
     these are the few values the criteria read from the analyte instead. */
  var ASSAY_DEFAULTS = {
    referenceRatioAdjustment: 10,   // % the calibrator ion-ratio range is widened by
    cutoffMode: 'wcs1',             // cut-off read from the WCS1 control row
    cutoffSampleId: 'WCS1',
    ignoreZeroRatios: true,
    criteriaVersion: '1.0'
  };

  /* ------------------------------------------------------------
     Sample streams — read from the file, never configured.
     ------------------------------------------------------------ */
  var STREAM_PATTERNS = {
    calibrator: { type: /standard|calib|^std$/i, id: /^cal[_\-\s]?\d+$/i },
    control: { type: /control|^qc$/i, id: /^(wsc|wcs|uc)/i },
    patient: { type: /unknown|patient|specimen/i, id: /^\d+$/ }
  };
  var STREAM_ORDER = ['calibrator', 'control', 'patient'];

  var STREAM_LABEL = {
    calibrator: 'Calibrator', control: 'Control',
    patient: 'Patient', unmatched: 'Unclassified'
  };

  /** Which stream does this row belong to? */
  function streamOf(row, idCol, typeCol) {
    var id = idCol ? String(row[idCol] === undefined ? '' : row[idCol]).trim() : '';
    var type = typeCol ? String(row[typeCol] === undefined ? '' : row[typeCol]).trim() : '';
    for (var i = 0; i < STREAM_ORDER.length; i++) {
      var key = STREAM_ORDER[i], p = STREAM_PATTERNS[key];
      if (type && p.type.test(type)) return key;
      if (id && p.id.test(id)) return key;
    }
    return 'unmatched';
  }

  /* ------------------------------------------------------------
     Column profile — the part of the report that works for ANY file,
     including one the LISA criteria cannot read.
     ------------------------------------------------------------ */
  function profileColumns(columns, rows) {
    var described = U.describeFields(columns, rows);
    return described.map(function (f) {
      var populated = rows.length - f.blanks;
      var entry = {
        name: f.name, type: f.type,
        populated: populated,
        coverage: rows.length ? populated / rows.length : 0,
        blanks: f.blanks,
        distinctCount: f.distinctCount,
        sample: f.distinct.slice(0, 4),
        min: f.min, max: f.max, mean: null
      };
      if (f.type === 'number') {
        var nums = rows.map(function (r) { return U.toNumber(r[f.name]); })
          .filter(function (v) { return !isNaN(v); });
        if (nums.length) entry.mean = U.sum(nums) / nums.length;
      }
      return entry;
    });
  }

  /* ------------------------------------------------------------
     The report
     ------------------------------------------------------------ */
  /**
   * run({name, columns, rows}) → report
   * Pure: it reads the file and returns the analytics, touching nothing else.
   */
  function run(file) {
    var started = Date.now();
    var columns = file.columns || [];
    var rows = file.rows || [];
    var fields = U.describeFields(columns, rows);
    var map = Criteria.autoMap(fields);
    var criteria = Criteria.defaultConfig();
    var assay = Object.assign({}, ASSAY_DEFAULTS, { analyteName: file.analyte || '', assayName: file.analyte || '' });

    /* 1 — classify every row */
    var streams = { calibrator: [], control: [], patient: [], unmatched: [] };
    var streamByRow = [];
    rows.forEach(function (r, i) {
      var s = streamOf(r, map.sampleId, map.sampleType);
      streamByRow[i] = s;
      streams[s].push(r);
    });

    /* 2 — derive this file's own limits from its calibrators and controls */
    var derived = Criteria.applyRtWindow(Criteria.derive(streams, map, assay), criteria);
    var ctx = { map: map, streams: streams, derived: derived, assay: assay };

    /* 3 — run the criteria row by row */
    var indexOfRow = new Map();
    rows.forEach(function (r, i) { indexOfRow.set(r, i); });
    var res = Criteria.process(rows, function (row) {
      return streamByRow[indexOfRow.get(row)] || 'unmatched';
    }, criteria, ctx);

    /* 4 — shape the report.
       Only rows with a finding are listed: everything else passed, and a
       full per-row copy would double the size of the stored report. */
    var idCol = map.sampleId;
    var exceptions = [];
    res.rows.forEach(function (r) {
      if (r.status === 'pass' || r.status === 'not-evaluated') return;
      var i = indexOfRow.get(r.row);
      exceptions.push({
        i: i,
        id: idCol && r.row[idCol] !== undefined ? String(r.row[idCol]) : String(i + 1),
        stream: r.stream,
        status: r.status,
        issues: r.failures.map(function (f) { return issue(f, 'Fail'); })
          .concat(r.warnings.map(function (f) { return issue(f, 'Warning'); }))
      });
    });

    return {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      criteriaVersion: assay.criteriaVersion,
      total: res.total, passed: res.passed, failed: res.failed, warnings: res.warnings,
      notEvaluated: res.notEvaluated,
      streamCounts: {
        calibrator: streams.calibrator.length, control: streams.control.length,
        patient: streams.patient.length, unmatched: streams.unmatched.length
      },
      idColumn: idCol || null,
      typeColumn: map.sampleType || null,
      columnMap: map,
      notMapped: res.notMapped,
      derived: derived,
      byCriterion: res.byCriterion,
      criteriaApplied: criteria.filter(function (c) { return c.enabled; }).map(function (c) {
        var d = Criteria.def(c.key);
        return {
          key: c.key, name: d ? d.name : c.key, stream: d ? d.stream : '',
          column: map[c.role] || null,
          rule: Criteria.describe(c, ctx)
        };
      }),
      profile: profileColumns(columns, rows),
      exceptions: exceptions
    };
  }

  /** Re-derive a stored report's stream for one row — cheaper than storing
      a stream for every row that passed. */
  function streamFor(report, row) {
    return streamOf(row, report.idColumn, report.typeColumn);
  }

  function issue(f, severity) {
    return {
      criterion: f.criterion, name: f.name, column: f.column, stream: f.stream,
      reason: f.reason, actual: f.actual, min: f.min, max: f.max,
      expected: f.expected, severity: severity
    };
  }

  /** Did the criteria find anything to read in this file? */
  function isReadable(report) {
    return !!report && report.criteriaApplied.some(function (c) { return !!c.column; }) &&
      (report.streamCounts.calibrator + report.streamCounts.control + report.streamCounts.patient) > 0;
  }

  global.Analyze = {
    run: run, streamFor: streamFor,
    isReadable: isReadable,
    streamLabel: function (s) { return STREAM_LABEL[s] || U.titleCase(s || ''); },
    STREAM_LABEL: STREAM_LABEL,
    ASSAY_DEFAULTS: ASSAY_DEFAULTS
  };
}(typeof window !== 'undefined' ? window : this));
