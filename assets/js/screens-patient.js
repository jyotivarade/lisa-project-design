/* ============================================================
   screens-patient.js — patient testing (locked / unlocked / progress),
   patient PASS-FAIL results and the result detail drawer.
   Patient records come from the SAME uploaded file — never a second upload.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  /* ============================================================
     STEP 6 — PATIENT TESTING
     ============================================================ */
  Screens.patient = function (a) {
    var body = el('div', {});

    if (!Store.patientUnlocked(a)) {
      body.appendChild(Screens.lockPanel(a));
      var help = el('div', { class: 'grid g2 mt4' });
      help.appendChild(Screens.card({
        title: 'Why is this locked?',
        body: '<p style="font-size:13px;color:var(--ink-2);line-height:1.65">Patient results cannot be released until the ' +
          'control and calibration samples in the same file have been validated <strong>and</strong> the configuration has been ' +
          'approved. If a single required QC sample fails, the lock stays in place until the rule or the data is corrected and ' +
          're-tested.</p>' +
          '<div class="timeline mt4">' +
          stepLine(Store.hasData(a), Store.filesOf(a).length + ' data file(s) uploaded') +
          stepLine(a.analyteScope.applied, 'Analytics selected') +
          stepLine(a.classification.applied, 'Sample types classified') +
          stepLine(Store.fieldsConfirmed(a), 'Validation fields selected') +
          stepLine(Store.activeRules(a).length > 0, 'Validation rules configured') +
          stepLine(!!(a.validation.controls || a.validation.calibration), 'Control & calibration validation run') +
          stepLine(Store.validationPassed(a), 'All required QC samples passed') +
          stepLine(a.validation.approved, 'Validation approved') +
          '</div>'
      }));
      var g = Store.groups(a);
      help.appendChild(Screens.card({
        title: 'Waiting patient samples',
        body: '<div class="grid g2">' +
          UI.metric('Patient samples in file', U.fmtInt(g.patient.length), 'blue') +
          UI.metric('Status', 'Held', 'red') + '</div>' +
          '<p class="muted mt4" style="font-size:12.5px">These records are already present in <strong>' +
          (Store.filesOf(a).length === 1 ? esc(a.file.name) : Store.filesOf(a).length + ' uploaded files') +
          '</strong>. No second upload is required once validation is approved.</p>'
      }));
      body.appendChild(help);
      return Screens.workflowShell(a, 'patient', body);
    }

    /* --- unlocked --- */
    var g2 = Store.groups(a);
    var pt = a.patientTesting;
    var v = a.validation;

    var ready = el('div', { class: 'unlock-panel' });
    ready.innerHTML =
      '<div class="unlock-ico">' + U.icon('unlock', 24) + '</div>' +
      '<p class="eyebrow">Patient samples ready</p>' +
      '<p class="big-count" style="color:var(--green-700)">' + U.fmtInt(g2.patient.length) + '</p>' +
      '<p class="muted" style="font-size:12.5px">from ' +
      (Store.filesOf(a).length === 1 ? esc(a.file.name) : Store.filesOf(a).length + ' uploaded files') +
      ' — the same data used for QC validation' +
      (a.analyteScope.field ? ' · ' + esc(a.analyteScope.values.join(', ')) : '') + '</p>';
    var cfg = el('div', { class: 'grid g4 mt5', style: 'text-align:left' });
    cfg.innerHTML =
      UI.metric('Rules', 'v' + esc(a.version) + ' · ' + Store.activeRules(a).length + ' active') +
      UI.metric('Control', v.controls ? (v.controls.failed ? 'FAILED' : 'PASSED') : 'N/A', v.controls && !v.controls.failed ? 'green' : '') +
      UI.metric('Calibration', v.calibration ? (v.calibration.failed ? 'FAILED' : 'PASSED') : 'N/A', v.calibration && !v.calibration.failed ? 'green' : '') +
      UI.metric('Approved', U.fmtDate(v.approvedAt), 'green');
    ready.appendChild(cfg);
    var actions = el('div', { class: 'row mt5', style: 'justify-content:center' });
    actions.appendChild(UI.btn(pt.completedAt ? 'Re-run Patient Testing' : 'Start Patient Testing', 'btn-primary btn-lg',
      function () { startTesting(a); }, { icon: 'play' }));
    if (pt.completedAt) {
      actions.appendChild(UI.btn('View Results', 'btn-secondary btn-lg', function () { App.go('analytic/' + a.id + '/results'); }, { icon: 'report' }));
    }
    ready.appendChild(actions);
    body.appendChild(ready);

    if (pt.summary) {
      var last = Screens.card({
        title: 'Last patient run',
        badge: '<span class="badge badge-neutral">' + esc(U.fmtDateTime(pt.completedAt)) + '</span>',
        actions: [UI.btn('Open results', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id + '/results'); }, { icon: 'arrowRight', iconSize: 14 })],
        body: resultTiles(pt.summary)
      });
      last.classList.add('mt4');
      body.appendChild(last);
    }

    return Screens.workflowShell(a, 'patient', body);
  };

  function stepLine(done, label) {
    return '<div class="tl-item ' + (done ? 'ok' : '') + '" style="padding-bottom:14px">' +
      '<div class="tl-dot"><i></i></div><div class="tl-t" style="font-weight:' + (done ? 650 : 550) + ';color:' +
      (done ? 'var(--ink)' : 'var(--ink-3)') + '">' + esc(label) + '</div>' +
      '<div class="tl-d">' + (done ? 'Completed' : 'Pending') + '</div></div>';
  }

  function resultTiles(s) {
    var pct = function (n) { return s.total ? U.fmtPct(n / s.total * 100) : '—'; };
    return '<div class="result-tiles">' +
      '<div class="rt total"><div class="rtk">' + U.icon('flask', 13) + ' Samples tested</div><div class="rtv">' + U.fmtInt(s.total) + '</div></div>' +
      '<div class="rt pass"><div class="rtk">✓ PASS</div><div class="rtv">' + U.fmtInt(s.passed) + '</div><div class="rtp">' + pct(s.passed) + '</div></div>' +
      '<div class="rt fail"><div class="rtk">✕ FAIL</div><div class="rtv">' + U.fmtInt(s.failed) + '</div><div class="rtp">' + pct(s.failed) + '</div></div>' +
      '<div class="rt warn"><div class="rtk">⚠ WARNING</div><div class="rtv">' + U.fmtInt(s.warning) + '</div><div class="rtp">' + pct(s.warning) + '</div></div>' +
      '</div>';
  }
  Screens.resultTiles = resultTiles;

  /* ============================================================
     PATIENT TESTING PROGRESS (simulated batch run)
     ============================================================ */
  function startTesting(a) {
    var g = Store.groups(a);
    var total = g.patient.length;
    if (!total) {
      UI.toast({ kind: 'error', title: 'No patient samples', text: 'The uploaded file contains no records mapped to the patient sample type.' });
      return;
    }

    // compute the real outcome up-front, then reveal it progressively
    var summary = Store.runPatientTesting(a);
    a.patientTesting.startedAt = new Date().toISOString();

    var body = el('div', {});
    var counter = el('p', { class: 'big-count', text: '0' });
    var totalLbl = el('p', { class: 'muted', style: 'font-size:12.5px', text: 'of ' + U.fmtInt(total) + ' patient samples' });
    var multi = el('div', { class: 'progress-multi mt4' });
    multi.innerHTML = '<i class="p" style="width:0%"></i><i class="w" style="width:0%"></i><i class="f" style="width:0%"></i>';
    var legend = el('div', { class: 'grid g3 mt4' });
    body.appendChild(el('p', { class: 'eyebrow', text: 'Testing patient samples' }));
    body.appendChild(counter);
    body.appendChild(totalLbl);
    body.appendChild(multi);
    body.appendChild(legend);
    var note = el('p', { class: 'muted mt4', style: 'font-size:12.5px', text: 'Applying configuration v' + a.version + '…' });
    body.appendChild(note);

    var m = UI.modal({ title: 'Patient testing in progress', size: 'narrow', body: body, autofocus: false });

    UI.simulate({
      total: total, duration: 3200,
      onTick: function (done, t, frac) {
        var p = Math.round(summary.passed * frac);
        var f = Math.round(summary.failed * frac);
        var w = Math.round(summary.warning * frac);
        counter.textContent = U.fmtInt(done);
        U.$('.p', multi).style.width = (done ? p / total * 100 : 0) + '%';
        U.$('.w', multi).style.width = (done ? w / total * 100 : 0) + '%';
        U.$('.f', multi).style.width = (done ? f / total * 100 : 0) + '%';
        legend.innerHTML =
          UI.metric('Passed', U.fmtInt(p), 'green') +
          UI.metric('Failed', U.fmtInt(f), 'red') +
          UI.metric('Warning', U.fmtInt(w), 'amber');
        note.textContent = frac < .3 ? 'Applying configuration v' + a.version + '…'
          : frac < .7 ? 'Evaluating rules per sample…'
            : frac < 1 ? 'Collating pass / fail outcomes…' : 'Finalising run…';
      },
      onDone: function () {
        setTimeout(function () {
          UI.closeModal();
          UI.toast({
            kind: summary.failed ? 'warn' : 'success',
            title: 'Patient testing completed',
            text: U.fmtInt(summary.total) + ' samples · ' + U.fmtInt(summary.passed) + ' passed, ' +
              U.fmtInt(summary.failed) + ' failed, ' + U.fmtInt(summary.warning) + ' warning.'
          });
          App.go('analytic/' + a.id + '/results');
        }, 300);
      }
    });
  }
  Screens.startPatientTesting = startTesting;

  /* ============================================================
     STEP 7 — PATIENT RESULTS
     ============================================================ */
  Screens.results = function (a) {
    var pt = a.patientTesting;
    var body = el('div', {});

    if (!Store.patientUnlocked(a)) {
      body.appendChild(Screens.lockPanel(a));
      return Screens.workflowShell(a, 'results', body);
    }
    if (!pt.summary) {
      body.appendChild(Screens.card({
        body: UI.emptyState({
          icon: 'report', title: 'No patient run yet',
          desc: 'Start patient testing to produce pass / fail results for the patient records in the uploaded file.',
          actions: [UI.btn('Start Patient Testing', 'btn-primary', function () { App.go('analytic/' + a.id + '/patient'); }, { icon: 'play' })]
        })
      }));
      return Screens.workflowShell(a, 'results', body);
    }

    /* results may have been trimmed by persistence — recompute silently */
    if (pt.resultsPartial || !pt.results.length) Store.runPatientTesting(a);

    var recs = Store.recordsOf(a);
    var summary = pt.summary;

    var head = el('div', {});
    head.innerHTML = '<div class="row between mb3">' +
      '<div><p class="eyebrow">Patient results</p>' +
      '<p style="font-size:15px;font-weight:700">' + U.fmtInt(summary.total) + ' Samples Tested' +
      ' <span class="badge badge-info">v' + esc(pt.configVersion || a.version) + '</span></p></div>' +
      '<span class="muted" style="font-size:12.5px">Completed ' + esc(U.fmtDateTime(pt.completedAt)) + '</span></div>' +
      resultTiles(summary) +
      '<div class="progress-multi mt4">' +
      '<i class="p" style="width:' + (summary.passed / summary.total * 100) + '%"></i>' +
      '<i class="w" style="width:' + (summary.warning / summary.total * 100) + '%"></i>' +
      '<i class="f" style="width:' + (summary.failed / summary.total * 100) + '%"></i></div>';
    body.appendChild(Screens.card({ body: head }));

    if (pt.summaryByAnalyte && Object.keys(pt.summaryByAnalyte).length > 1) {
      var bd = el('div', { class: 'table-scroll' });
      bd.innerHTML = '<table class="tbl compact"><thead><tr><th>Analytics</th><th class="num">Tested</th>' +
        '<th class="num">Pass</th><th class="num">Fail</th><th class="num">Warning</th><th>Outcome</th></tr></thead><tbody>' +
        Object.keys(pt.summaryByAnalyte).map(function (k) {
          var s2 = pt.summaryByAnalyte[k];
          return '<tr><td class="cell-strong">' + esc(k) + '</td><td class="num">' + U.fmtInt(s2.total) + '</td>' +
            '<td class="num">' + U.fmtInt(s2.passed) + '</td><td class="num">' + U.fmtInt(s2.failed) + '</td>' +
            '<td class="num">' + U.fmtInt(s2.warning) + '</td><td>' +
            (s2.failed ? '<span class="badge badge-danger">' + s2.failed + ' failed</span>'
              : '<span class="badge badge-success">All passed</span>') + '</td></tr>';
        }).join('') + '</tbody></table>';
      var bdCard = Screens.card({ title: 'Outcome by analytics', flush: true, body: bd });
      bdCard.classList.add('mt4');
      body.appendChild(bdCard);
    }

    var failNote = el('div', { class: 'alert alert-info mt4' });
    failNote.innerHTML = U.icon('info', 17) + '<div><div class="alert-t">Only failed records are extracted</div>' +
      '<p>There is no passed-records file — the ' + U.fmtInt(summary.passed) + ' passed records stay part of the uploaded dataset. ' +
      'The extract contains the original fields plus analytics, sample type, source file, failed field, failed rule, reason and timestamp.</p></div>' +
      '<div class="grow"></div>';
    U.$('.grow', failNote).appendChild(UI.btn('Download Failed Patient Records', 'btn-primary btn-sm',
      function () { Screens.downloadFailed(a, 'patient'); }, { icon: 'download', iconSize: 14, disabled: !(summary.failed + summary.warning) }));
    body.appendChild(failNote);

    /* dynamic columns: identifier fields + numeric fields, chosen from the file */
    var idField = Screens.pickIdField(a);
    var patientIdField = pickPatientIdField(a, idField);
    var numFields = a.fields.filter(function (f) { return f.type === 'number'; });
    var mainNum = pickMainNumericField(a, numFields);

    var rows = pt.results.map(function (r) {
      var rec = recs[r.index] || {};
      var first = r.failures[0] || r.warnings[0] || null;
      return {
        index: r.index, record: rec, status: r.status,
        failures: r.failures, warnings: r.warnings,
        rule: first ? first.rule : '', field: first ? first.field : '', reason: first ? first.message : 'Within all configured limits'
      };
    });

    var columns = [];
    if (idField) columns.push({ key: 'sid', label: idField, value: function (r) { return r.record[idField]; }, render: function (r) { return '<span class="cell-strong">' + esc(r.record[idField]) + '</span>'; } });
    if (patientIdField) columns.push({ key: 'pid', label: patientIdField, value: function (r) { return r.record[patientIdField]; }, render: function (r) { return esc(r.record[patientIdField] || '—'); } });
    if (a.analyteScope.field) {
      columns.push({
        key: 'analyte', label: 'Analytics', value: function (r) { return r.record[a.analyteScope.field]; },
        render: function (r) { return '<span class="badge badge-violet">' + esc(r.record[a.analyteScope.field] || '—') + '</span>'; }
      });
    }
    if (mainNum) {
      columns.push({
        key: 'res', label: mainNum, align: 'right',
        value: function (r) { return U.toNumber(r.record[mainNum]); },
        render: function (r) {
          var v = r.record[mainNum];
          return U.isBlank(v) ? '<span class="badge badge-danger">missing</span>' : '<span class="mono">' + esc(v) + '</span>';
        }
      });
    }
    columns.push({ key: 'status', label: 'Status', value: function (r) { return r.status; }, render: function (r) { return UI.resultBadge(r.status); } });
    columns.push({
      key: 'failedField', label: 'Failed field',
      value: function (r) { return r.field; },
      render: function (r) { return r.field ? esc(r.field) : '<span class="muted">—</span>'; }
    });
    columns.push({ key: 'rule', label: 'Failed rule', render: function (r) { return r.rule ? esc(r.rule) : '<span class="muted">—</span>'; }, value: function (r) { return r.rule; } });
    columns.push({
      key: 'reason', label: 'Reason',
      render: function (r) {
        var extra = r.failures.length + r.warnings.length - 1;
        return '<span class="cell-sub">' + esc(r.reason) + '</span>' +
          (extra > 0 ? ' <span class="badge badge-neutral">+' + extra + ' more</span>' : '');
      },
      value: function (r) { return r.reason; }
    });
    if (Store.filesOf(a).length > 1) {
      columns.push({
        key: 'src', label: 'Source File', value: function (r) { return r.record.__src; },
        render: function (r) { return '<span class="cell-sub">' + esc(r.record.__src || '') + '</span>'; }
      });
    }

    var table = UI.dataTable({
      title: 'Patient sample results', rows: rows, pageSize: 25, compact: true, unit: 'samples',
      searchPlaceholder: 'Search sample or patient ID…',
      searchText: function (r) { return Object.keys(r.record).map(function (k) { return r.record[k]; }).join(' ') + ' ' + r.rule + ' ' + r.reason; },
      filters: [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'pass', label: 'Passed only', count: summary.passed, test: function (r) { return r.status === 'pass'; } },
        { key: 'fail', label: 'Failed only', count: summary.failed, test: function (r) { return r.status === 'fail'; } },
        { key: 'warn', label: 'Warning only', count: summary.warning, test: function (r) { return r.status === 'warning'; } }
      ],
      rowClass: function (r) { return r.status === 'fail' ? 'row-fail' : r.status === 'warning' ? 'row-warn' : ''; },
      columns: columns,
      onRow: function (r) { Screens.resultDrawer(a, r); },
      toolbar: [
        UI.btn('Download Failed Records', 'btn-primary btn-sm', function () { Screens.downloadFailed(a, 'patient'); },
          { icon: 'download', iconSize: 14, disabled: !(summary.failed + summary.warning) }),
        UI.btn('Preview failed extract', 'btn-secondary btn-sm', function () { Screens.failedRecordsDrawer(a, 'patient'); },
          { icon: 'eye', iconSize: 14, disabled: !(summary.failed + summary.warning) }),
        UI.btn('Re-run', 'btn-secondary btn-sm', function () { startTesting(a); }, { icon: 'refresh', iconSize: 14 })
      ]
    });
    var tableCard = Screens.card({ flush: true, body: table });
    tableCard.classList.add('mt4');
    body.appendChild(tableCard);

    var foot = el('div', { class: 'row mt4' });
    foot.appendChild(UI.btn('Validation history', 'btn-secondary', function () { App.go('analytic/' + a.id + '/history'); }, { icon: 'version' }));
    foot.appendChild(UI.btn('Audit trail', 'btn-secondary', function () { App.go('audit?analytic=' + a.id); }, { icon: 'audit' }));
    var rep = UI.btn('Open reports', 'btn-primary', function () { App.go('reports'); }, { icon: 'report' });
    rep.style.marginLeft = 'auto';
    foot.appendChild(rep);
    body.appendChild(foot);

    return Screens.workflowShell(a, 'results', body);
  };

  /** Second identifier field: text, near-unique, populated for patients. */
  function pickPatientIdField(a, exclude) {
    var g = Store.groups(a);
    if (!g.patient.length) return null;
    var best = null;
    a.fields.forEach(function (f) {
      if (f.name === exclude || f.type !== 'text') return;
      if (f.name === a.analyteScope.field || f.name === a.classification.field) return;
      var filled = 0, vals = {};
      g.patient.slice(0, 300).forEach(function (r) {
        if (!U.isBlank(r[f.name])) { filled++; vals[String(r[f.name])] = 1; }
      });
      var n = Math.min(300, g.patient.length);
      if (!n || filled / n < 0.9) return;
      var uniqueness = Object.keys(vals).length / n;
      if (uniqueness < 0.8) return;
      if (!best || uniqueness > best.u) best = { name: f.name, u: uniqueness };
    });
    return best ? best.name : null;
  }

  /** Primary measurement column: numeric, populated for patient rows, widest spread. */
  function pickMainNumericField(a, numFields) {
    var g = Store.groups(a);
    if (!numFields.length) return null;
    if (!g.patient.length) return numFields[0].name;
    var best = null;
    numFields.forEach(function (f) {
      var filled = 0;
      g.patient.slice(0, 400).forEach(function (r) { if (!U.isBlank(r[f.name])) filled++; });
      var ratio = filled / Math.min(400, g.patient.length);
      if (ratio < 0.5) return;
      var spread = (f.max !== null && f.min !== null) ? f.max - f.min : 0;
      var score = ratio * 10 + Math.min(1, spread / 100);
      if (!best || score > best.score) best = { name: f.name, score: score };
    });
    return best ? best.name : numFields[0].name;
  }

  /* ============================================================
     RESULT DETAIL DRAWER
     ============================================================ */
  Screens.resultDrawer = function (a, row) {
    var rec = row.record;
    var idField = Screens.pickIdField(a);
    var patientIdField = pickPatientIdField(a, idField);
    var numFields = a.fields.filter(function (f) { return f.type === 'number'; });
    var mainNum = pickMainNumericField(a, numFields);
    var issues = (row.failures || []).concat(row.warnings || []);
    var body = el('div', {});

    var top = el('div', {});
    top.innerHTML =
      '<dl class="kv">' +
      (patientIdField ? '<dt>' + esc(patientIdField) + '</dt><dd>' + esc(rec[patientIdField] || '—') + '</dd>' : '') +
      (idField ? '<dt>' + esc(idField) + '</dt><dd>' + esc(rec[idField] || '—') + '</dd>' : '') +
      '<dt>Source file</dt><dd>' + esc(rec.__src || (a.file ? a.file.name : '—')) + '</dd>' +
      (a.analyteScope.field ? '<dt>Analytics</dt><dd>' + esc(rec[a.analyteScope.field] || a.name) + '</dd>' : '') +
      '<dt>Row in file</dt><dd>#' + ((rec.__row === undefined ? row.index : rec.__row) + 1) + '</dd>' +
      '</dl>' +
      '<div class="grid g2 mt4">' +
      (mainNum ? UI.metric(mainNum, (U.isBlank(rec[mainNum]) ? 'missing' : esc(rec[mainNum])) +
        (findUnitValue(a, rec) ? ' <span style="font-size:13px;font-weight:600">' + esc(findUnitValue(a, rec)) + '</span>' : ''),
        row.status === 'pass' ? 'green' : row.status === 'fail' ? 'red' : 'amber') : '') +
      UI.metric('Status', row.status === 'pass' ? '✓ PASSED' : row.status === 'fail' ? '✕ FAILED' : '⚠ WARNING',
        row.status === 'pass' ? 'green' : row.status === 'fail' ? 'red' : 'amber') +
      '</div>';
    body.appendChild(top);

    if (issues.length) {
      var list = el('div', { class: 'mt5' });
      list.appendChild(el('p', { class: 'eyebrow mb3', text: (row.status === 'fail' ? 'Rules failed' : 'Rules flagged') + ' (' + issues.length + ')' }));
      issues.forEach(function (f) {
        var rule = a.rules.filter(function (r) { return r.id === f.ruleId; })[0];
        var item = el('div', { class: 'alert alert-' + (f.severity === 'warning' ? 'warn' : 'danger'), style: 'display:block;margin-bottom:10px' });
        item.innerHTML =
          '<div class="row between"><div class="alert-t">' + esc(f.rule) + '</div>' + UI.severityBadge(f.severity) + '</div>' +
          '<dl class="kv mt3" style="font-size:12.5px">' +
          '<dt>Field</dt><dd>' + esc(f.field) + '</dd>' +
          '<dt>Rule applied</dt><dd>' + esc(f.description || (rule ? Rules.describe(rule) : '—')) + '</dd>' +
          '<dt>Actual</dt><dd>' + esc(U.isBlank(rec[f.field]) ? 'missing' : String(rec[f.field])) + '</dd>' +
          (f.logic === 'ANY' ? '<dt>Group logic</dt><dd>ANY condition</dd>' : '') +
          '</dl>' +
          '<p style="font-size:12.5px;margin-top:8px">' + esc(f.message) + '</p>';
        list.appendChild(item);
      });
      body.appendChild(list);
    } else {
      body.appendChild(el('div', {
        class: 'alert alert-success mt5',
        html: U.icon('check', 17) + '<div><div class="alert-t">All applicable rules passed</div>' +
          '<p>This sample satisfied every enabled patient-scope rule in configuration v' + esc(a.patientTesting.configVersion || a.version) + '.</p></div>'
      }));
    }

    /* full record */
    var recTable = el('div', { class: 'mt5' });
    recTable.appendChild(el('p', { class: 'eyebrow mb3', text: 'Full record' }));
    var t = el('div', { class: 'table-scroll' });
    t.innerHTML = '<table class="tbl compact" style="min-width:0"><tbody>' +
      a.fields.map(function (f) {
        var edited = (a.dataEdits[row.index] || {})[f.name] !== undefined;
        return '<tr><td class="muted" style="width:45%">' + esc(f.name) + '</td>' +
          '<td class="mono">' + (U.isBlank(rec[f.name]) ? '<span class="muted">—</span>' : esc(String(rec[f.name]))) +
          (edited ? ' <span class="badge badge-warn">corrected</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    recTable.appendChild(t);
    body.appendChild(recTable);

    body.appendChild(el('div', {
      class: 'alert alert-neutral mt5',
      html: U.icon('version', 16) + '<div><div class="alert-t">Configuration v' + esc(a.patientTesting.configVersion || a.version) + '</div>' +
        '<p style="font-size:12.5px">Approved ' + esc(U.fmtDateTime(a.validation.approvedAt)) + ' by ' + esc(a.validation.approvedBy || '—') +
        ' · Controls ' + (a.validation.controls ? a.validation.controls.passed + '/' + a.validation.controls.total : 'n/a') +
        ' · Calibration ' + (a.validation.calibration ? a.validation.calibration.passed + '/' + a.validation.calibration.total : 'n/a') + '</p></div>'
    }));

    var d = UI.drawer({
      eyebrow: 'Patient Test Details',
      title: (patientIdField ? String(rec[patientIdField]) : idField ? String(rec[idField]) : 'Row #' + (row.index + 1)),
      wide: true, body: body,
      footer: [
        el('div', { class: 'left' }, [UI.btn('Close', 'btn-ghost', function () { d.close(); })]),
        UI.btn('Copy summary', 'btn-secondary', function () {
          var text = [
            a.name + ' — patient result',
            (patientIdField ? patientIdField + ': ' + rec[patientIdField] : ''),
            (idField ? idField + ': ' + rec[idField] : ''),
            (mainNum ? mainNum + ': ' + rec[mainNum] : ''),
            'Status: ' + row.status.toUpperCase(),
            'Configuration: v' + (a.patientTesting.configVersion || a.version)
          ].concat(issues.map(function (f) { return 'Failed: ' + f.rule + ' — ' + f.message; })).filter(Boolean).join('\n');
          if (navigator.clipboard) navigator.clipboard.writeText(text);
          UI.toast({ kind: 'success', title: 'Summary copied' });
        }, { icon: 'copy' })
      ]
    });
  };

  /** Find a unit-like value on the record: a text field with very few distinct values. */
  function findUnitValue(a, rec) {
    var f = a.fields.filter(function (x) {
      return x.type === 'text' && x.distinctCount > 0 && x.distinctCount <= 3 && !U.isBlank(rec[x.name]) &&
        String(rec[x.name]).length <= 12;
    })[0];
    return f ? rec[f.name] : '';
  }
}(typeof window !== 'undefined' ? window : this));
