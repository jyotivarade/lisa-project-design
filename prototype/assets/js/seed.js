/* ============================================================
   seed.js — demo analytic catalogue and deterministic sample-data
   generator.

   The generator exists so the prototype ships with realistic files to
   work with; the app itself never assumes these columns exist. Every
   report is built from whatever the uploaded file actually contains.
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
      color: '#1A6BC4', seedNo: 1011,
      gen: {
        file: 'HbA1c_Sample_Data.csv', unit: '%', analyte: 'HbA1c',
        controls: [['L1', 5.2], ['L2', 8.5], ['L3', 11.8]], controlCount: 20,
        calibrators: [['L1', 5.2], ['L2', 7.4], ['L3', 9.6], ['L4', 11.8], ['L5', 14.0]], calCount: 10,
        calFailIndex: 3, calFailFactor: 1.34,
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
      color: '#0E8F86', seedNo: 2027,
      gen: {
        file: 'Lipid_Profile_Data.csv', unit: 'mg/dL', analyte: 'Total Cholesterol',
        controls: [['L1', 120.0], ['L2', 240.0]], controlCount: 16,
        calibrators: [['L1', 100.0], ['L2', 200.0], ['L3', 300.0]], calCount: 9,
        calFailIndex: 5, calFailFactor: 1.38, controlFailIndex: 7, controlFailFactor: 1.31,
        patients: 1840, mean: 186, sd: 34, dp: 0,
        outLow: [60, 92], outHigh: [305, 420], outCount: 96, borderline: [280, 300], borderlineCount: 30, blanks: 4,
        instruments: ['COBAS-501', 'COBAS-702'], operators: ['A. Deshmukh', 'R. Patel'], batch: 'LP-2026-08',
        extraAnalytes: ['Triglycerides', 'HDL Cholesterol']
      }
    },
    {
      id: 'CB003', name: 'Complete Blood Count', code: 'CBC',
      description: 'Haematology panel — WBC, RBC, HGB, HCT, PLT with 3-level QC.',
      color: '#B3261E', stage: 'empty', seedNo: 3041,
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
    }
  ];

  /* ------------------------------------------------------------
     LISA demo analyte — LC-MS/MS confirmation batch.
     Column shape follows a real instrument export, including "----" for
     "no result" and repeated Sample IDs across runs.
     ------------------------------------------------------------ */
  var LISA_COLUMNS = ['Analyte Name', 'Flags', 'Data Filename', 'Sample ID', 'Sample Type', 'Level',
    'Area', 'ISTD Area', 'Found RT', 'Ref 1 Set Ratio', 'Ref 1 Actual Ratio', 'Cal Point',
    'Std. Conc. (ng/mL)', 'Conc. (ng/mL)', '%Diff', 'S/N', 'Acquired Date', 'Sample Name', 'Width(50%)'];

  var LISA_CATALOG = [
    {
      id: 'COC008', name: 'Cocaine', code: 'COC',
      description: 'Cocaine confirmation by LC-MS/MS — 7-point calibration with WSC controls and patient specimens.',
      color: '#B3261E', seedNo: 8091,
      assay: {
        analyteName: 'Cocaine', analyteCode: 'COC', assayName: 'Cocaine Confirmation (LC-MS/MS)',
        matrix: 'Urine', referenceRatioAdjustment: 10, cutoffMode: 'wcs1', cutoffSampleId: 'WCS1'
      },
      lisa: {
        analyte: 'Cocaine', batch: '260629_P300',
        calLevels: [1, 2, 5, 10, 20, 40, 100],
        controls: [['WCS1', 1.5], ['WCS2', 2.5], ['WCS3', 50], ['UC', null]],
        rt: 4.35, setRatio: 30, ratioBase: [23.1, 35.6],
        files: [
          { name: 'Cocaine_2026_08_01.csv', day: 0, patients: 118, calFail: -1, ctlFail: [], idBase: 2606251000 },
          { name: 'Cocaine_2026_08_02.csv', day: 1, patients: 164, calFail: 3, ctlFail: [0], idBase: 2606252000 },
          { name: 'Cocaine_2026_08_03.csv', day: 2, patients: 97, calFail: -1, ctlFail: [1], idBase: 2606253000 },
          { name: 'Cocaine_2026_08_04.csv', day: 3, patients: 141, calFail: -1, ctlFail: [], idBase: 2606254000 }
        ]
      }
    }
  ];

  function generateLisaFile(spec, seedNo, fileSpec) {
    var rnd = Uu.seededRandom(seedNo || 8091);
    var L = spec;
    var rows = [];
    var base = new Date(2026, 7, 1 + (fileSpec.day || 0), 12, 20, 0);
    var clock = base.getTime();
    function stamp() {
      clock += 386000;                       // ~6.4 min per injection
      var d = new Date(clock);
      var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12 === 0 ? 12 : h % 12;
      return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' +
        h12 + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2) + ' ' + ap;
    }
    function jit(v, p) { return v * (1 + (rnd() * 2 - 1) * p); }
    var seq = 0;
    function fname(id) { seq += 1; return L.batch + '_' + fileSpec.name.replace(/\.csv$/i, '') + '_' + id + '_' + pad(seq, 3); }
    function ratio() { return jit((L.ratioBase[0] + L.ratioBase[1]) / 2, 0.16); }

    /* calibrators Cal_1 … Cal_7 (Sample Type "Standard") */
    L.calLevels.forEach(function (level, i) {
      var diff = (rnd() * 2 - 1) * 12;
      if (fileSpec.calFail === i) diff = 27.4 + rnd() * 6;      // deliberate accuracy failure
      var conc = level * (1 + diff / 100);
      rows.push({
        'Analyte Name': L.analyte, 'Flags': '', 'Data Filename': fname('Cal_' + (i + 1)),
        'Sample ID': 'Cal_' + (i + 1), 'Sample Type': 'Standard', 'Level': String(i + 1),
        'Area': Math.round(jit(3800 * Math.pow(level, 0.98), 0.05)),
        'ISTD Area': Math.round(jit(18000000, 0.12)),
        'Found RT': jit(L.rt, 0.004).toFixed(3),
        'Ref 1 Set Ratio': String(L.setRatio), 'Ref 1 Actual Ratio': ratio().toFixed(2),
        'Cal Point': 'Yes', 'Std. Conc. (ng/mL)': String(level),
        'Conc. (ng/mL)': conc.toFixed(4), '%Diff': diff.toFixed(2),
        'S/N': '----', 'Acquired Date': stamp(), 'Sample Name': 'Cal_' + (i + 1),
        'Width(50%)': jit(0.055, 0.1).toFixed(3)
      });
    });

    /* controls WCS1 … UC (Sample Type "Control") */
    L.controls.forEach(function (c, i) {
      var target = c[1];
      var diff = (rnd() * 2 - 1) * 14;
      if ((fileSpec.ctlFail || []).indexOf(i) > -1) diff = 31 + rnd() * 60;   // deliberate control failure
      var conc = target === null ? jit(0.68, 0.2) : target * (1 + diff / 100);
      rows.push({
        'Analyte Name': L.analyte, 'Flags': '', 'Data Filename': fname(c[0]),
        'Sample ID': c[0], 'Sample Type': 'Control', 'Level': String(8 + i),
        'Area': Math.round(jit(target === null ? 1750 : 6800 * (target / 1.5), 0.08)),
        'ISTD Area': Math.round(jit(13000000, 0.15)),
        'Found RT': jit(L.rt, 0.006).toFixed(3),
        'Ref 1 Set Ratio': String(L.setRatio), 'Ref 1 Actual Ratio': ratio().toFixed(2),
        'Cal Point': 'No',
        'Std. Conc. (ng/mL)': target === null ? '----' : String(target),
        'Conc. (ng/mL)': conc.toFixed(4),
        '%Diff': target === null ? '----' : diff.toFixed(2),
        'S/N': '----', 'Acquired Date': stamp(), 'Sample Name': c[0],
        'Width(50%)': jit(0.055, 0.1).toFixed(3)
      });
    });

    /* patient specimens — numeric Sample ID, Sample Type "Unknown" */
    var n = fileSpec.patients;
    for (var p = 0; p < n; p++) {
      var kind = rnd();
      var id = String(fileSpec.idBase + p + 1);
      var missingIstd = kind < 0.04;
      var suppressed = !missingIstd && kind < 0.09;
      var wildRatio = !missingIstd && kind >= 0.09 && kind < 0.145;
      var rtDrift = !missingIstd && kind >= 0.145 && kind < 0.18;
      var overRange = kind >= 0.18 && kind < 0.205;
      var belowCut = kind >= 0.205 && kind < 0.42;

      var conc = belowCut ? rnd() * 1.45
        : overRange ? 105 + rnd() * 260
          : 1.6 + rnd() * 85;
      rows.push({
        'Analyte Name': L.analyte, 'Flags': '', 'Data Filename': fname(id),
        'Sample ID': id, 'Sample Type': 'Unknown', 'Level': '----',
        'Area': missingIstd ? '----' : Math.round(jit(1600 + conc * 3400, 0.1)),
        'ISTD Area': missingIstd ? '----' : Math.round(suppressed ? jit(4200000, 0.1) : jit(15000000, 0.13)),
        'Found RT': rtDrift ? jit(L.rt * 1.28, 0.02).toFixed(3) : jit(L.rt, 0.012).toFixed(3),
        'Ref 1 Set Ratio': String(L.setRatio),
        'Ref 1 Actual Ratio': wildRatio ? (rnd() < 0.5 ? (rnd() * 6).toFixed(2) : (240 + rnd() * 2100).toFixed(2))
          : ratio().toFixed(2),
        'Cal Point': 'No', 'Std. Conc. (ng/mL)': '----',
        'Conc. (ng/mL)': missingIstd ? '----' : conc.toFixed(4),
        '%Diff': '----', 'S/N': '----', 'Acquired Date': stamp(), 'Sample Name': id,
        'Width(50%)': jit(0.065, 0.18).toFixed(3)
      });
    }
    return { columns: LISA_COLUMNS.slice(), rows: rows };
  }

  /* ------------------------------------------------------------
     Deterministic dataset generator.
     Produces ONE file containing control + calibration + patient rows.
     ------------------------------------------------------------ */
  var COLUMNS = ['Analyte Name', 'Sample ID', 'Sample Type', 'Control Level', 'Patient ID', 'Expected Value',
    'Result', '%Diff', 'Unit', 'Run Date', 'Instrument', 'Operator', 'Batch ID', 'QC Flag'];

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
    /* QC exports carry the deviation from the assigned value — the accuracy
       criteria read it straight from the file. */
    function pctDiff(actual, expected) {
      return expected ? ((actual - expected) / expected * 100).toFixed(2) : '';
    }
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
          'Expected Value': fx(expected, g.dp + 1), 'Result': fx(result, g.dp + 1),
          '%Diff': pctDiff(result, expected), 'Unit': g.unit,
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
          'Expected Value': fx(cExpected, g.dp + 1), 'Result': fx(cResult, g.dp + 1),
          '%Diff': pctDiff(cResult, cExpected), 'Unit': g.unit,
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


  var API = {
    CATALOG: CATALOG.concat(LISA_CATALOG), COLUMNS: COLUMNS,
    LISA_CATALOG: LISA_CATALOG, LISA_COLUMNS: LISA_COLUMNS,
    generateLisaFile: generateLisaFile,
    generateDataset: generateDataset
  };

  global.Seed = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : this));
