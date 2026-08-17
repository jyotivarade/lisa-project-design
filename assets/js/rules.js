/* ============================================================
   rules.js — Dynamic rule catalog + validation engine.

   Nothing here knows any field name, threshold or control level.
   Rule definitions declare their own parameter schema so the rule
   builder UI can render itself for any field discovered in a file.
   ============================================================ */
(function (global) {
  'use strict';

  var SEVERITIES = [
    { key: 'error', label: 'Error', hint: 'Marks the record FAILED and blocks approval' },
    { key: 'warning', label: 'Warning', hint: 'Flags the record but does not block approval' }
  ];

  var SCOPES = [
    { key: 'control', label: 'Control' },
    { key: 'calibration', label: 'Calibration' },
    { key: 'patient', label: 'Patient' }
  ];

  var CONDITION_OPS = [
    { key: 'equals', label: 'equals' },
    { key: 'not_equals', label: 'does not equal' },
    { key: 'contains', label: 'contains' },
    { key: 'greater_than', label: 'is greater than' },
    { key: 'less_than', label: 'is less than' },
    { key: 'not_blank', label: 'is not empty', noValue: true },
    { key: 'is_blank', label: 'is empty', noValue: true }
  ];

  /* ---------- param helpers ---------- */
  function P(key, label, input, extra) {
    return Object.assign({ key: key, label: label, input: input }, extra || {});
  }
  function ok() { return { ok: true }; }
  function bad(msg) { return { ok: false, message: msg }; }
  function num(p, k, dflt) {
    var v = p[k];
    return U.isBlank(v) ? (dflt === undefined ? NaN : dflt) : parseFloat(v);
  }
  function listOf(v) {
    if (Array.isArray(v)) return v;
    return String(v || '').split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function fmtV(v) { return U.isBlank(v) ? '—' : String(v); }

  /* Formula-style rule shared by number/text/date "custom" options */
  function customParams() {
    return [
      P('left', 'Left expression', 'expr', { placeholder: '[Result] - [Expected Value]', required: true }),
      P('op', 'Operator', 'comparator', { required: true, default: '<=' }),
      P('right', 'Right expression', 'expr', { placeholder: '[Expected Value] * 0.10', required: true })
    ];
  }
  function customDescribe(r) {
    var opLabel = { '<=': '≤', '>=': '≥', '==': '=', '!=': '≠', '<': '<', '>': '>' }[r.params.op] || r.params.op;
    return (r.params.left || '?') + ' ' + opLabel + ' ' + (r.params.right || '?');
  }
  function customTest(value, r, record, ctx) {
    var L = Expr.evaluate(r.params.left, record, ctx.fieldNames);
    if (!L.ok) return bad('Formula error (left): ' + L.error);
    var R = Expr.evaluate(r.params.right, record, ctx.fieldNames);
    if (!R.ok) return bad('Formula error (right): ' + R.error);
    if (Expr.compare(L.value, r.params.op, R.value)) return ok();
    return bad('Formula not satisfied — ' + U.fmtNum(L.value, 3) + ' ' + r.params.op + ' ' + U.fmtNum(R.value, 3) + ' is false');
  }

  /* ============================================================
     Rule catalog, keyed by data type
     ============================================================ */
  var CATALOG = {
    /* ------------------------------- TEXT ------------------------------- */
    text: [
      {
        key: 'required', label: 'Required', hint: 'Value must be present', params: [],
        describe: function () { return 'Value is required'; },
        test: function (v) { return U.isBlank(v) ? bad('Value is missing') : ok(); }
      },
      {
        key: 'equals', label: 'Equals', hint: 'Must match an exact value',
        params: [P('value', 'Expected value', 'text', { required: true }), P('ci', 'Ignore letter case', 'bool', { default: true })],
        describe: function (r) { return 'Equals "' + fmtV(r.params.value) + '"'; },
        test: function (v, r) {
          var a = String(v), b = String(r.params.value);
          if (r.params.ci) { a = a.toLowerCase(); b = b.toLowerCase(); }
          return a === b ? ok() : bad('Expected "' + r.params.value + '", found "' + fmtV(v) + '"');
        }
      },
      {
        key: 'not_equals', label: 'Not Equals', hint: 'Must differ from a value',
        params: [P('value', 'Disallowed value', 'text', { required: true }), P('ci', 'Ignore letter case', 'bool', { default: true })],
        describe: function (r) { return 'Not equal to "' + fmtV(r.params.value) + '"'; },
        test: function (v, r) {
          var a = String(v), b = String(r.params.value);
          if (r.params.ci) { a = a.toLowerCase(); b = b.toLowerCase(); }
          return a !== b ? ok() : bad('Value must not equal "' + r.params.value + '"');
        }
      },
      {
        key: 'contains', label: 'Contains', hint: 'Substring must appear',
        params: [P('value', 'Substring', 'text', { required: true }), P('ci', 'Ignore letter case', 'bool', { default: true })],
        describe: function (r) { return 'Contains "' + fmtV(r.params.value) + '"'; },
        test: function (v, r) {
          var a = String(v), b = String(r.params.value);
          if (r.params.ci) { a = a.toLowerCase(); b = b.toLowerCase(); }
          return a.indexOf(b) > -1 ? ok() : bad('"' + fmtV(v) + '" does not contain "' + r.params.value + '"');
        }
      },
      {
        key: 'starts_with', label: 'Starts With', hint: 'Prefix check',
        params: [P('value', 'Prefix', 'text', { required: true }), P('ci', 'Ignore letter case', 'bool', { default: true })],
        describe: function (r) { return 'Starts with "' + fmtV(r.params.value) + '"'; },
        test: function (v, r) {
          var a = String(v), b = String(r.params.value);
          if (r.params.ci) { a = a.toLowerCase(); b = b.toLowerCase(); }
          return a.indexOf(b) === 0 ? ok() : bad('"' + fmtV(v) + '" does not start with "' + r.params.value + '"');
        }
      },
      {
        key: 'ends_with', label: 'Ends With', hint: 'Suffix check',
        params: [P('value', 'Suffix', 'text', { required: true }), P('ci', 'Ignore letter case', 'bool', { default: true })],
        describe: function (r) { return 'Ends with "' + fmtV(r.params.value) + '"'; },
        test: function (v, r) {
          var a = String(v), b = String(r.params.value);
          if (r.params.ci) { a = a.toLowerCase(); b = b.toLowerCase(); }
          return a.slice(-b.length) === b ? ok() : bad('"' + fmtV(v) + '" does not end with "' + r.params.value + '"');
        }
      },
      {
        key: 'in_list', label: 'In List', hint: 'Value must be one of an allowed set',
        params: [P('values', 'Allowed values (comma separated)', 'list', { required: true, placeholder: 'CONTROL, CALIBRATION, PATIENT' }),
          P('ci', 'Ignore letter case', 'bool', { default: true })],
        describe: function (r) { return 'One of [' + listOf(r.params.values).join(', ') + ']'; },
        test: function (v, r) {
          var allowed = listOf(r.params.values);
          var a = String(v);
          var hit = allowed.some(function (x) { return r.params.ci ? x.toLowerCase() === a.toLowerCase() : x === a; });
          return hit ? ok() : bad('"' + fmtV(v) + '" is not in the allowed list');
        }
      },
      {
        key: 'regex', label: 'Regex Pattern', hint: 'Must match a regular expression',
        params: [P('pattern', 'Pattern', 'text', { required: true, placeholder: '^P[0-9]{4}$', mono: true }),
          P('ci', 'Ignore letter case', 'bool', { default: false })],
        describe: function (r) { return 'Matches /' + fmtV(r.params.pattern) + '/' + (r.params.ci ? 'i' : ''); },
        test: function (v, r) {
          var re;
          try { re = new RegExp(r.params.pattern, r.params.ci ? 'i' : ''); }
          catch (e) { return bad('Invalid regular expression'); }
          return re.test(String(v)) ? ok() : bad('"' + fmtV(v) + '" does not match the required pattern');
        }
      },
      {
        key: 'length', label: 'Length', hint: 'Character-count boundaries',
        params: [P('min', 'Minimum length', 'int'), P('max', 'Maximum length', 'int')],
        describe: function (r) {
          var mn = r.params.min, mx = r.params.max;
          if (!U.isBlank(mn) && !U.isBlank(mx)) return 'Length between ' + mn + ' and ' + mx;
          if (!U.isBlank(mn)) return 'Length ≥ ' + mn;
          if (!U.isBlank(mx)) return 'Length ≤ ' + mx;
          return 'Length (unbounded)';
        },
        test: function (v, r) {
          var L = String(v).length;
          if (!U.isBlank(r.params.min) && L < num(r.params, 'min')) return bad('Length ' + L + ' is below minimum ' + r.params.min);
          if (!U.isBlank(r.params.max) && L > num(r.params, 'max')) return bad('Length ' + L + ' exceeds maximum ' + r.params.max);
          return ok();
        }
      },
      {
        key: 'custom_expression', label: 'Custom Expression', hint: 'Safe formula across any numeric fields',
        params: customParams(), describe: customDescribe, test: customTest, isCustom: true
      }
    ],

    /* ------------------------------ NUMBER ------------------------------ */
    number: [
      {
        key: 'required', label: 'Required', hint: 'Value must be present and numeric', params: [],
        describe: function () { return 'Value is required'; },
        test: function (v) {
          if (U.isBlank(v)) return bad('Value is missing');
          return U.isNumeric(v) ? ok() : bad('"' + v + '" is not a number');
        }
      },
      {
        key: 'equals', label: 'Equals', hint: 'Exact numeric match',
        params: [P('value', 'Expected value', 'number', { required: true }), P('tolerance', 'Tolerance (±)', 'number', { default: 0 })],
        describe: function (r) {
          var t = num(r.params, 'tolerance', 0);
          return 'Equals ' + fmtV(r.params.value) + (t ? ' ± ' + t : '');
        },
        test: function (v, r) {
          var n = U.toNumber(v); if (isNaN(n)) return bad('"' + fmtV(v) + '" is not numeric');
          var t = num(r.params, 'tolerance', 0) || 0;
          return Math.abs(n - num(r.params, 'value')) <= t + 1e-9 ? ok()
            : bad(U.fmtNum(n) + ' does not equal ' + r.params.value + (t ? ' (± ' + t + ')' : ''));
        }
      },
      {
        key: 'not_equals', label: 'Not Equals', hint: 'Must differ from a value',
        params: [P('value', 'Disallowed value', 'number', { required: true })],
        describe: function (r) { return 'Not equal to ' + fmtV(r.params.value); },
        test: function (v, r) {
          var n = U.toNumber(v); if (isNaN(n)) return bad('"' + fmtV(v) + '" is not numeric');
          return Math.abs(n - num(r.params, 'value')) > 1e-9 ? ok() : bad('Value must not equal ' + r.params.value);
        }
      },
      {
        key: 'greater_than', label: 'Greater Than', hint: 'Lower boundary',
        params: [P('value', 'Minimum value', 'number', { required: true }), P('inclusive', 'Allow equal (≥)', 'bool', { default: false })],
        describe: function (r) { return (r.params.inclusive ? '≥ ' : '> ') + fmtV(r.params.value); },
        test: function (v, r) {
          var n = U.toNumber(v); if (isNaN(n)) return bad('"' + fmtV(v) + '" is not numeric');
          var lim = num(r.params, 'value');
          var pass = r.params.inclusive ? n >= lim - 1e-9 : n > lim;
          return pass ? ok() : bad(U.fmtNum(n) + ' is not ' + (r.params.inclusive ? '≥ ' : '> ') + lim);
        }
      },
      {
        key: 'less_than', label: 'Less Than', hint: 'Upper boundary',
        params: [P('value', 'Maximum value', 'number', { required: true }), P('inclusive', 'Allow equal (≤)', 'bool', { default: false })],
        describe: function (r) { return (r.params.inclusive ? '≤ ' : '< ') + fmtV(r.params.value); },
        test: function (v, r) {
          var n = U.toNumber(v); if (isNaN(n)) return bad('"' + fmtV(v) + '" is not numeric');
          var lim = num(r.params, 'value');
          var pass = r.params.inclusive ? n <= lim + 1e-9 : n < lim;
          return pass ? ok() : bad(U.fmtNum(n) + ' is not ' + (r.params.inclusive ? '≤ ' : '< ') + lim);
        }
      },
      {
        key: 'between', label: 'Between', hint: 'Inclusive analytical range',
        params: [P('min', 'Minimum value', 'number', { required: true }), P('max', 'Maximum value', 'number', { required: true })],
        describe: function (r) { return 'Between ' + fmtV(r.params.min) + ' and ' + fmtV(r.params.max); },
        test: function (v, r) {
          var n = U.toNumber(v); if (isNaN(n)) return bad('"' + fmtV(v) + '" is not numeric');
          var mn = num(r.params, 'min'), mx = num(r.params, 'max');
          if (n < mn - 1e-9) return bad(U.fmtNum(n) + ' is below the minimum ' + mn);
          if (n > mx + 1e-9) return bad(U.fmtNum(n) + ' exceeds the maximum ' + mx);
          return ok();
        }
      },
      {
        key: 'outside_range', label: 'Outside Range', hint: 'Value must fall outside a band',
        params: [P('min', 'Range start', 'number', { required: true }), P('max', 'Range end', 'number', { required: true })],
        describe: function (r) { return 'Outside ' + fmtV(r.params.min) + ' – ' + fmtV(r.params.max); },
        test: function (v, r) {
          var n = U.toNumber(v); if (isNaN(n)) return bad('"' + fmtV(v) + '" is not numeric');
          var mn = num(r.params, 'min'), mx = num(r.params, 'max');
          return (n < mn || n > mx) ? ok() : bad(U.fmtNum(n) + ' falls inside the excluded band ' + mn + ' – ' + mx);
        }
      },
      {
        key: 'percentage_difference', label: 'Percentage Difference', hint: 'Deviation from a reference field',
        params: [P('compareField', 'Compare against field', 'field', { required: true, numericOnly: true }),
          P('maxPercent', 'Maximum % difference', 'number', { required: true, default: 10, suffix: '%' })],
        describe: function (r) { return 'Within ' + fmtV(r.params.maxPercent) + '% of [' + fmtV(r.params.compareField) + ']'; },
        test: function (v, r, record) {
          var n = U.toNumber(v); if (isNaN(n)) return bad('"' + fmtV(v) + '" is not numeric');
          var refRaw = record[r.params.compareField];
          if (U.isBlank(refRaw)) return bad('Reference field "' + r.params.compareField + '" is empty');
          var ref = U.toNumber(refRaw);
          if (isNaN(ref)) return bad('Reference field "' + r.params.compareField + '" is not numeric');
          if (ref === 0) return bad('Reference value is zero — % difference undefined');
          var diff = Math.abs((n - ref) / ref) * 100;
          var lim = num(r.params, 'maxPercent');
          return diff <= lim + 1e-9 ? ok()
            : bad('Deviation ' + U.fmtPct(diff, 2) + ' exceeds the allowed ' + U.fmtPct(lim, 2) +
                  ' (value ' + U.fmtNum(n) + ' vs reference ' + U.fmtNum(ref) + ')');
        }
      },
      {
        key: 'expected_comparison', label: 'Expected Value Comparison', hint: 'Agreement with a target/expected field',
        params: [
          P('compareField', 'Expected value field', 'field', { required: true, numericOnly: true }),
          P('tolerance', 'Allowed difference', 'number', { required: true, default: 10 }),
          P('mode', 'Difference measured as', 'select', {
            default: 'percent',
            options: [{ value: 'percent', label: 'Percent of expected (%)' }, { value: 'absolute', label: 'Absolute units' }]
          })
        ],
        describe: function (r) {
          var mode = r.params.mode === 'absolute' ? '' : '%';
          return 'Within ' + fmtV(r.params.tolerance) + mode + ' of expected [' + fmtV(r.params.compareField) + ']';
        },
        test: function (v, r, record) {
          var n = U.toNumber(v);
          if (isNaN(n)) return bad('"' + fmtV(v) + '" is not numeric');
          var refRaw = record[r.params.compareField];
          if (U.isBlank(refRaw)) return bad('Expected field "' + r.params.compareField + '" is empty for this record');
          var ref = U.toNumber(refRaw);
          if (isNaN(ref)) return bad('Expected field "' + r.params.compareField + '" is not numeric');
          var tol = num(r.params, 'tolerance');
          var diff = Math.abs(n - ref);
          if (r.params.mode === 'absolute') {
            return diff <= tol + 1e-9 ? ok()
              : bad('Differs from expected by ' + U.fmtNum(diff, 3) + ', allowed ' + U.fmtNum(tol, 3) +
                    ' (value ' + U.fmtNum(n) + ' vs expected ' + U.fmtNum(ref) + ')');
          }
          if (ref === 0) return bad('Expected value is zero — percentage agreement undefined');
          var pct = diff / Math.abs(ref) * 100;
          return pct <= tol + 1e-9 ? ok()
            : bad('Differs from expected by ' + U.fmtPct(pct, 2) + ', allowed ' + U.fmtPct(tol, 2) +
                  ' (value ' + U.fmtNum(n) + ' vs expected ' + U.fmtNum(ref) + ')');
        }
      },
      {
        key: 'decimal_precision', label: 'Decimal Precision', hint: 'Reported decimal places',
        params: [P('decimals', 'Decimal places', 'int', { required: true, default: 2 }),
          P('mode', 'Comparison', 'select', {
            default: 'at_most',
            options: [{ value: 'at_most', label: 'At most' }, { value: 'exactly', label: 'Exactly' }, { value: 'at_least', label: 'At least' }]
          })],
        describe: function (r) {
          var m = { at_most: 'at most', exactly: 'exactly', at_least: 'at least' }[r.params.mode || 'at_most'];
          return 'Decimal precision ' + m + ' ' + fmtV(r.params.decimals);
        },
        test: function (v, r) {
          if (!U.isNumeric(v)) return bad('"' + fmtV(v) + '" is not numeric');
          var d = U.decimalsOf(v), want = num(r.params, 'decimals'), mode = r.params.mode || 'at_most';
          if (mode === 'exactly' && d !== want) return bad('Reported with ' + d + ' decimal(s), expected exactly ' + want);
          if (mode === 'at_most' && d > want) return bad('Reported with ' + d + ' decimal(s), maximum allowed is ' + want);
          if (mode === 'at_least' && d < want) return bad('Reported with ' + d + ' decimal(s), minimum required is ' + want);
          return ok();
        }
      },
      {
        key: 'custom_formula', label: 'Custom Formula', hint: 'Safe formula across any numeric fields',
        params: customParams(), describe: customDescribe, test: customTest, isCustom: true
      }
    ],

    /* ------------------------------- DATE ------------------------------- */
    date: [
      {
        key: 'required', label: 'Required', hint: 'Date must be present', params: [],
        describe: function () { return 'Date is required'; },
        test: function (v) { return U.isBlank(v) ? bad('Date is missing') : ok(); }
      },
      {
        key: 'valid_date', label: 'Valid Date', hint: 'Must parse as a real date', params: [],
        describe: function () { return 'Must be a valid date'; },
        test: function (v) { return U.isDateLike(v) ? ok() : bad('"' + fmtV(v) + '" is not a recognisable date'); }
      },
      {
        key: 'before', label: 'Before', hint: 'Earlier than a fixed date',
        params: [P('date', 'Must be before', 'date', { required: true })],
        describe: function (r) { return 'Before ' + U.fmtDate(r.params.date); },
        test: function (v, r) {
          if (!U.isDateLike(v)) return bad('"' + fmtV(v) + '" is not a valid date');
          return U.parseDate(v) < U.parseDate(r.params.date) ? ok()
            : bad(U.fmtDate(U.parseDate(v)) + ' is not before ' + U.fmtDate(r.params.date));
        }
      },
      {
        key: 'after', label: 'After', hint: 'Later than a fixed date',
        params: [P('date', 'Must be after', 'date', { required: true })],
        describe: function (r) { return 'After ' + U.fmtDate(r.params.date); },
        test: function (v, r) {
          if (!U.isDateLike(v)) return bad('"' + fmtV(v) + '" is not a valid date');
          return U.parseDate(v) > U.parseDate(r.params.date) ? ok()
            : bad(U.fmtDate(U.parseDate(v)) + ' is not after ' + U.fmtDate(r.params.date));
        }
      },
      {
        key: 'between_dates', label: 'Between', hint: 'Within a date window',
        params: [P('start', 'From', 'date', { required: true }), P('end', 'To', 'date', { required: true })],
        describe: function (r) { return 'Between ' + U.fmtDate(r.params.start) + ' and ' + U.fmtDate(r.params.end); },
        test: function (v, r) {
          if (!U.isDateLike(v)) return bad('"' + fmtV(v) + '" is not a valid date');
          var d = U.parseDate(v);
          if (d < U.parseDate(r.params.start)) return bad(U.fmtDate(d) + ' is before the allowed window');
          if (d > U.parseDate(r.params.end)) return bad(U.fmtDate(d) + ' is after the allowed window');
          return ok();
        }
      },
      {
        key: 'not_future', label: 'Not Future', hint: 'Cannot be dated ahead of today', params: [],
        describe: function () { return 'Must not be a future date'; },
        test: function (v) {
          if (!U.isDateLike(v)) return bad('"' + fmtV(v) + '" is not a valid date');
          var d = U.parseDate(v), today = new Date(); today.setHours(23, 59, 59, 999);
          return d <= today ? ok() : bad(U.fmtDate(d) + ' is in the future');
        }
      },
      {
        key: 'custom_expression', label: 'Custom Expression', hint: 'Safe formula across any numeric fields',
        params: customParams(), describe: customDescribe, test: customTest, isCustom: true
      }
    ],

    /* ------------------------------ BOOLEAN ----------------------------- */
    boolean: [
      {
        key: 'required', label: 'Required', hint: 'Flag must be present', params: [],
        describe: function () { return 'Value is required'; },
        test: function (v) { return U.isBlank(v) ? bad('Value is missing') : ok(); }
      },
      {
        key: 'is_true', label: 'Must be TRUE', hint: 'Flag must be affirmative', params: [],
        describe: function () { return 'Must be TRUE'; },
        test: function (v) { return U.toBool(v) ? ok() : bad('Expected TRUE, found "' + fmtV(v) + '"'); }
      },
      {
        key: 'is_false', label: 'Must be FALSE', hint: 'Flag must be negative', params: [],
        describe: function () { return 'Must be FALSE'; },
        test: function (v) { return !U.toBool(v) ? ok() : bad('Expected FALSE, found "' + fmtV(v) + '"'); }
      }
    ]
  };

  function catalogFor(dataType) { return CATALOG[dataType] || CATALOG.text; }
  function def(dataType, ruleType) {
    return catalogFor(dataType).filter(function (d) { return d.key === ruleType; })[0] || null;
  }
  function ruleLabel(rule) {
    var d = def(rule.dataType, rule.type);
    return d ? d.label : U.titleCase(rule.type);
  }
  function describe(rule) {
    var d = def(rule.dataType, rule.type);
    try { return d ? d.describe(rule) : ''; } catch (e) { return ''; }
  }
  function defaultParams(dataType, ruleType) {
    var d = def(dataType, ruleType); var p = {};
    if (!d) return p;
    d.params.forEach(function (spec) { if (spec.default !== undefined) p[spec.key] = spec.default; });
    return p;
  }

  /** Validate a rule's parameters before saving. → {ok, errors:{key:msg}} */
  function validateRule(rule, ctx) {
    var d = def(rule.dataType, rule.type);
    var errors = {};
    if (!d) return { ok: false, errors: { type: 'Unknown rule type' } };
    d.params.forEach(function (spec) {
      var v = rule.params[spec.key];
      if (spec.required && U.isBlank(v) && spec.input !== 'bool') { errors[spec.key] = spec.label + ' is required'; return; }
      if (U.isBlank(v)) return;
      if ((spec.input === 'number' || spec.input === 'int') && isNaN(parseFloat(v))) errors[spec.key] = 'Must be a number';
      if (spec.input === 'int' && !/^-?\d+$/.test(String(v).trim())) errors[spec.key] = 'Must be a whole number';
      if (spec.input === 'expr') {
        var c = Expr.compile(v, ctx && ctx.fieldNames);
        if (!c.ok) errors[spec.key] = c.error;
      }
      if (spec.input === 'list' && !listOf(v).length) errors[spec.key] = 'Provide at least one value';
      if (rule.type === 'regex' && spec.key === 'pattern') {
        try { new RegExp(v); } catch (e) { errors[spec.key] = 'Invalid regular expression'; }
      }
    });
    if (rule.type === 'between' && !errors.min && !errors.max &&
        parseFloat(rule.params.min) > parseFloat(rule.params.max)) errors.max = 'Maximum must be greater than minimum';
    if (rule.type === 'length' && U.isBlank(rule.params.min) && U.isBlank(rule.params.max)) {
      errors.min = 'Provide a minimum or a maximum';
    }
    if (!rule.scope || !rule.scope.length) errors.scope = 'Select at least one sample type';
    return { ok: !Object.keys(errors).length, errors: errors };
  }

  /* ============================================================
     Evaluation
     ============================================================ */
  function newRule(fields, opts) {
    opts = opts || {};
    var field = opts.field || (fields[0] && fields[0].name) || '';
    var f = fields.filter(function (x) { return x.name === field; })[0];
    var dataType = opts.dataType || (f ? f.type : 'text');
    var type = opts.type || catalogFor(dataType)[0].key;
    return {
      id: U.uid('rule'),
      field: field,
      dataType: dataType,
      type: type,
      params: defaultParams(dataType, type),
      severity: 'error',
      scope: ['control', 'calibration', 'patient'],
      enabled: true,
      condition: null,
      note: '',
      createdAt: new Date().toISOString()
    };
  }

  function appliesTo(rule, sampleType) {
    if (!rule.enabled) return false;
    if (!sampleType) return true;
    return (rule.scope || []).indexOf(sampleType) > -1;
  }

  function conditionHolds(rule, record) {
    var c = rule.condition;
    if (!c || !c.field) return true;
    var v = record[c.field];
    switch (c.op) {
      case 'is_blank': return U.isBlank(v);
      case 'not_blank': return !U.isBlank(v);
      case 'equals': return String(v).toLowerCase() === String(c.value).toLowerCase();
      case 'not_equals': return String(v).toLowerCase() !== String(c.value).toLowerCase();
      case 'contains': return String(v).toLowerCase().indexOf(String(c.value).toLowerCase()) > -1;
      case 'greater_than': return U.toNumber(v) > parseFloat(c.value);
      case 'less_than': return U.toNumber(v) < parseFloat(c.value);
    }
    return true;
  }

  function conditionText(rule) {
    var c = rule.condition;
    if (!c || !c.field) return '';
    var opDef = CONDITION_OPS.filter(function (o) { return o.key === c.op; })[0];
    return 'IF [' + c.field + '] ' + (opDef ? opDef.label : c.op) + (opDef && opDef.noValue ? '' : ' "' + c.value + '"') + ' THEN';
  }

  /** Evaluate one rule against one record. → {ok, message} | null when skipped */
  function evalRule(rule, record, ctx) {
    if (!conditionHolds(rule, record)) return null;
    var value = record[rule.field];
    var d = def(rule.dataType, rule.type);
    if (!d) return bad('Rule type "' + rule.type + '" is not available for ' + rule.dataType + ' fields');
    // "Required" is the only rule that asserts presence; others skip blanks (nothing to assert).
    if (U.isBlank(value) && rule.type !== 'required' && !d.isCustom) return null;
    var res;
    try { res = d.test(value, rule, record, ctx || { fieldNames: Object.keys(record) }); }
    catch (e) { res = bad('Rule could not be evaluated: ' + e.message); }
    return res && res.ok ? ok() : { ok: false, message: (res && res.message) || 'Validation failed' };
  }

  /**
   * Evaluate every applicable rule for a record, honouring per-field group logic.
   * → { status:'pass'|'warning'|'fail', failures:[], warnings:[], evaluated:n }
   */
  function evalRecord(record, sampleType, rules, ctx) {
    ctx = ctx || {};
    var logic = ctx.fieldLogic || {};
    var byField = {};
    rules.forEach(function (r) {
      if (!appliesTo(r, sampleType)) return;
      (byField[r.field] = byField[r.field] || []).push(r);
    });

    var failures = [], warnings = [], evaluated = 0;

    Object.keys(byField).forEach(function (field) {
      var group = byField[field];
      var mode = logic[field] === 'ANY' ? 'ANY' : 'ALL';
      var results = group.map(function (r) {
        var res = evalRule(r, record, ctx);
        if (res) evaluated++;
        return { rule: r, res: res };
      }).filter(function (x) { return x.res !== null; });

      if (!results.length) return;

      var failed = results.filter(function (x) { return !x.res.ok; });

      if (mode === 'ANY') {
        var anyPassed = results.some(function (x) { return x.res.ok; });
        if (anyPassed) return;
        // no branch satisfied → report the group
        var sev = failed.some(function (x) { return x.rule.severity === 'error'; }) ? 'error' : 'warning';
        var entry = {
          field: field, logic: 'ANY', severity: sev,
          ruleId: failed[0] ? failed[0].rule.id : null,
          rule: failed.map(function (x) { return ruleLabel(x.rule); }).join(' OR '),
          description: failed.map(function (x) { return describe(x.rule); }).join(' OR '),
          message: 'No alternative condition was satisfied — ' + failed.map(function (x) { return x.res.message; }).join('; ')
        };
        (sev === 'error' ? failures : warnings).push(entry);
        return;
      }

      failed.forEach(function (x) {
        var entry = {
          field: field, logic: 'ALL', severity: x.rule.severity,
          ruleId: x.rule.id,
          rule: ruleLabel(x.rule),
          description: describe(x.rule),
          message: x.res.message
        };
        (x.rule.severity === 'error' ? failures : warnings).push(entry);
      });
    });

    return {
      status: failures.length ? 'fail' : (warnings.length ? 'warning' : 'pass'),
      failures: failures, warnings: warnings, evaluated: evaluated
    };
  }

  /**
   * Run rules over a set of records.
   * → { total, passed, failed, warning, rows:[{record, status, failures, warnings}] }
   */
  function runSet(records, sampleType, rules, ctx, opts) {
    opts = opts || {};
    var out = { total: records.length, passed: 0, failed: 0, warning: 0, rows: [] };
    var keepAll = opts.keepAll !== false;
    var keepLimit = opts.keepLimit || Infinity;
    records.forEach(function (rec, idx) {
      var r = evalRecord(rec, sampleType, rules, ctx);
      if (r.status === 'pass') out.passed++;
      else if (r.status === 'fail') out.failed++;
      else out.warning++;
      if (keepAll && out.rows.length < keepLimit) {
        out.rows.push({ index: idx, record: rec, status: r.status, failures: r.failures, warnings: r.warnings });
      }
    });
    return out;
  }

  global.Rules = {
    CATALOG: CATALOG, SEVERITIES: SEVERITIES, SCOPES: SCOPES, CONDITION_OPS: CONDITION_OPS,
    catalogFor: catalogFor, def: def, ruleLabel: ruleLabel, describe: describe,
    defaultParams: defaultParams, validateRule: validateRule, newRule: newRule,
    appliesTo: appliesTo, conditionHolds: conditionHolds, conditionText: conditionText,
    evalRule: evalRule, evalRecord: evalRecord, runSet: runSet, listOf: listOf
  };
}(typeof window !== 'undefined' ? window : this));
