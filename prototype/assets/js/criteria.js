/* ============================================================
   criteria.js — LISA Criteria Module.

   Row-by-row processing engine:

       CSV → Row Parser → Criteria Module → PASS / FAIL → Output

   Every criterion declares which sample stream it applies to, which
   column it reads, its operator and its threshold. Columns are MAPPED
   to whatever the uploaded file actually contains (auto-detected, then
   user-overridable) and thresholds live in the analyte configuration —
   nothing is hardcoded per analyte.
   ============================================================ */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------
     Column roles the criteria need. Each role is auto-mapped to a real
     uploaded column by matching patterns, and can be re-pointed by the
     user at any column in the file.
     ------------------------------------------------------------ */
  var ROLES = [
    { key: 'sampleId', label: 'Sample ID', match: [/^sample\s*id$/i, /sample\s*name/i, /^id$/i], type: 'text' },
    { key: 'sampleType', label: 'Sample Type', match: [/^sample\s*type$/i, /^type$/i], type: 'text' },
    { key: 'percentDiff', label: '% Diff', match: [/%\s*diff/i, /percent.*diff/i, /\bdiff\b/i], type: 'number' },
    { key: 'istdArea', label: 'ISTD Area', match: [/istd\s*area/i, /internal\s*standard.*area/i, /^istd$/i], type: 'number' },
    { key: 'recovery', label: '% Recovery', match: [/^%?\s*recovery/i, /recovery\s*%/i], type: 'number' },
    { key: 'avgRecovery', label: 'Average % Recovery', match: [/average.*recovery/i, /avg.*recovery/i, /mean.*recovery/i], type: 'number' },
    { key: 'concentration', label: 'Conc. (ng/mL)', match: [/^conc/i, /concentration/i], type: 'number', exclude: [/std/i, /standard/i] },
    { key: 'stdConcentration', label: 'Std. Conc. (ng/mL)', match: [/std\.?\s*conc/i, /standard\s*conc/i, /nominal/i], type: 'number' },
    { key: 'ionRatio', label: 'Ref 1 Actual Ratio', match: [/actual\s*ratio/i, /ion\s*ratio/i, /ratio/i], type: 'number', exclude: [/set\s*ratio/i] },
    { key: 'retentionTime', label: 'Found RT', match: [/found\s*rt/i, /retention\s*time/i, /\brt\b/i], type: 'number' }
  ];

  /** Auto-map roles onto the columns present in the analytic's fields. */
  function autoMap(fields) {
    var map = {};
    ROLES.forEach(function (role) {
      var hit = null;
      role.match.some(function (re) {
        var candidates = fields.filter(function (f) {
          if (role.exclude && role.exclude.some(function (ex) { return ex.test(f.name); })) return false;
          if (!re.test(f.name)) return false;
          if (role.type === 'number' && f.type !== 'number') return false;
          return true;
        });
        if (candidates.length) { hit = candidates[0].name; return true; }
        return false;
      });
      map[role.key] = hit;
    });
    return map;
  }

  var OPERATORS = [
    { key: 'gt', label: 'Greater Than', symbol: '>', test: function (v, t) { return v > t; } },
    { key: 'gte', label: 'Greater Than or Equal', symbol: '≥', test: function (v, t) { return v >= t; } },
    { key: 'lt', label: 'Less Than', symbol: '<', test: function (v, t) { return v < t; } },
    { key: 'lte', label: 'Less Than or Equal', symbol: '≤', test: function (v, t) { return v <= t; } },
    { key: 'outside', label: 'Outside Range', symbol: '∉', test: null },
    { key: 'inside', label: 'Inside Range', symbol: '∈', test: null }
  ];
  function op(key) { return OPERATORS.filter(function (o) { return o.key === key; })[0] || OPERATORS[0]; }
  function flagged(value, operator, threshold) {
    var o = op(operator);
    return o.test ? o.test(value, threshold) : false;
  }

  /* ------------------------------------------------------------
     Criteria catalogue — the LISA criteria in processing order.
     `stream` is the classified sample stream the criterion runs on.
     ------------------------------------------------------------ */
  var CATALOG = [
    {
      key: 'calibrator_accuracy',
      name: 'Check Calibrator Accuracy',
      description: 'Flags calibrators whose back-calculated concentration deviates from the nominal value by more than the configured tolerance.',
      stream: 'calibrator', role: 'percentDiff',
      defaults: { operator: 'gt', threshold: 25, unit: '%', severity: 'fail' },
      calculation: 'abs(% Diff) compared with the tolerance',
      evaluate: function (row, cfg, ctx) {
        var col = ctx.map[cfg.role];
        if (!col) return skip('Column for % Diff is not mapped');
        var raw = row[col];
        if (U.isBlank(raw)) return skip('No % Diff reported');
        var signed = U.toNumber(raw);
        var v = Math.abs(signed);
        var band = { actual: signed, min: -cfg.threshold, max: cfg.threshold };
        if (isNaN(v)) return fail('% Diff "' + raw + '" is not numeric', col, { actual: raw, expected: 'numeric value' });
        return flagged(v, cfg.operator, cfg.threshold)
          ? fail('Calibrator accuracy ' + U.fmtNum(v, 2) + '% is ' + op(cfg.operator).label.toLowerCase() +
                 ' the ' + cfg.threshold + '% tolerance', col, band)
          : pass();
      }
    },
    {
      key: 'control_accuracy',
      name: 'Check Control Accuracy',
      description: 'Flags controls (WSC / UC material) whose recovery deviates from the assigned value by more than the configured tolerance.',
      stream: 'control', role: 'percentDiff',
      defaults: { operator: 'gt', threshold: 25, unit: '%', severity: 'fail' },
      calculation: 'abs(% Diff) compared with the tolerance',
      evaluate: function (row, cfg, ctx) {
        var col = ctx.map[cfg.role];
        if (!col) return skip('Column for % Diff is not mapped');
        var raw = row[col];
        if (U.isBlank(raw)) return skip('No % Diff reported');
        var signed = U.toNumber(raw);
        var v = Math.abs(signed);
        var band = { actual: signed, min: -cfg.threshold, max: cfg.threshold };
        if (isNaN(v)) return fail('% Diff "' + raw + '" is not numeric', col, { actual: raw, expected: 'numeric value' });
        return flagged(v, cfg.operator, cfg.threshold)
          ? fail('Control accuracy ' + U.fmtNum(v, 2) + '% is ' + op(cfg.operator).label.toLowerCase() +
                 ' the ' + cfg.threshold + '% tolerance', col, band)
          : pass();
      }
    },
    {
      key: 'internal_standard',
      name: 'Check Internal Standard Errors',
      description: 'Flags patient samples with a missing internal standard peak, and samples whose internal standard is suppressed relative to the batch average recovery.',
      stream: 'patient', role: 'istdArea',
      defaults: {
        operator: 'lt', threshold: 90, unit: '%', severity: 'fail',
        checkMissing: true, checkSuppression: true
      },
      calculation: 'ISTD Area present · (% Recovery ÷ Average % Recovery) × 100 compared with the suppression threshold',
      evaluate: function (row, cfg, ctx) {
        var col = ctx.map[cfg.role];
        if (!col) return skip('Column for ISTD Area is not mapped');
        if (cfg.checkMissing !== false) {
          var raw = row[col];
          if (U.isBlank(raw)) return fail('Internal standard is missing — no peak reported', col, { actual: '—', expected: 'peak present' });
          if (isNaN(U.toNumber(raw))) return fail('Internal standard area "' + raw + '" is not a peak area', col, { actual: raw, expected: 'peak present' });
        }
        if (cfg.checkSuppression !== false) {
          var recCol = ctx.map.recovery, avgCol = ctx.map.avgRecovery;
          var rec = recCol ? U.toNumber(row[recCol]) : NaN;
          var avg = avgCol ? U.toNumber(row[avgCol]) : NaN;
          if (isNaN(avg) && ctx.derived.istdAreaMean) {
            // No recovery columns in this file: fall back to the batch mean ISTD area,
            // which is the same relative-suppression measurement.
            rec = U.toNumber(row[col]);
            avg = ctx.derived.istdAreaMean;
          }
          if (!isNaN(rec) && !isNaN(avg) && avg !== 0) {
            var ratio = rec / avg * 100;
            if (flagged(ratio, cfg.operator, cfg.threshold)) {
              return fail('Internal standard suppressed — recovery ratio ' + U.fmtNum(ratio, 1) + '% is ' +
                op(cfg.operator).label.toLowerCase() + ' the ' + cfg.threshold + '% threshold', col,
                { actual: U.fmtNum(ratio, 1) + '%', min: cfg.threshold });
            }
          }
        }
        return pass();
      }
    },
    {
      key: 'concentration_cutoff',
      name: 'Flag Concentrations Below Cut-off',
      description: 'Flags any patient concentration below the assay cut-off. The uploaded value is left untouched — the finding is reported, never written back. The cut-off is taken from the cut-off control row (Std. Conc.).',
      stream: 'patient', role: 'concentration',
      defaults: { operator: 'lt', threshold: null, unit: 'ng/mL', severity: 'warning' },
      calculation: 'Conc. < cut-off  →  flag (value preserved)',
      derivedLabel: 'Cut-off',
      evaluate: function (row, cfg, ctx) {
        var col = ctx.map[cfg.role];
        if (!col) return skip('Column for concentration is not mapped');
        var cut = ctx.derived.cutoff;
        if (cut === null || cut === undefined || isNaN(cut)) return skip('Cut-off could not be derived');
        var raw = row[col];
        if (U.isBlank(raw)) return skip('No concentration reported');
        var v = U.toNumber(raw);
        if (isNaN(v)) return fail('Concentration "' + raw + '" is not numeric', col, { actual: raw, expected: 'numeric value' });
        if (flagged(v, cfg.operator, cut)) {
          return flag(cfg.severity, 'Concentration ' + U.fmtNum(v, 4) + ' is below the ' +
            U.fmtNum(cut, 4) + ' ng/mL cut-off', col, { actual: v, min: cut });
        }
        return pass();
      }
    },
    {
      key: 'ion_ratio',
      name: 'Check Ion Ratio',
      description: 'Flags patient samples whose qualifier/quantifier ion ratio falls outside the range established by the calibrators, widened by the analyte’s Reference Ratio Adjustment.',
      stream: 'patient', role: 'ionRatio',
      defaults: { operator: 'outside', threshold: null, unit: '', severity: 'fail' },
      calculation: 'lowest calibrator ratio × (1 − adjustment)  …  highest calibrator ratio × (1 + adjustment)',
      derivedLabel: 'Acceptable ion-ratio range',
      evaluate: function (row, cfg, ctx) {
        var col = ctx.map[cfg.role];
        if (!col) return skip('Column for ion ratio is not mapped');
        var range = ctx.derived.ionRatioRange;
        if (!range) return skip('Ion-ratio range could not be derived from the calibrators');
        var raw = row[col];
        if (U.isBlank(raw)) return skip('No ion ratio reported');
        var v = U.toNumber(raw);
        if (isNaN(v)) return fail('Ion ratio "' + raw + '" is not numeric', col, { actual: raw, expected: 'numeric value' });
        return (v < range[0] || v > range[1])
          ? fail('Ion ratio ' + U.fmtNum(v, 2) + ' is outside the acceptable range ' +
                 U.fmtNum(range[0], 2) + ' – ' + U.fmtNum(range[1], 2), col,
                 { actual: v, min: range[0], max: range[1] })
          : pass();
      }
    },
    {
      key: 'retention_time',
      name: 'Check Retention Time',
      description: 'Flags patient samples whose retention time deviates from the calibrator average by more than the configured window.',
      stream: 'patient', role: 'retentionTime',
      defaults: { operator: 'outside', threshold: 20, unit: '%', severity: 'fail' },
      calculation: 'calibrator average RT × (1 ± window)',
      derivedLabel: 'Acceptable RT window',
      evaluate: function (row, cfg, ctx) {
        var col = ctx.map[cfg.role];
        if (!col) return skip('Column for retention time is not mapped');
        var win = ctx.derived.rtWindow;
        if (!win) return skip('Retention-time window could not be derived from the calibrators');
        var raw = row[col];
        if (U.isBlank(raw)) return skip('No retention time reported');
        var v = U.toNumber(raw);
        if (isNaN(v)) return fail('Retention time "' + raw + '" is not numeric', col, { actual: raw, expected: 'numeric value' });
        return (v < win[0] || v > win[1])
          ? fail('Retention time ' + U.fmtNum(v, 3) + ' is outside the acceptable window ' +
                 U.fmtNum(win[0], 3) + ' – ' + U.fmtNum(win[1], 3) +
                 ' (average ' + U.fmtNum(ctx.derived.rtAverage, 3) + ' ± ' + ctx.derived.rtWindowPct + '%)', col,
                 { actual: v, min: win[0], max: win[1] })
          : pass();
      }
    },
    {
      key: 'calibration_range',
      name: 'Check Calibration Range',
      description: 'Flags patient results that fall outside the calibrated measuring range established by the calibrator standards.',
      stream: 'patient', role: 'concentration',
      defaults: { operator: 'outside', threshold: null, unit: 'ng/mL', severity: 'warning', ignoreZero: true },
      calculation: 'lowest calibrator Std. Conc.  …  highest calibrator Std. Conc.',
      derivedLabel: 'Calibrated range',
      evaluate: function (row, cfg, ctx) {
        var col = ctx.map[cfg.role];
        if (!col) return skip('Column for concentration is not mapped');
        var range = ctx.derived.calibrationRange;
        if (!range) return skip('Calibration range could not be derived from the calibrators');
        var raw = row[col];
        if (U.isBlank(raw)) return skip('No concentration reported');
        var v = U.toNumber(raw);
        if (isNaN(v)) return skip('Concentration is not numeric');
        if (cfg.ignoreZero !== false && v === 0) return pass();   // a reported zero is not a range excursion
        var calBand = { actual: v, min: range[0], max: range[1] };
        if (v < range[0]) {
          return flag(cfg.severity, 'Result ' + U.fmtNum(v, 4) + ' is below the lowest calibrator (' +
            U.fmtNum(range[0], 4) + ' ng/mL)', col, calBand);
        }
        if (v > range[1]) {
          return flag(cfg.severity, 'Result ' + U.fmtNum(v, 4) + ' exceeds the highest calibrator (' +
            U.fmtNum(range[1], 4) + ' ng/mL) — N.I. High, dilution required', col,
            Object.assign({ flagLabel: 'N.I. High' }, calBand));
        }
        return pass();
      }
    }
  ];

  /**
   * `detail` carries the structured numbers behind a finding so the failed-record
   * tables can show Actual / Minimum / Maximum as columns instead of prose:
   *   { actual, min, max, expected }
   * Any of the four may be omitted when the check is not a range test.
   */
  function pass() { return { status: 'pass' }; }
  function skip(reason) { return { status: 'skip', reason: reason }; }
  function fail(reason, column, detail) {
    return Object.assign({ status: 'fail', reason: reason, column: column }, detail || {});
  }
  function warn(reason, column, detail) {
    return Object.assign({ status: 'warning', reason: reason, column: column }, detail || {});
  }
  function flag(severity, reason, column, detail) {
    return severity === 'warning' ? warn(reason, column, detail) : fail(reason, column, detail);
  }
  /** Expected-value label for a finding, used by the failed-record tables. */
  function expectedLabel(d) {
    if (!d) return '';
    if (d.expected) return d.expected;
    var hasMin = d.min !== undefined && d.min !== null && !isNaN(d.min);
    var hasMax = d.max !== undefined && d.max !== null && !isNaN(d.max);
    if (hasMin && hasMax) return U.fmtNum(d.min, 4) + ' – ' + U.fmtNum(d.max, 4);
    if (hasMax) return '≤ ' + U.fmtNum(d.max, 4);
    if (hasMin) return '≥ ' + U.fmtNum(d.min, 4);
    return '';
  }

  function def(key) { return CATALOG.filter(function (c) { return c.key === key; })[0] || null; }

  /** Default criteria configuration for a new analyte. */
  function defaultConfig() {
    return CATALOG.map(function (c, i) {
      return Object.assign({
        key: c.key, order: i, enabled: true, role: c.role, stream: c.stream
      }, U.clone(c.defaults));
    });
  }

  /** Human summary of a criterion's current configuration. */
  function describe(cfg, ctx) {
    var d = def(cfg.key);
    if (!d) return '';
    var o = op(cfg.operator);
    var col = ctx && ctx.map ? ctx.map[cfg.role] : null;
    var colTxt = col ? '[' + col + ']' : '[' + roleLabel(cfg.role) + ' — not mapped]';
    if (cfg.key === 'concentration_cutoff') {
      var cut = ctx && ctx.derived ? ctx.derived.cutoff : null;
      return colTxt + ' < ' + (cut === null || cut === undefined || isNaN(cut) ? 'cut-off' : U.fmtNum(cut, 4) + ' ng/mL') + ' → flag';
    }
    if (cfg.key === 'ion_ratio') {
      var r = ctx && ctx.derived ? ctx.derived.ionRatioRange : null;
      return colTxt + ' outside ' + (r ? U.fmtNum(r[0], 2) + ' – ' + U.fmtNum(r[1], 2) : 'calibrator range');
    }
    if (cfg.key === 'retention_time') {
      var w = ctx && ctx.derived ? ctx.derived.rtWindow : null;
      return colTxt + ' outside ' + (w ? U.fmtNum(w[0], 3) + ' – ' + U.fmtNum(w[1], 3) : 'average ± ' + cfg.threshold + '%');
    }
    if (cfg.key === 'calibration_range') {
      var c2 = ctx && ctx.derived ? ctx.derived.calibrationRange : null;
      return colTxt + ' outside ' + (c2 ? U.fmtNum(c2[0], 4) + ' – ' + U.fmtNum(c2[1], 4) + ' ng/mL' : 'calibrated range');
    }
    if (cfg.key === 'internal_standard') {
      var parts = [];
      if (cfg.checkMissing !== false) parts.push('missing peak');
      if (cfg.checkSuppression !== false) parts.push('recovery ratio ' + o.symbol + ' ' + cfg.threshold + '%');
      return colTxt + ' — ' + (parts.join(' · ') || 'no checks enabled');
    }
    return colTxt + ' ' + o.symbol + ' ' + cfg.threshold + (cfg.unit || '');
  }

  function roleLabel(key) {
    var r = ROLES.filter(function (x) { return x.key === key; })[0];
    return r ? r.label : key;
  }

  /* ------------------------------------------------------------
     Derived values — computed from the file's own calibrators and
     controls, never configured by hand.
     ------------------------------------------------------------ */
  function derive(streams, map, assay) {
    var d = {
      cutoff: null, cutoffSource: null,
      ionRatioRange: null, ionRatioBasis: null,
      rtAverage: null, rtWindow: null, rtWindowPct: null,
      calibrationRange: null, istdAreaMean: null
    };
    var adj = (assay && !isNaN(parseFloat(assay.referenceRatioAdjustment)))
      ? parseFloat(assay.referenceRatioAdjustment) / 100 : 0.1;

    /* cut-off: from the configured cut-off control row, else a fixed value */
    if (assay && assay.cutoffMode === 'fixed' && !isNaN(parseFloat(assay.cutoffValue))) {
      d.cutoff = parseFloat(assay.cutoffValue);
      d.cutoffSource = 'Fixed value from the analyte configuration';
    } else if (map.stdConcentration && map.sampleId) {
      var wanted = String((assay && assay.cutoffSampleId) || 'WCS1').toLowerCase();
      var hit = streams.control.concat(streams.calibrator).filter(function (r) {
        return String(r[map.sampleId]).trim().toLowerCase() === wanted;
      })[0];
      if (hit) {
        var c = U.toNumber(hit[map.stdConcentration]);
        if (!isNaN(c)) {
          d.cutoff = c;
          d.cutoffSource = 'Std. Conc. of ' + hit[map.sampleId] + ' in ' + (hit.__src || 'this file');
        }
      }
    }

    /* ion-ratio range from the calibrators */
    if (map.ionRatio && streams.calibrator.length) {
      var ratios = streams.calibrator.map(function (r) { return U.toNumber(r[map.ionRatio]); })
        .filter(function (v) { return !isNaN(v); });
      var used = (assay && assay.ignoreZeroRatios === false) ? ratios : ratios.filter(function (v) { return v !== 0; });
      if (used.length) {
        var lo = Math.min.apply(null, used), hi = Math.max.apply(null, used);
        d.ionRatioRange = [lo * (1 - adj), hi * (1 + adj)];
        d.ionRatioBasis = used.length + ' calibrator ratio(s) — lowest ' + U.fmtNum(lo, 2) +
          ', highest ' + U.fmtNum(hi, 2) + ', widened by ±' + (adj * 100).toFixed(0) + '%' +
          (used.length !== ratios.length ? ' (zero ratios excluded)' : '');
      }
    }

    /* retention-time window from the calibrator average */
    if (map.retentionTime && streams.calibrator.length) {
      var rts = streams.calibrator.map(function (r) { return U.toNumber(r[map.retentionTime]); })
        .filter(function (v) { return !isNaN(v) && v > 0; });
      if (rts.length) {
        var avg = U.sum(rts) / rts.length;
        var pct = 20;
        d.rtAverage = avg;
        d.rtWindowPct = pct;
        d.rtWindow = [avg * (1 - pct / 100), avg * (1 + pct / 100)];
      }
    }

    /* calibrated measuring range */
    if (map.stdConcentration && streams.calibrator.length) {
      var stds = streams.calibrator.map(function (r) { return U.toNumber(r[map.stdConcentration]); })
        .filter(function (v) { return !isNaN(v) && v > 0; });
      if (stds.length) d.calibrationRange = [Math.min.apply(null, stds), Math.max.apply(null, stds)];
    }

    /* batch mean ISTD area — fallback basis for the suppression check */
    if (map.istdArea) {
      var areas = streams.patient.concat(streams.calibrator, streams.control)
        .map(function (r) { return U.toNumber(r[map.istdArea]); })
        .filter(function (v) { return !isNaN(v) && v > 0; });
      if (areas.length) d.istdAreaMean = U.sum(areas) / areas.length;
    }
    return d;
  }

  /** Apply the RT window percentage from the criteria config before deriving. */
  function applyRtWindow(derived, criteria) {
    var rt = (criteria || []).filter(function (c) { return c.key === 'retention_time'; })[0];
    if (!rt || !derived.rtAverage || isNaN(parseFloat(rt.threshold))) return derived;
    var pct = parseFloat(rt.threshold);
    derived.rtWindowPct = pct;
    derived.rtWindow = [derived.rtAverage * (1 - pct / 100), derived.rtAverage * (1 + pct / 100)];
    return derived;
  }

  /**
   * Process a set of rows through the enabled criteria, one row at a time.
   * The uploaded values are only ever READ — a criterion reports a finding,
   * it never writes a value back into the row.
   * A row no criterion could be evaluated against is NOT counted as passed —
   * it is reported separately as "not evaluated", so an empty run can never
   * read as a clean one.
   * → { total, passed, failed, warnings, notEvaluated, rows:[…], byCriterion:{}, notMapped:[] }
   */
  function process(rows, streamOf, criteria, ctx) {
    var enabled = (criteria || []).filter(function (c) { return c.enabled; });
    var out = {
      total: rows.length, passed: 0, failed: 0, warnings: 0, notEvaluated: 0,
      rows: [], byCriterion: {}, notMapped: []
    };
    enabled.forEach(function (c) {
      out.byCriterion[c.key] = { evaluated: 0, failed: 0, warnings: 0, skipped: 0 };
      if (!ctx.map[c.role]) out.notMapped.push(c.key);
    });

    rows.forEach(function (row) {
      var stream = streamOf(row);
      var record = { row: row, stream: stream, status: 'pass', failures: [], warnings: [] };
      var evaluated = 0;
      enabled.forEach(function (cfg) {
        var d = def(cfg.key);
        if (!d) return;
        if (d.stream !== stream) return;                      // criterion does not apply to this stream
        var stat = out.byCriterion[cfg.key];
        var res;
        try { res = d.evaluate(row, cfg, ctx); }
        catch (e) { res = fail('Criterion could not be evaluated: ' + e.message); }
        if (!res || res.status === 'skip') { stat.skipped++; return; }
        stat.evaluated++;
        evaluated++;
        var entry = {
          criterion: cfg.key, name: d.name, column: res.column || ctx.map[cfg.role] || '',
          reason: res.reason || '', stream: stream,
          actual: res.actual, min: res.min, max: res.max,
          expected: expectedLabel(res), flagLabel: res.flagLabel || null
        };
        if (res.status === 'fail') { stat.failed++; record.failures.push(entry); }
        else if (res.status === 'warning') { stat.warnings++; record.warnings.push(entry); }
      });
      record.status = record.failures.length ? 'fail'
        : record.warnings.length ? 'warning'
          : evaluated ? 'pass' : 'not-evaluated';
      if (record.status === 'pass') out.passed++;
      else if (record.status === 'fail') out.failed++;
      else if (record.status === 'warning') out.warnings++;
      else out.notEvaluated++;
      out.rows.push(record);
    });
    return out;
  }

  global.Criteria = {
    ROLES: ROLES, OPERATORS: OPERATORS, CATALOG: CATALOG,
    autoMap: autoMap, def: def, op: op, roleLabel: roleLabel,
    defaultConfig: defaultConfig, describe: describe, expectedLabel: expectedLabel,
    derive: derive, applyRtWindow: applyRtWindow,
    process: process
  };
}(typeof window !== 'undefined' ? window : this));
