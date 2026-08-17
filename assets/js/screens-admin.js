/* ============================================================
   screens-admin.js — cross-analytic Rules Engine, Control &
   Calibration index, Patient Testing index, Validation History,
   Reports, Audit Logs and Settings.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  /* ============================================================
     RULES ENGINE (all analytics)
     ============================================================ */
  Screens.rulesEngine = function () {
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Rules Engine',
      sub: 'Every validation rule across every analytic, with the rule library available for any detected field.'
    }));

    var rows = [];
    Store.all().forEach(function (a) {
      a.rules.forEach(function (r) {
        rows.push({ analytic: a, rule: r });
      });
    });

    var tiles = el('div', { class: 'grid g4' });
    var byType = {};
    rows.forEach(function (x) { byType[x.rule.type] = (byType[x.rule.type] || 0) + 1; });
    var topType = Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; })[0];
    tiles.innerHTML =
      UI.stat({ label: 'Rules configured', value: U.fmtInt(rows.length), icon: 'rules', tone: 'violet', note: 'across ' + Store.all().filter(function (a) { return a.rules.length; }).length + ' analytics' }) +
      UI.stat({ label: 'Error severity', value: U.fmtInt(rows.filter(function (x) { return x.rule.severity === 'error'; }).length), icon: 'x', tone: 'red', note: 'block approval when they fail' }) +
      UI.stat({ label: 'Warning severity', value: U.fmtInt(rows.filter(function (x) { return x.rule.severity === 'warning'; }).length), icon: 'warning', tone: 'amber', note: 'advisory flags only' }) +
      UI.stat({ label: 'Most used rule type', value: topType ? U.titleCase(topType) : '—', icon: 'target', tone: 'blue', note: topType ? byType[topType] + ' instances' : '' });
    wrap.appendChild(tiles);

    var table = UI.dataTable({
      title: 'All validation rules', rows: rows, pageSize: 25, compact: true, unit: 'rules',
      searchPlaceholder: 'Search analytic, field or rule…',
      searchText: function (x) { return [x.analytic.name, x.rule.field, Rules.ruleLabel(x.rule), Rules.describe(x.rule)].join(' '); },
      filters: [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'error', label: 'Error', count: rows.filter(function (x) { return x.rule.severity === 'error'; }).length, test: function (x) { return x.rule.severity === 'error'; } },
        { key: 'warning', label: 'Warning', count: rows.filter(function (x) { return x.rule.severity === 'warning'; }).length, test: function (x) { return x.rule.severity === 'warning'; } },
        { key: 'off', label: 'Disabled', count: rows.filter(function (x) { return !x.rule.enabled; }).length, test: function (x) { return !x.rule.enabled; } },
        { key: 'custom', label: 'Custom formula', count: rows.filter(function (x) { return /custom/.test(x.rule.type); }).length, test: function (x) { return /custom/.test(x.rule.type); } }
      ],
      columns: [
        { key: 'analytic', label: 'Analytic', value: function (x) { return x.analytic.name; }, render: function (x) { return '<span class="cell-strong">' + esc(x.analytic.name) + '</span><div class="cell-sub">v' + esc(x.analytic.version) + '</div>'; } },
        { key: 'field', label: 'Field', value: function (x) { return x.rule.field; }, render: function (x) { return esc(x.rule.field) + ' ' + UI.typeBadge(x.rule.dataType); } },
        { key: 'rule', label: 'Rule', value: function (x) { return Rules.ruleLabel(x.rule); }, render: function (x) { return '<span class="cell-strong">' + esc(Rules.ruleLabel(x.rule)) + '</span>'; } },
        { key: 'def', label: 'Definition', sortable: false, render: function (x) { return '<span class="mono" style="font-size:12px">' + esc(Rules.describe(x.rule)) + '</span>'; } },
        { key: 'scope', label: 'Applies to', sortable: false, render: function (x) { return UI.scopeBadges(x.rule.scope); } },
        { key: 'severity', label: 'Severity', value: function (x) { return x.rule.severity; }, render: function (x) { return UI.severityBadge(x.rule.severity); } },
        { key: 'enabled', label: 'Status', value: function (x) { return x.rule.enabled ? 1 : 0; }, render: function (x) { return x.rule.enabled ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Disabled</span>'; } },
        {
          key: 'actions', label: '', sortable: false, render: function (x) {
            var b = el('div', { class: 'tbl-actions' });
            b.appendChild(UI.btn('Open', 'btn-secondary btn-xs', function () { App.go('analytic/' + x.analytic.id + '/rules'); }));
            return b;
          }
        }
      ],
      exportName: 'analytix_rules_engine',
      empty: { icon: 'rules', title: 'No rules configured yet', desc: 'Open an analytic, upload a sample file and build rules for the fields it contains.' }
    });
    var c = Screens.card({ flush: true, body: table });
    c.classList.add('mt4');
    wrap.appendChild(c);

    /* rule library reference */
    var lib = el('div', { class: 'grid g4' });
    ['text', 'number', 'date', 'boolean'].forEach(function (t) {
      var card = el('div', { class: 'card' });
      card.innerHTML = '<div class="card-head">' + UI.typeBadge(t) +
        '<span class="badge badge-neutral">' + Rules.catalogFor(t).length + ' rule types</span></div>' +
        '<div class="card-body tight"><div class="col" style="gap:7px">' +
        Rules.catalogFor(t).map(function (d) {
          return '<div style="font-size:12.5px"><strong>' + esc(d.label) + '</strong>' +
            '<div class="cell-sub">' + esc(d.hint || '') + '</div></div>';
        }).join('') + '</div></div>';
      lib.appendChild(card);
    });
    wrap.appendChild(el('h3', { class: 'section-title mt5 mb3', text: 'Rule library — available for any detected field' }));
    wrap.appendChild(lib);
    return wrap;
  };

  /* ============================================================
     CONTROL & CALIBRATION INDEX
     ============================================================ */
  Screens.validationIndex = function () {
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Control & Calibration',
      sub: 'QC validation status for every analytic — controls and calibration are always validated together from one file.'
    }));

    var rows = Store.all().map(function (a) {
      var g = Store.groups(a);
      return { a: a, g: g, passed: Store.validationPassed(a), state: Store.stateOf(a) };
    });

    var table = UI.dataTable({
      title: 'QC validation status', rows: rows, unit: 'analytics', pageSize: 25,
      searchPlaceholder: 'Search analytics…',
      searchText: function (r) { return r.a.name + ' ' + r.a.code; },
      filters: [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'passed', label: 'Passed', count: rows.filter(function (r) { return r.passed; }).length, test: function (r) { return r.passed; } },
        { key: 'failed', label: 'Failed', count: rows.filter(function (r) { return (r.a.validation.controls || r.a.validation.calibration) && !r.passed; }).length, test: function (r) { return (r.a.validation.controls || r.a.validation.calibration) && !r.passed; } },
        { key: 'notrun', label: 'Not run', count: rows.filter(function (r) { return !r.a.validation.controls && !r.a.validation.calibration; }).length, test: function (r) { return !r.a.validation.controls && !r.a.validation.calibration; } }
      ],
      columns: [
        { key: 'name', label: 'Analytic', value: function (r) { return r.a.name; }, render: function (r) { return '<span class="cell-strong">' + esc(r.a.name) + '</span><div class="cell-sub">' + esc(r.a.code || r.a.id) + ' · v' + esc(r.a.version) + '</div>'; } },
        { key: 'file', label: 'Sample file', sortable: false, render: function (r) { return r.a.file ? esc(r.a.file.name) + '<div class="cell-sub">' + U.fmtInt(r.a.file.recordCount) + ' records</div>' : '<span class="muted">none</span>'; } },
        { key: 'ctl', label: 'Controls', align: 'right', value: function (r) { return r.a.validation.controls ? r.a.validation.controls.passed / Math.max(1, r.a.validation.controls.total) : -1; }, render: function (r) { return qcCell(r.a.validation.controls, r.g.control.length); } },
        { key: 'cal', label: 'Calibration', align: 'right', value: function (r) { return r.a.validation.calibration ? r.a.validation.calibration.passed / Math.max(1, r.a.validation.calibration.total) : -1; }, render: function (r) { return qcCell(r.a.validation.calibration, r.g.calibration.length); } },
        { key: 'approved', label: 'Approval', value: function (r) { return r.a.validation.approved ? 1 : 0; }, render: function (r) { return r.a.validation.approved ? '<span class="badge badge-success">Approved</span><div class="cell-sub">' + esc(U.fmtDate(r.a.validation.approvedAt)) + '</div>' : '<span class="badge badge-warn">Pending</span>'; } },
        { key: 'patient', label: 'Patient testing', sortable: false, render: function (r) { return Store.patientUnlocked(r.a) ? '<span class="badge badge-success">' + U.icon('unlock', 11) + ' Unlocked</span>' : '<span class="badge badge-danger">' + U.icon('lock', 11) + ' Locked</span>'; } },
        {
          key: 'actions', label: '', sortable: false, render: function (r) {
            var b = el('div', { class: 'tbl-actions' });
            b.appendChild(UI.btn(r.passed ? 'Open' : 'Validate', 'btn-secondary btn-xs', function () { App.go('analytic/' + r.a.id + '/validation'); }));
            return b;
          }
        }
      ],
      exportName: 'analytix_qc_status'
    });
    wrap.appendChild(Screens.card({ flush: true, body: table }));
    return wrap;
  };

  function qcCell(res, total) {
    if (!total) return '<span class="muted">none in file</span>';
    if (!res) return '<span class="badge badge-neutral">not run</span>';
    var ok = res.failed === 0;
    return '<span class="badge ' + (ok ? 'badge-success' : 'badge-danger') + '">' +
      U.fmtInt(res.passed) + ' / ' + U.fmtInt(res.total) + '</span>' +
      (res.warning ? '<div class="cell-sub">' + res.warning + ' warning(s)</div>' : '');
  }

  /* ============================================================
     PATIENT TESTING INDEX
     ============================================================ */
  Screens.patientIndex = function () {
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Patient Testing',
      sub: 'Patient sample runs use the records already present in each analytic’s uploaded file.'
    }));

    var o = Store.overview();
    var tiles = el('div', { class: 'grid g4' });
    tiles.innerHTML =
      UI.stat({ label: 'Samples tested', value: U.fmtInt(o.patientsTested), icon: 'flask', tone: 'blue' }) +
      UI.stat({ label: 'Passed', value: U.fmtInt(o.patientsPassed), icon: 'check', tone: 'green', note: o.passRate === null ? '' : U.fmtPct(o.passRate) + ' pass rate' }) +
      UI.stat({ label: 'Failed', value: U.fmtInt(o.patientsFailed), icon: 'x', tone: 'red' }) +
      UI.stat({ label: 'Warnings', value: U.fmtInt(o.patientsWarning), icon: 'warning', tone: 'amber' });
    wrap.appendChild(tiles);

    var rows = Store.all().map(function (a) {
      return { a: a, unlocked: Store.patientUnlocked(a), pt: a.patientTesting, g: Store.groups(a) };
    });

    var table = UI.dataTable({
      title: 'Patient testing status', rows: rows, unit: 'analytics', pageSize: 25,
      searchPlaceholder: 'Search analytics…',
      searchText: function (r) { return r.a.name + ' ' + r.a.code; },
      filters: [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'unlocked', label: 'Unlocked', count: rows.filter(function (r) { return r.unlocked; }).length, test: function (r) { return r.unlocked; } },
        { key: 'locked', label: 'Locked', count: rows.filter(function (r) { return !r.unlocked; }).length, test: function (r) { return !r.unlocked; } },
        { key: 'tested', label: 'Has results', count: rows.filter(function (r) { return r.pt.summary; }).length, test: function (r) { return !!r.pt.summary; } }
      ],
      columns: [
        { key: 'name', label: 'Analytic', value: function (r) { return r.a.name; }, render: function (r) { return '<span class="cell-strong">' + esc(r.a.name) + '</span><div class="cell-sub">v' + esc(r.a.version) + '</div>'; } },
        { key: 'available', label: 'Patient samples', align: 'right', value: function (r) { return r.g.patient.length; }, render: function (r) { return U.fmtInt(r.g.patient.length); } },
        { key: 'lock', label: 'Access', sortable: false, render: function (r) { return r.unlocked ? '<span class="badge badge-success">' + U.icon('unlock', 11) + ' Unlocked</span>' : '<span class="badge badge-danger">' + U.icon('lock', 11) + ' Locked</span>'; } },
        { key: 'pass', label: 'Pass', align: 'right', value: function (r) { return r.pt.summary ? r.pt.summary.passed : -1; }, render: function (r) { return r.pt.summary ? '<span style="color:var(--green-700);font-weight:650">' + U.fmtInt(r.pt.summary.passed) + '</span>' : '<span class="muted">—</span>'; } },
        { key: 'fail', label: 'Fail', align: 'right', value: function (r) { return r.pt.summary ? r.pt.summary.failed : -1; }, render: function (r) { return r.pt.summary ? '<span style="color:var(--red-700);font-weight:650">' + U.fmtInt(r.pt.summary.failed) + '</span>' : '<span class="muted">—</span>'; } },
        { key: 'warn', label: 'Warning', align: 'right', value: function (r) { return r.pt.summary ? r.pt.summary.warning : -1; }, render: function (r) { return r.pt.summary ? '<span style="color:var(--amber-700);font-weight:650">' + U.fmtInt(r.pt.summary.warning) + '</span>' : '<span class="muted">—</span>'; } },
        { key: 'when', label: 'Last run', value: function (r) { return r.pt.completedAt || ''; }, render: function (r) { return r.pt.completedAt ? esc(U.fmtDateTime(r.pt.completedAt)) : '<span class="muted">—</span>'; } },
        {
          key: 'actions', label: '', sortable: false, render: function (r) {
            var b = el('div', { class: 'tbl-actions' });
            b.appendChild(UI.btn(r.unlocked ? (r.pt.summary ? 'Results' : 'Start') : 'Unlock', 'btn-secondary btn-xs', function () {
              App.go('analytic/' + r.a.id + '/' + (r.unlocked ? (r.pt.summary ? 'results' : 'patient') : 'validation'));
            }));
            return b;
          }
        }
      ],
      exportName: 'analytix_patient_testing'
    });
    var c = Screens.card({ flush: true, body: table });
    c.classList.add('mt4');
    wrap.appendChild(c);
    return wrap;
  };

  /* ============================================================
     VALIDATION HISTORY (all analytics)
     ============================================================ */
  Screens.history = function () {
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Validation History',
      sub: 'Every configuration version, its QC outcome and the patient volume released under it.'
    }));

    var rows = [];
    Store.all().forEach(function (a) {
      var v = a.validation;
      rows.push({
        a: a, version: a.version, current: true,
        ruleCount: a.rules.length,
        controls: v.controls ? (v.controls.failed ? 'Failed' : 'Passed') : '—',
        calibration: v.calibration ? (v.calibration.failed ? 'Failed' : 'Passed') : '—',
        patientTests: a.patientTesting.summary ? a.patientTesting.summary.total : null,
        status: v.approved ? 'Active' : (v.controls || v.calibration ? (Store.validationPassed(a) ? 'Awaiting approval' : 'Failed') : 'Draft'),
        approvedAt: v.approvedAt, createdAt: a.updatedAt
      });
      a.versions.filter(function (x) { return x.version !== a.version; }).forEach(function (x) {
        rows.push({
          a: a, version: x.version, ruleCount: x.ruleCount, controls: x.controls, calibration: x.calibration,
          patientTests: x.patientTests, status: x.status, approvedAt: x.approvedAt, createdAt: x.createdAt
        });
      });
    });

    var table = UI.dataTable({
      title: 'Configuration versions', rows: rows, unit: 'versions', pageSize: 25, compact: true,
      defaultSort: 'when', defaultDir: 'desc',
      searchPlaceholder: 'Search analytic or version…',
      searchText: function (r) { return r.a.name + ' v' + r.version + ' ' + r.status; },
      filters: [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'active', label: 'Active', count: rows.filter(function (r) { return r.status === 'Active'; }).length, test: function (r) { return r.status === 'Active'; } },
        { key: 'archived', label: 'Archived', count: rows.filter(function (r) { return r.status === 'Archived'; }).length, test: function (r) { return r.status === 'Archived'; } },
        { key: 'failed', label: 'Failed', count: rows.filter(function (r) { return r.status === 'Failed'; }).length, test: function (r) { return r.status === 'Failed'; } }
      ],
      columns: [
        { key: 'analytic', label: 'Analytic', value: function (r) { return r.a.name; }, render: function (r) { return '<span class="cell-strong">' + esc(r.a.name) + '</span>'; } },
        { key: 'version', label: 'Version', value: function (r) { return parseFloat(r.version); }, render: function (r) { return 'v' + esc(r.version) + (r.current ? ' <span class="badge badge-info">current</span>' : ''); } },
        { key: 'rules', label: 'Rules', align: 'right', value: function (r) { return r.ruleCount || 0; }, render: function (r) { return 'v' + esc(r.version) + ' <span class="cell-sub">(' + (r.ruleCount || '—') + ')</span>'; } },
        { key: 'controls', label: 'Controls', value: function (r) { return r.controls; }, render: function (r) { return Screens.statusText(r.controls); } },
        { key: 'calibration', label: 'Calibration', value: function (r) { return r.calibration; }, render: function (r) { return Screens.statusText(r.calibration); } },
        { key: 'patientTests', label: 'Patient Tests', align: 'right', value: function (r) { return r.patientTests || 0; }, render: function (r) { return r.patientTests ? U.fmtInt(r.patientTests) : '<span class="muted">—</span>'; } },
        { key: 'when', label: 'Date', value: function (r) { return r.approvedAt || r.createdAt || ''; }, render: function (r) { return esc(U.fmtDate(r.approvedAt || r.createdAt)); } },
        { key: 'status', label: 'Status', value: function (r) { return r.status; }, render: function (r) { return Screens.versionStatus(r.status); } },
        {
          key: 'actions', label: '', sortable: false, render: function (r) {
            var b = el('div', { class: 'tbl-actions' });
            b.appendChild(UI.btn('Open', 'btn-secondary btn-xs', function () { App.go('analytic/' + r.a.id + '/history'); }));
            return b;
          }
        }
      ],
      exportName: 'analytix_validation_history'
    });
    wrap.appendChild(Screens.card({ flush: true, body: table }));
    return wrap;
  };

  /* ============================================================
     REPORTS
     ============================================================ */
  Screens.reports = function () {
    var o = Store.overview();
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Reports',
      sub: 'Validation and patient testing summaries ready for export or review.',
      actions: [UI.btn('Export summary CSV', 'btn-primary', exportSummary, { icon: 'download' })]
    }));

    var tiles = el('div', { class: 'grid g4' });
    tiles.innerHTML =
      UI.stat({ label: 'Approved configurations', value: U.fmtInt(Store.all().filter(function (a) { return a.validation.approved; }).length), icon: 'check', tone: 'green' }) +
      UI.stat({ label: 'Patient samples released', value: U.fmtInt(o.patientsTested), icon: 'flask', tone: 'blue' }) +
      UI.stat({ label: 'Overall pass rate', value: o.passRate === null ? '—' : U.fmtPct(o.passRate), icon: 'target', tone: 'teal' }) +
      UI.stat({ label: 'QC failures on record', value: U.fmtInt(o.qcFailed), icon: 'warning', tone: 'amber' });
    wrap.appendChild(tiles);

    /* per-analytic outcome bars */
    var body = el('div', { class: 'list-rows' });
    Store.all().forEach(function (a) {
      var s = a.patientTesting.summary;
      var row = el('div', { class: 'lr' });
      var bar = s
        ? '<div class="progress-multi" style="width:220px">' +
          '<i class="p" style="width:' + (s.passed / s.total * 100) + '%"></i>' +
          '<i class="w" style="width:' + (s.warning / s.total * 100) + '%"></i>' +
          '<i class="f" style="width:' + (s.failed / s.total * 100) + '%"></i></div>'
        : '<span class="muted" style="font-size:12.5px">No patient run under the current configuration</span>';
      row.innerHTML =
        '<div class="lr-main"><div class="lr-t">' + esc(a.name) + ' <span class="badge badge-info">v' + esc(a.version) + '</span></div>' +
        '<div class="lr-d">' + (s ? U.fmtInt(s.total) + ' tested · ' + U.fmtInt(s.passed) + ' pass · ' +
          U.fmtInt(s.failed) + ' fail · ' + U.fmtInt(s.warning) + ' warning' : Store.stateOf(a).replace(/_/g, ' ')) + '</div></div>' +
        bar;
      var act = el('div', { class: 'lr-act' });
      act.appendChild(UI.btn(s ? 'Results' : 'Open', 'btn-secondary btn-sm', function () {
        App.go('analytic/' + a.id + (s ? '/results' : ''));
      }));
      row.appendChild(act);
      body.appendChild(row);
    });
    var c = Screens.card({ title: 'Patient outcome by analytic', flush: true, body: body });
    c.classList.add('mt4');
    wrap.appendChild(c);

    /* failure reason ranking across analytics */
    var reasons = {};
    Store.all().forEach(function (a) {
      (a.patientTesting.results || []).forEach(function (r) {
        (r.failures || []).forEach(function (f) {
          var k = a.name + ' · [' + f.field + '] ' + f.rule;
          reasons[k] = (reasons[k] || 0) + 1;
        });
      });
    });
    var ranked = Object.keys(reasons).map(function (k) { return { reason: k, count: reasons[k] }; })
      .sort(function (x, y) { return y.count - x.count; }).slice(0, 12);
    if (ranked.length) {
      var max = ranked[0].count;
      var rBody = el('div', { class: 'list-rows' });
      ranked.forEach(function (r) {
        var row = el('div', { class: 'lr' });
        row.innerHTML = '<div class="lr-main"><div class="lr-t" style="font-weight:600">' + esc(r.reason) + '</div>' +
          '<div class="progress mt2" style="max-width:420px"><div class="bar red" style="width:' + (r.count / max * 100) + '%"></div></div></div>' +
          '<span class="badge badge-danger">' + U.fmtInt(r.count) + '</span>';
        rBody.appendChild(row);
      });
      var rc = Screens.card({ title: 'Top failure reasons', flush: true, body: rBody });
      rc.classList.add('mt4');
      wrap.appendChild(rc);
    }
    return wrap;
  };

  function exportSummary() {
    var cols = ['Analytic', 'Code', 'Version', 'State', 'Records', 'Control passed', 'Control total',
      'Calibration passed', 'Calibration total', 'Approved', 'Patient tested', 'Patient passed', 'Patient failed', 'Patient warning'];
    var rows = Store.all().map(function (a) {
      var v = a.validation, s = a.patientTesting.summary;
      return {
        'Analytic': a.name, 'Code': a.code, 'Version': 'v' + a.version, 'State': Store.stateOf(a),
        'Records': a.file ? a.file.recordCount : 0,
        'Control passed': v.controls ? v.controls.passed : '', 'Control total': v.controls ? v.controls.total : '',
        'Calibration passed': v.calibration ? v.calibration.passed : '', 'Calibration total': v.calibration ? v.calibration.total : '',
        'Approved': v.approved ? U.isoDate(v.approvedAt) : 'No',
        'Patient tested': s ? s.total : '', 'Patient passed': s ? s.passed : '',
        'Patient failed': s ? s.failed : '', 'Patient warning': s ? s.warning : ''
      };
    });
    U.downloadText('analytix_validation_summary.csv', U.toCSV(cols, rows));
    UI.toast({ kind: 'success', title: 'Report exported', text: 'analytix_validation_summary.csv' });
  }

  /* ============================================================
     AUDIT LOG
     ============================================================ */
  Screens.audit = function (params) {
    var wrap = el('div', {});
    var focusId = params && params.analytic;
    var focus = focusId ? Store.get(focusId) : null;

    wrap.appendChild(Screens.pageHead({
      title: 'Audit Logs',
      sub: focus ? 'Filtered to ' + focus.name + ' — every configuration and validation event.'
        : 'Immutable trail of logins, uploads, rule changes, validations, corrections and approvals.',
      actions: [
        focus ? UI.btn('Clear filter', 'btn-secondary', function () { App.go('audit'); }, { icon: 'x' }) : null,
        UI.btn('Export log', 'btn-secondary', exportAudit, { icon: 'download' })
      ]
    }));

    var entries = Store.S.activityLog.slice();
    if (focus) entries = entries.filter(function (e) { return e.analyticId === focus.id; });
    entries.sort(function (x, y) { return new Date(y.ts) - new Date(x.ts); });

    var ACTION_GROUPS = [
      { key: 'all', label: 'All', test: null },
      { key: 'rules', label: 'Rule changes', test: function (e) { return /Rule/i.test(e.action); } },
      { key: 'validation', label: 'Validation', test: function (e) { return /validation|re-test/i.test(e.action); } },
      { key: 'approval', label: 'Approval', test: function (e) { return /approv/i.test(e.action); } },
      { key: 'patient', label: 'Patient testing', test: function (e) { return /patient/i.test(e.action); } },
      { key: 'data', label: 'Data & files', test: function (e) { return /file|corrected|classification/i.test(e.action); } },
      { key: 'auth', label: 'Access', test: function (e) { return /signed/i.test(e.action); } }
    ];

    var table = UI.dataTable({
      title: 'Audit trail', rows: entries, unit: 'events', pageSize: 25, compact: true,
      searchPlaceholder: 'Search action, analytic, reason…',
      searchText: function (e) { return [e.action, e.analyticName, e.detail, e.reason, e.user, e.prev, e.next].join(' '); },
      filters: ACTION_GROUPS.map(function (g) {
        return {
          key: g.key, label: g.label, test: g.test,
          count: g.test ? entries.filter(g.test).length : entries.length
        };
      }),
      columns: [
        { key: 'ts', label: 'Timestamp', value: function (e) { return e.ts; }, render: function (e) { return '<span class="mono" style="font-size:12px">' + esc(U.fmtDateTime(e.ts)) + '</span><div class="cell-sub">' + esc(U.relTime(e.ts)) + '</div>'; } },
        { key: 'user', label: 'User', value: function (e) { return e.user; }, render: function (e) { return esc(e.user); } },
        { key: 'analyticName', label: 'Analytic', value: function (e) { return e.analyticName; }, render: function (e) { return esc(e.analyticName || 'Platform') + (e.version ? '<div class="cell-sub">v' + esc(e.version) + '</div>' : ''); } },
        {
          key: 'action', label: 'Action', value: function (e) { return e.action; },
          render: function (e) {
            var tone = e.kind === 'ok' ? 'badge-success' : e.kind === 'bad' ? 'badge-danger' : e.kind === 'warn' ? 'badge-warn' : 'badge-info';
            return '<span class="badge ' + tone + '">' + esc(e.action) + '</span>';
          }
        },
        {
          key: 'detail', label: 'Detail', sortable: false, render: function (e) {
            var out = '<div style="font-size:12.5px">' + esc(e.detail || '') + '</div>';
            if (e.prev || e.next) {
              out += '<div class="diff">' + (e.prev ? '<span class="old">' + esc(e.prev) + '</span><span class="arr">→</span>' : '') +
                (e.next ? '<span class="new">' + esc(e.next) + '</span>' : '') + '</div>';
            }
            if (e.reason) out += '<div class="cell-sub" style="font-style:italic">Reason: ' + esc(e.reason) + '</div>';
            return out;
          }
        }
      ],
      exportName: 'analytix_audit_log',
      empty: { icon: 'audit', title: 'No audit events', desc: 'Actions you take in the platform appear here immediately.' }
    });
    wrap.appendChild(Screens.card({ flush: true, body: table }));
    return wrap;
  };

  function exportAudit() {
    var cols = ['Timestamp', 'User', 'Analytic', 'Version', 'Action', 'Detail', 'Previous', 'New', 'Reason'];
    var rows = Store.S.activityLog.map(function (e) {
      return {
        'Timestamp': U.fmtDateTime(e.ts), 'User': e.user, 'Analytic': e.analyticName || 'Platform',
        'Version': e.version ? 'v' + e.version : '', 'Action': e.action, 'Detail': e.detail,
        'Previous': e.prev || '', 'New': e.next || '', 'Reason': e.reason || ''
      };
    });
    U.downloadText('analytix_audit_log.csv', U.toCSV(cols, rows));
    UI.toast({ kind: 'success', title: 'Audit log exported', text: rows.length + ' events written.' });
  }

  /* ============================================================
     SETTINGS
     ============================================================ */
  Screens.settings = function (params) {
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Settings',
      sub: 'Platform behaviour, validation policy and prototype data controls.'
    }));

    var tabs = ['Profile', 'Validation policy', 'Display', 'Notifications', 'Prototype data'];
    var active = { i: 0 };
    if (params && params.hash === 'profile') active.i = 0;
    var tabBar = el('div', { class: 'tabs' });
    var panel = el('div', {});
    tabs.forEach(function (t, i) {
      var b = el('button', { class: 'tab' + (i === active.i ? ' on' : ''), type: 'button', text: t });
      b.addEventListener('click', function () {
        active.i = i;
        U.$$('.tab', tabBar).forEach(function (x, j) { x.classList.toggle('on', j === i); });
        paint();
      });
      tabBar.appendChild(b);
    });
    wrap.appendChild(tabBar);
    wrap.appendChild(panel);

    function paint() {
      panel.innerHTML = '';
      var s = Store.S.settings;
      if (active.i === 0) {
        var u = Store.S.user || {};
        var name = UI.fieldGroup({ label: 'Full name', value: u.name });
        var email = UI.fieldGroup({ label: 'Email', value: u.email, type: 'email' });
        var role = UI.fieldGroup({ label: 'Role', value: u.role, disabled: true, hint: 'Roles are managed by the laboratory administrator.' });
        panel.appendChild(Screens.card({
          title: 'Profile',
          body: el('div', { class: 'form-grid two' }, [name, email, role]),
          foot: [el('div', { class: 'grow' }, [UI.btn('Save profile', 'btn-primary', function () {
            Store.S.user.name = name.input.value.trim() || u.name;
            Store.S.user.email = email.input.value.trim() || u.email;
            Store.S.user.initials = U.initials(Store.S.user.name);
            Store.save();
            App.paintChrome();
            UI.toast({ kind: 'success', title: 'Profile updated' });
          }, { icon: 'check' })])]
        }));
        return;
      }
      if (active.i === 1) {
        var list = el('div', { class: 'list-rows' });
        list.appendChild(policyRow('Lock patient testing on any rule change',
          'Creates a new configuration version, invalidates the approval and re-locks patient testing whenever a rule, group logic or classification changes.',
          s.autoLockOnRuleChange, function (v) { s.autoLockOnRuleChange = v; Store.save(); }));
        list.appendChild(policyRow('Require a reason for changes to approved configurations',
          'Prompts for a justification that is stored in the audit trail.',
          s.requireReasonOnRuleChange, function (v) { s.requireReasonOnRuleChange = v; Store.save(); }));
        list.appendChild(policyRow('Treat warnings as failures',
          'When enabled, warning-severity rules also block approval. Rebuild validation runs after changing this.',
          s.warnAsFailure, function (v) { s.warnAsFailure = v; Store.save(); }));
        panel.appendChild(Screens.card({ title: 'Validation policy', flush: true, body: list }));

        var tokens = UI.fieldGroup({
          label: 'Missing-value tokens', value: s.missingTokens, mono: true,
          hint: 'Comma separated. Instrument exports write "no result" in many dialects — these values are treated as ' +
            'missing everywhere, so a numeric column is still detected as numeric.'
        });
        var tokenCard = Screens.card({
          title: 'Data interpretation',
          body: el('div', { class: 'form-grid' }, [tokens]),
          foot: [
            el('span', { class: 'muted', style: 'font-size:12.5px', text: 'Applies the next time fields are profiled or a validation runs.' }),
            el('div', { class: 'grow' }, [UI.btn('Save tokens', 'btn-primary', function () {
              s.missingTokens = tokens.input.value;
              U.setMissingTokens(s.missingTokens.split(','));
              Store.all().forEach(function (a) { if (Store.hasData(a)) Store.refreshFields(a); });
              Store.save();
              UI.toast({ kind: 'success', title: 'Missing-value tokens saved', text: U.MISSING_TOKENS.length + ' token(s) active.' });
            }, { icon: 'check' })])
          ]
        });
        tokenCard.classList.add('mt4');
        panel.appendChild(tokenCard);
        panel.appendChild(el('div', {
          class: 'alert alert-info mt4',
          html: U.icon('info', 17) + '<div><div class="alert-t">Patient testing is always gated on QC</div>' +
            '<p>The lock itself cannot be disabled — patient samples stay locked until every required control and calibration sample passes and the configuration is approved.</p></div>'
        }));
        return;
      }
      if (active.i === 2) {
        var pageSize = UI.fieldGroup({
          label: 'Default rows per page', type: 'select', value: String(s.pageSize),
          options: [10, 25, 50, 100].map(function (n) { return { value: String(n), label: String(n) }; }),
          onChange: function () { s.pageSize = parseInt(pageSize.input.value, 10); Store.save(); UI.toast({ kind: 'success', title: 'Display updated' }); }
        });
        var dateFmt = UI.fieldGroup({
          label: 'Date format', type: 'select', value: s.dateFormat,
          options: [{ value: 'DD MMM YYYY', label: 'DD MMM YYYY (17 Aug 2026)' }],
          hint: 'Additional formats are provided by the backend locale service.'
        });
        var sidebar = el('div', { class: 'fg' }, [
          el('label', { text: 'Sidebar' }),
          UI.switchToggle('Start with the sidebar collapsed', Store.S.ui.sidebarCollapsed, function (v) {
            Store.S.ui.sidebarCollapsed = v; Store.save(); App.applySidebar();
          })
        ]);
        panel.appendChild(Screens.card({ title: 'Display', body: el('div', { class: 'form-grid two' }, [pageSize, dateFmt, sidebar]) }));
        return;
      }
      if (active.i === 3) {
        var nl = el('div', { class: 'list-rows' });
        nl.appendChild(policyRow('Notify on QC validation failure', 'Raises an in-app notification whenever a control or calibration run fails.',
          s.notifyOnFailure, function (v) { s.notifyOnFailure = v; Store.save(); }));
        nl.appendChild(policyRow('Notify on approval', 'Raises a notification when a configuration is approved and patient testing unlocks.',
          s.notifyOnApproval, function (v) { s.notifyOnApproval = v; Store.save(); }));
        panel.appendChild(Screens.card({ title: 'Notifications', flush: true, body: nl }));
        panel.appendChild(Screens.card({
          title: 'Current notifications',
          actions: [UI.btn('Mark all read', 'btn-secondary btn-sm', function () { Store.markAllRead(); App.paintChrome(); paint(); })],
          flush: true,
          body: (function () {
            var box = el('div', { class: 'list-rows' });
            if (!Store.S.notifications.length) return UI.emptyState({ icon: 'info', title: 'No notifications', desc: 'Validation failures and approvals appear here.' });
            Store.S.notifications.forEach(function (n) {
              var row = el('div', { class: 'lr' });
              row.innerHTML = '<div class="lr-main"><div class="lr-t">' + esc(n.title) + (n.read ? '' : ' <span class="badge badge-info">new</span>') + '</div>' +
                '<div class="lr-d">' + esc(n.text) + '</div></div><span class="muted" style="font-size:11.5px">' + esc(U.relTime(n.ts)) + '</span>';
              box.appendChild(row);
            });
            return box;
          })()
        }));
        return;
      }
      /* prototype data */
      panel.appendChild(Screens.card({
        title: 'Prototype data',
        body: '<p style="font-size:13px;color:var(--ink-2);line-height:1.65">This prototype keeps state in your browser only. ' +
          'Demo analytics regenerate their sample files deterministically, so resetting restores the original catalogue and workflow stages. ' +
          'Uploaded files stay in memory for the session.</p>' +
          '<dl class="kv mt4"><dt>Analytics in store</dt><dd>' + Store.all().length + '</dd>' +
          '<dt>Audit events</dt><dd>' + Store.S.activityLog.length + '</dd>' +
          '<dt>Storage key</dt><dd class="mono">analytix.state.v1</dd></dl>',
        foot: [
          el('span', { class: 'muted', style: 'font-size:12.5px', text: 'Resetting discards every change you have made in this prototype.' }),
          el('div', { class: 'grow' }, [
            UI.btn('Export full state', 'btn-secondary', function () {
              U.downloadText('analytix_state.json', JSON.stringify(Store.S, function (k, v) { return k === 'records' ? undefined : v; }, 2), 'application/json');
              UI.toast({ kind: 'success', title: 'State exported' });
            }, { icon: 'download' }),
            UI.btn('Reset prototype data', 'btn-danger', function () {
              UI.confirm({
                title: 'Reset all prototype data?',
                message: 'Every analytic, rule, validation run and audit entry you created will be discarded and the demo catalogue restored.',
                confirmLabel: 'Reset everything', danger: true
              }).then(function (ok) {
                if (!ok) return;
                Store.reset();
                UI.toast({ kind: 'warn', title: 'Prototype reset', text: 'The demo catalogue has been restored.' });
                App.go('dashboard');
              });
            }, { icon: 'trash' })
          ])
        ]
      }));
    }
    paint();
    return wrap;
  };

  function policyRow(title, desc, value, onChange) {
    var row = el('div', { class: 'lr' });
    row.innerHTML = '<div class="lr-main"><div class="lr-t">' + esc(title) + '</div><div class="lr-d">' + esc(desc) + '</div></div>';
    var act = el('div', { class: 'lr-act' });
    act.appendChild(UI.switchToggle('', value, function (v) {
      onChange(v);
      UI.toast({ kind: 'success', title: 'Setting saved', text: title + ' — ' + (v ? 'enabled' : 'disabled') });
    }));
    row.appendChild(act);
    return row;
  }
}(typeof window !== 'undefined' ? window : this));
