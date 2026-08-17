/* ============================================================
   seed.js — demo analytic catalogue, deterministic sample-data
   generator, classification suggestion + rule suggestion engines.

   The generator exists so the prototype has realistic files to work
   with; the app itself never assumes these columns exist. Everything
   downstream reads whatever the uploaded file actually contains.
   ============================================================ */
(function (global) {
  'use strict';

  var Uu = global.U;

  /* ------------------------------------------------------------
     Analytic catalogue. Every entry carries a `gen` spec used to
     synthesise a realistic single sample file (controls + calibrators
     + patients in ONE file) and a `stage` describing how far the demo
     workflow has already progressed for that analytic.
     ------------------------------------------------------------ */
  var CATALOG = [
    {
      id: 'HB001', name: 'HbA1c Analysis', code: 'HBA1C',
      description: 'Glycated haemoglobin (IFCC aligned) — 3-level QC with 5-point calibration.',
      color: '#1A6BC4', stage: 'approved', version: '1.2', seedNo: 1011,
      gen: {
        file: 'HbA1c_Sample_Data.csv', unit: '%', analyte: 'HbA1c',
        controls: [['L1', 5.2], ['L2', 8.5], ['L3', 11.8]], controlCount: 20,
        calibrators: [['L1', 5.2], ['L2', 7.4], ['L3', 9.6], ['L4', 11.8], ['L5', 14.0]], calCount: 10,
        calFailIndex: 3, calFailFactor: 1.115,
        patients: 2470, mean: 6.8, sd: 1.1, dp: 1,
        outLow: [2.0, 3.3], outHigh: [12.8, 17.4], outCount: 120, borderline: [10.0, 10.5], borderlineCount: 40, blanks: 6,
        instruments: ['ARCH-c8000', 'ARCH-c4000'], operators: ['J. Varade', 'M. Kulkarni', 'S. Rao'], batch: 'HB-2026-08',
        parts: [
          { qc: true, patients: 1200, idOffset: 0 },
          { qc: false, patients: 1270, idOffset: 1200 }
        ]
      }
    },
    {
      id: 'LP002', name: 'Lipid Profile', code: 'LIPID',
      description: 'Total cholesterol, HDL, LDL and triglycerides with 2-level QC.',
      color: '#0E8F86', stage: 'control_failed', version: '2.0', seedNo: 2027,
      gen: {
        file: 'Lipid_Profile_Data.csv', unit: 'mg/dL', analyte: 'Total Cholesterol',
        controls: [['L1', 120.0], ['L2', 240.0]], controlCount: 16,
        calibrators: [['L1', 100.0], ['L2', 200.0], ['L3', 300.0]], calCount: 9,
        calFailIndex: 5, calFailFactor: 1.14, controlFailIndex: 7, controlFailFactor: 1.13,
        patients: 1840, mean: 186, sd: 34, dp: 0,
        outLow: [60, 92], outHigh: [305, 420], outCount: 96, borderline: [280, 300], borderlineCount: 30, blanks: 4,
        instruments: ['COBAS-501', 'COBAS-702'], operators: ['A. Deshmukh', 'R. Patel'], batch: 'LP-2026-08',
        extraAnalytes: ['Triglycerides', 'HDL Cholesterol']
      }
    },
    {
      id: 'CB003', name: 'Complete Blood Count', code: 'CBC',
      description: 'Haematology panel — WBC, RBC, HGB, HCT, PLT with 3-level QC.',
      color: '#B3261E', stage: 'draft', version: '0.1', seedNo: 3041,
      gen: {
        file: 'CBC_Sample_Data.csv', unit: '10^3/µL', analyte: 'WBC',
        controls: [['L1', 3.2], ['L2', 7.5], ['L3', 15.4]], controlCount: 18,
        calibrators: [['L1', 3.0], ['L2', 8.0], ['L3', 16.0]], calCount: 9,
        calFailIndex: 4, calFailFactor: 1.12,
        patients: 3120, mean: 7.4, sd: 1.6, dp: 1,
        outLow: [1.1, 2.6], outHigh: [16.5, 28.0], outCount: 140, borderline: [15.0, 16.4], borderlineCount: 52, blanks: 8,
        instruments: ['XN-1000', 'XN-550'], operators: ['P. Iyer', 'K. Sharma'], batch: 'CB-2026-08',
        extraAnalytes: ['Platelets']
      }
    },
    {
      id: 'TH004', name: 'Thyroid Profile', code: 'THYROID',
      description: 'TSH, Free T3 and Free T4 chemiluminescent immunoassay.',
      color: '#6B4FD0', stage: 'approved', version: '1.4', seedNo: 4053,
      gen: {
        file: 'Thyroid_Profile_Data.csv', unit: 'µIU/mL', analyte: 'TSH',
        controls: [['L1', 0.45], ['L2', 4.20], ['L3', 22.00]], controlCount: 21,
        calibrators: [['L1', 0.40], ['L2', 4.00], ['L3', 20.00]], calCount: 12,
        calFailIndex: 6, calFailFactor: 1.11,
        patients: 1560, mean: 2.4, sd: 0.9, dp: 2,
        outLow: [0.01, 0.18], outHigh: [7.2, 42.0], outCount: 88, borderline: [5.5, 7.0], borderlineCount: 34, blanks: 5,
        instruments: ['ADVIA-XPT'], operators: ['S. Nair', 'D. Joshi'], batch: 'TH-2026-08'
      }
    },
    {
      id: 'LF005', name: 'Liver Function Test', code: 'LFT',
      description: 'ALT, AST, ALP, bilirubin and albumin panel — revalidation pending.',
      color: '#E08A0B', stage: 'revalidation', version: '3.1', seedNo: 5067,
      gen: {
        file: 'LFT_Sample_Data.csv', unit: 'U/L', analyte: 'ALT',
        controls: [['L1', 28.0], ['L2', 96.0]], controlCount: 14,
        calibrators: [['L1', 25.0], ['L2', 100.0], ['L3', 250.0]], calCount: 9,
        calFailIndex: 2, calFailFactor: 1.13,
        patients: 2140, mean: 32, sd: 11, dp: 0,
        outLow: [2, 6], outHigh: [95, 320], outCount: 110, borderline: [78, 92], borderlineCount: 36, blanks: 6,
        instruments: ['AU-680'], operators: ['V. Menon', 'T. Gupta'], batch: 'LF-2026-08'
      }
    },
    {
      id: 'VD006', name: 'Vitamin D (25-OH)', code: 'VITD',
      description: '25-hydroxyvitamin D total — LC-MS/MS confirmatory workflow.',
      color: '#137A45', stage: 'draft', version: '0.1', seedNo: 6079,
      gen: {
        file: 'VitaminD_Sample_Data.csv', unit: 'ng/mL', analyte: '25-OH Vitamin D',
        controls: [['L1', 12.0], ['L2', 38.0], ['L3', 74.0]], controlCount: 15,
        calibrators: [['L1', 10.0], ['L2', 40.0], ['L3', 80.0]], calCount: 9,
        calFailIndex: 1, calFailFactor: 1.16,
        patients: 980, mean: 26, sd: 9, dp: 1,
        outLow: [1.5, 6.0], outHigh: [82, 140], outCount: 64, borderline: [70, 80], borderlineCount: 22, blanks: 3,
        instruments: ['LCMS-8060'], operators: ['N. Bose'], batch: 'VD-2026-08'
      }
    },
    {
      id: 'RF007', name: 'Renal Function Panel', code: 'RENAL',
      description: 'Creatinine, urea, eGFR and electrolytes with 2-level QC.',
      color: '#14549B', stage: 'rules_ready', version: '1.0', seedNo: 7083,
      gen: {
        file: 'Renal_Panel_Data.csv', unit: 'mg/dL', analyte: 'Creatinine',
        controls: [['L1', 0.9], ['L2', 4.6]], controlCount: 12,
        calibrators: [['L1', 1.0], ['L2', 5.0]], calCount: 8,
        calFailIndex: 3, calFailFactor: 1.12,
        patients: 2260, mean: 1.05, sd: 0.28, dp: 2,
        outLow: [0.12, 0.34], outHigh: [2.4, 9.8], outCount: 104, borderline: [2.0, 2.35], borderlineCount: 30, blanks: 5,
        instruments: ['AU-5800'], operators: ['H. Kale', 'L. Fernandes'], batch: 'RF-2026-08'
      }
    }
  ];

  /* ------------------------------------------------------------
     Deterministic dataset generator.
     Produces ONE file containing control + calibration + patient rows.
     ------------------------------------------------------------ */
  var COLUMNS = ['Analyte Name', 'Sample ID', 'Sample Type', 'Control Level', 'Patient ID', 'Expected Value',
    'Result', 'Unit', 'Run Date', 'Instrument', 'Operator', 'Batch ID', 'QC Flag'];

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  /**
   * generateDataset(spec, seedNo, part)
   * `part` lets one catalogue entry be spread over several files and lets a file
   * carry more than one analyte — the shape real instrument exports have.
   *   part = { qc:bool, patients:n, idOffset:n, extraAnalytes:[name], label }
   */
  function generateDataset(spec, seedNo, part) {
    part = part || {};
    var rows = buildAnalyteRows(spec, seedNo || 1011, spec.analyte, {
      qc: part.qc !== false,
      patients: part.patients === undefined ? spec.patients : part.patients,
      idOffset: part.idOffset || 0,
      injectFailures: true
    });
    var extras = part.extraAnalytes || spec.extraAnalytes || [];
    extras.forEach(function (name, i) {
      rows = rows.concat(buildAnalyteRows(spec, (seedNo || 1011) + 991 * (i + 1), name, {
        qc: part.qc !== false,
        patients: Math.round((part.patients === undefined ? spec.patients : part.patients) * 0.45),
        idOffset: part.idOffset || 0,
        injectFailures: false,
        scale: 0.35 + i * 0.2
      }));
    });
    return { columns: COLUMNS.slice(), rows: rows };
  }

  function buildAnalyteRows(spec, seedNo, analyte, opt) {
    var rnd = Uu.seededRandom(seedNo || 1011);
    var g = spec;
    var scale = opt.scale || 1;
    var rows = [];
    // Fixed run window so "Not Future" style rules behave predictably.
    var base = new Date(2026, 7, 10); // 10 Aug 2026
    function runDate(offsetDays) {
      var d = new Date(base.getTime() + offsetDays * 86400000);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
    }
    function pick(arr, i) { return arr[i % arr.length]; }
    function jitter(v, pct) { return v * (1 + (rnd() * 2 - 1) * pct); }
    function fx(v, dp) { return Number(v).toFixed(dp); }
    function normal() { // Box–Muller
      var u = Math.max(rnd(), 1e-9), v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    /* --- controls --- */
    if (opt.qc) {
      for (var c = 0; c < g.controlCount; c++) {
        var lvl = pick(g.controls, c);
        var expected = lvl[1] * scale;
        var result = jitter(expected, 0.015);
        if (opt.injectFailures && g.controlFailIndex === c) result = expected * g.controlFailFactor;
        rows.push({
          'Analyte Name': analyte,
          'Sample ID': 'C' + pad(c + 1, 3), 'Sample Type': 'CONTROL', 'Control Level': lvl[0], 'Patient ID': '',
          'Expected Value': fx(expected, g.dp + 1), 'Result': fx(result, g.dp + 1), 'Unit': g.unit,
          'Run Date': runDate(c % 5), 'Instrument': pick(g.instruments, c), 'Operator': pick(g.operators, c),
          'Batch ID': g.batch + '-C' + pad((c % 3) + 1, 2), 'QC Flag': 'TRUE'
        });
      }

      /* --- calibrators --- */
      for (var k = 0; k < g.calCount; k++) {
        var cl = pick(g.calibrators, k);
        var cExpected = cl[1] * scale;
        var cResult = jitter(cExpected, 0.012);
        if (opt.injectFailures && g.calFailIndex === k) cResult = cExpected * g.calFailFactor;
        rows.push({
          'Analyte Name': analyte,
          'Sample ID': 'CAL' + pad(k + 1, 3), 'Sample Type': 'CALIBRATION', 'Control Level': cl[0], 'Patient ID': '',
          'Expected Value': fx(cExpected, g.dp + 1), 'Result': fx(cResult, g.dp + 1), 'Unit': g.unit,
          'Run Date': runDate(k % 4), 'Instrument': pick(g.instruments, k), 'Operator': pick(g.operators, k + 1),
          'Batch ID': g.batch + '-K' + pad((k % 2) + 1, 2), 'QC Flag': 'TRUE'
        });
      }
    }

    /* --- patients: bulk normal population + deliberate outliers --- */
    var pn = opt.patients === undefined ? g.patients : opt.patients;
    var ratio = g.patients ? pn / g.patients : 1;
    var outCount = Math.round(g.outCount * ratio), blCount = Math.round(g.borderlineCount * ratio),
      blanks = Math.round(g.blanks * ratio);
    var normalCount = Math.max(0, pn - outCount - blCount - blanks);
    var bag = [];
    for (var i = 0; i < normalCount; i++) {
      var val = g.mean + normal() * g.sd;
      var lo = g.mean - 2.4 * g.sd, hi = g.mean + 2.4 * g.sd;
      bag.push({ v: Math.min(hi, Math.max(lo, val)) * scale, kind: 'n' });
    }
    for (var j = 0; j < outCount; j++) {
      var lowSide = j % 5 < 2;                      // ~40% low, ~60% high
      var rng = lowSide ? g.outLow : g.outHigh;
      bag.push({ v: (rng[0] + rnd() * (rng[1] - rng[0])) * scale, kind: 'o' });
    }
    for (var b = 0; b < blCount; b++) {
      bag.push({ v: (g.borderline[0] + rnd() * (g.borderline[1] - g.borderline[0])) * scale, kind: 'b' });
    }
    for (var z = 0; z < blanks; z++) bag.push({ v: null, kind: 'x' });

    // deterministic shuffle
    for (var s = bag.length - 1; s > 0; s--) {
      var t = Math.floor(rnd() * (s + 1)); var tmp = bag[s]; bag[s] = bag[t]; bag[t] = tmp;
    }

    var off = opt.idOffset || 0;
    bag.forEach(function (item, idx) {
      rows.push({
        'Analyte Name': analyte,
        'Sample ID': 'P' + pad(off + idx + 1, 4), 'Sample Type': 'PATIENT', 'Control Level': '',
        'Patient ID': 'PAT' + pad(off + idx + 1, 4),
        'Expected Value': '',
        'Result': item.v === null ? '----' : fx(item.v, g.dp),
        'Unit': g.unit,
        'Run Date': runDate(idx % 6),
        'Instrument': pick(g.instruments, idx), 'Operator': pick(g.operators, idx),
        'Batch ID': g.batch + '-P' + pad((idx % 12) + 1, 2),
        'QC Flag': item.kind === 'x' ? 'FALSE' : (idx % 97 === 0 ? 'FALSE' : 'TRUE')
      });
    });

    return rows;
  }

  /* ------------------------------------------------------------
     Classification suggestion.
     Structural first (a low-cardinality text field that partitions the
     file), lexical hints second. Always user-overridable.
     ------------------------------------------------------------ */
  function suggestClassification(fields, rows) {
    var candidates = fields.filter(function (f) {
      return f.type === 'text' && f.distinctCount >= 2 && f.distinctCount <= 8 && f.blanks < rows.length * 0.05;
    });
    if (!candidates.length) {
      candidates = fields.filter(function (f) { return f.distinctCount >= 2 && f.distinctCount <= 8; });
    }
    if (!candidates.length) return null;

    // prefer the field whose distinct values look like sample-type words
    function score(f) {
      var s = 0;
      f.distinct.forEach(function (v) {
        var t = String(v).toLowerCase();
        if (/contr|ctrl|qc/.test(t)) s += 3;
        if (/calib|cal\b|std|standard/.test(t)) s += 3;
        if (/pat|spec|unknown|sample/.test(t)) s += 3;
      });
      if (/type|category|class|kind/i.test(f.name)) s += 2;
      if (f.distinctCount === 3) s += 1;
      return s;
    }
    candidates.sort(function (a, b) { return score(b) - score(a); });
    var field = candidates[0];

    var counts = {};
    rows.forEach(function (r) { var v = String(r[field.name]); counts[v] = (counts[v] || 0) + 1; });
    var values = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });

    var out = { field: field.name, control: '', calibration: '', patient: '' };
    var taken = {};
    values.forEach(function (v) {
      var t = v.toLowerCase();
      if (!out.control && /contr|ctrl|qc/.test(t)) { out.control = v; taken[v] = 1; }
      else if (!out.calibration && /calib|cal|std|standard/.test(t)) { out.calibration = v; taken[v] = 1; }
      else if (!out.patient && /pat|spec|unknown/.test(t)) { out.patient = v; taken[v] = 1; }
    });
    // structural fallback: biggest group = patients, then larger = control, smaller = calibration
    var rest = values.filter(function (v) { return !taken[v]; });
    if (!out.patient && rest.length) { out.patient = rest.shift(); }
    if (!out.control && rest.length) { out.control = rest.shift(); }
    if (!out.calibration && rest.length) { out.calibration = rest.shift(); }
    return out;
  }

  /* ------------------------------------------------------------
     Rule suggestion — derives rules from the data profile only.
     Numeric limits come from the data itself (2 SD warn / 3 SD fail,
     the classic analytical convention), never from hardcoded values.
     ------------------------------------------------------------ */
  function stats(values) {
    var n = values.length;
    if (!n) return null;
    var mean = Uu.sum(values) / n;
    var variance = n > 1 ? Uu.sum(values.map(function (v) { return (v - mean) * (v - mean); })) / (n - 1) : 0;
    var sd = Math.sqrt(variance);
    return { n: n, mean: mean, sd: sd, min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
  }
  function roundTo(v, dp) { var p = Math.pow(10, dp); return Math.round(v * p) / p; }

  /** Detect a "reference/target" numeric field: populated for control+calibration, mostly blank for patients. */
  function detectReferenceField(fields, rows, cls) {
    if (!cls) return null;
    var qc = rows.filter(function (r) {
      var v = String(r[cls.field]);
      return v === cls.control || v === cls.calibration;
    });
    var pat = rows.filter(function (r) { return String(r[cls.field]) === cls.patient; });
    if (!qc.length || !pat.length) return null;
    var best = null;
    fields.filter(function (f) { return f.type === 'number'; }).forEach(function (f) {
      var qcFilled = qc.filter(function (r) { return !Uu.isBlank(r[f.name]); }).length / qc.length;
      var patFilled = pat.filter(function (r) { return !Uu.isBlank(r[f.name]); }).length / pat.length;
      var s = qcFilled - patFilled;
      if (qcFilled > 0.9 && patFilled < 0.1 && (!best || s > best.score)) best = { field: f.name, score: s };
    });
    return best ? best.field : null;
  }

  /** Detect the primary measurement field: numeric, populated across all sample types. */
  function detectResultField(fields, rows, cls, referenceField) {
    var numeric = fields.filter(function (f) { return f.type === 'number' && f.name !== referenceField; });
    if (!numeric.length) return null;
    if (!cls) return numeric[0].name;
    var pat = rows.filter(function (r) { return String(r[cls.field]) === cls.patient; });
    var best = null;
    numeric.forEach(function (f) {
      var filled = pat.length ? pat.filter(function (r) { return !Uu.isBlank(r[f.name]); }).length / pat.length : 1;
      var spread = f.max !== null && f.min !== null ? f.max - f.min : 0;
      var s = filled * 10 + Math.min(spread, 100) / 100;
      if (!best || s > best.score) best = { field: f.name, score: s };
    });
    return best ? best.field : numeric[0].name;
  }

  function mkRule(o) {
    return Object.assign({
      id: Uu.uid('rule'), severity: 'error', scope: ['control', 'calibration', 'patient'],
      enabled: true, condition: null, note: '', createdAt: new Date().toISOString()
    }, o);
  }

  /**
   * suggestRules(fields, rows, classification)
   *  → { rules:[], notes:[] }  (notes explain how each limit was derived)
   */
  function suggestRules(fields, rows, cls) {
    var rules = [], notes = [];
    var refField = detectReferenceField(fields, rows, cls);
    var resultField = detectResultField(fields, rows, cls, refField);

    function groupRows(kind) {
      if (!cls) return rows;
      return rows.filter(function (r) { return String(r[cls.field]) === cls[kind]; });
    }
    var patRows = groupRows('patient'), ctlRows = groupRows('control'), calRows = groupRows('calibration');
    var qcRows = ctlRows.concat(calRows);

    fields.forEach(function (f) {
      var allValues = rows.map(function (r) { return r[f.name]; });
      var blankRatio = allValues.filter(Uu.isBlank).length / (rows.length || 1);

      // ---- presence rules, scoped to the sample types where the field is actually populated
      var scope = [];
      [['control', ctlRows], ['calibration', calRows], ['patient', patRows]].forEach(function (pair) {
        if (!pair[1].length) return;
        var filled = pair[1].filter(function (r) { return !Uu.isBlank(r[f.name]); }).length / pair[1].length;
        if (filled > 0.97) scope.push(pair[0]);
      });
      if (scope.length) {
        rules.push(mkRule({ field: f.name, dataType: f.type, type: 'required', params: {}, scope: scope, severity: 'error' }));
      }

      if (f.type === 'text' && f.distinctCount > 0 && f.distinctCount <= 12 && blankRatio < 0.5) {
        rules.push(mkRule({
          field: f.name, dataType: 'text', type: 'in_list',
          params: { values: f.distinct.slice(0, 12).join(', '), ci: true },
          scope: scope.length ? scope : ['control', 'calibration', 'patient'], severity: 'error'
        }));
        notes.push('[' + f.name + '] allowed values taken from the ' + f.distinctCount + ' distinct values present in the file.');
      }

      if (f.type === 'date') {
        rules.push(mkRule({ field: f.name, dataType: 'date', type: 'not_future', params: {}, scope: scope.length ? scope : ['control', 'calibration', 'patient'], severity: 'error' }));
      }

      if (f.type === 'number') {
        var dp = 0;
        rows.slice(0, 500).forEach(function (r) { if (Uu.isNumeric(r[f.name])) dp = Math.max(dp, Uu.decimalsOf(r[f.name])); });

        // patient limits from the patient population itself
        var pv = patRows.map(function (r) { return r[f.name]; }).filter(Uu.isNumeric).map(Uu.toNumber);
        var ps = stats(pv);
        if (ps && ps.sd > 0) {
          var lo3 = Math.max(ps.min >= 0 ? 0 : -Infinity, roundTo(ps.mean - 3 * ps.sd, dp || 1));
          var hi3 = roundTo(ps.mean + 3 * ps.sd, dp || 1);
          var lo2 = Math.max(ps.min >= 0 ? 0 : -Infinity, roundTo(ps.mean - 2 * ps.sd, dp || 1));
          var hi2 = roundTo(ps.mean + 2 * ps.sd, dp || 1);
          rules.push(mkRule({
            field: f.name, dataType: 'number', type: 'between',
            params: { min: lo3, max: hi3 }, scope: ['patient'], severity: 'error',
            note: 'Derived from patient population: mean ' + roundTo(ps.mean, 2) + ' ± 3 SD (' + roundTo(ps.sd, 2) + ')'
          }));
          rules.push(mkRule({
            field: f.name, dataType: 'number', type: 'between',
            params: { min: lo2, max: hi2 }, scope: ['patient'], severity: 'warning',
            note: 'Derived from patient population: mean ± 2 SD (advisory flag)'
          }));
          notes.push('[' + f.name + '] patient limits derived from the file: mean ' + roundTo(ps.mean, 2) +
            ', SD ' + roundTo(ps.sd, 2) + ' → fail outside ' + lo3 + '–' + hi3 + ', warn outside ' + lo2 + '–' + hi2 + '.');
        }

        // analytical measuring range from the QC material actually run
        var qv = qcRows.map(function (r) { return r[f.name]; }).filter(Uu.isNumeric).map(Uu.toNumber);
        if (qv.length) {
          var qs = stats(qv);
          var qlo = Math.max(qs.min >= 0 ? 0 : -Infinity, roundTo(qs.min * 0.7, dp || 1));
          var qhi = roundTo(qs.max * 1.3, dp || 1);
          var qscope = [];
          if (ctlRows.length) qscope.push('control');
          if (calRows.length) qscope.push('calibration');
          if (qscope.length) {
            rules.push(mkRule({
              field: f.name, dataType: 'number', type: 'between',
              params: { min: qlo, max: qhi }, scope: qscope, severity: 'error',
              note: 'Analytical range spanning the QC/calibrator material in this file (±30%)'
            }));
          }
        }

        if (dp > 0) {
          rules.push(mkRule({
            field: f.name, dataType: 'number', type: 'decimal_precision',
            params: { decimals: dp, mode: 'at_most' },
            scope: ['control', 'calibration', 'patient'], severity: 'error',
            note: 'Highest precision observed in the file is ' + dp + ' decimal place(s)'
          }));
        }

        // recovery vs. the detected reference/target field (control + calibration only)
        if (refField && f.name === resultField) {
          var rscope = [];
          if (ctlRows.length) rscope.push('control');
          if (calRows.length) rscope.push('calibration');
          if (rscope.length) {
            rules.push(mkRule({
              field: f.name, dataType: 'number', type: 'percentage_difference',
              params: { compareField: refField, maxPercent: 10 }, scope: rscope, severity: 'error',
              note: 'Recovery limit against the detected target field [' + refField + ']'
            }));
            notes.push('[' + refField + '] detected as the target/expected field (populated for QC material, blank for patients) — recovery limited to ±10%.');
          }
        }
      }

      if (f.type === 'boolean') {
        rules.push(mkRule({
          field: f.name, dataType: 'boolean', type: 'is_true', params: {},
          scope: ctlRows.length || calRows.length ? ['control', 'calibration'] : ['patient'], severity: 'error',
          note: 'QC material is expected to carry an affirmative flag'
        }));
      }
    });

    return { rules: rules, notes: notes, resultField: resultField, referenceField: refField };
  }

  var API = {
    CATALOG: CATALOG, COLUMNS: COLUMNS,
    generateDataset: generateDataset,
    suggestClassification: suggestClassification,
    suggestRules: suggestRules,
    detectReferenceField: detectReferenceField,
    detectResultField: detectResultField,
    stats: stats
  };

  global.Seed = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : this));
