/* ============================================================
   screens-validation.js — Control + Calibration validation (run
   together from ONE file), failure correction, re-test, approval
   and per-analytic validation history.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  /* ============================================================
     STEP 4 — CONTROL + CALIBRATION VALIDATION
     ============================================================ */
  Screens.validation = function (a) {
    if (!Store.hasData(a) || !a.classification.applied || !a.analyteScope.applied) {
      var missing = !Store.hasData(a) ? 'upload' : !a.analyteScope.applied ? 'analytics' : 'mapping';
      return Screens.workflowShell(a, missing, Screens.card({
        body: UI.emptyState({
          icon: 'shield', title: 'Data, analytics and sample types required',
          desc: 'Control and calibration samples are read from the same uploaded files, so the files must be uploaded, ' +
            'the analytics chosen and the sample types classified first.',
          actions: [UI.btn('Continue setup', 'btn-primary',
            function () { App.go('analytic/' + a.id + '/' + missing); }, { icon: 'arrowRight' })]
        })
      }));
    }
    if (!Store.activeRules(a).length) {
      return Screens.workflowShell(a, 'rules', Screens.card({
        body: UI.emptyState({
          icon: 'rules', title: 'No active validation rules',
          desc: a.rules.length
            ? 'Every configured rule is either disabled or sits on a field that is not selected for validation.'
            : 'Configure at least one rule before running control and calibration validation.',
          actions: [UI.btn('Configure rules', 'btn-primary', function () { App.go('analytic/' + a.id + '/rules'); }, { icon: 'rules' })]
        })
      }));
    }

    var g = Store.groups(a);
    var v = a.validation;
    var body = el('div', {});

    /* --- source split diagram --- */
    var files = Store.filesOf(a);
    var cnt = Store.counts(a);
    var flow = el('div', { class: 'card' });
    flow.innerHTML = '<div class="card-head"><h3 class="section-title">Uploaded files → three sample streams</h3>' +
      '<div class="grow"><span class="badge badge-neutral">' + U.icon('file', 11) + ' ' +
      (files.length === 1 ? esc(files[0].name) : files.length + ' files') + '</span>' +
      (a.analyteScope.field ? '<span class="badge badge-violet">' + esc(a.analyteScope.values.join(', ')) + '</span>' : '') +
      '<span class="badge badge-info">' + U.fmtInt(cnt.inScope) + ' records in scope</span></div></div>' +
      '<div class="card-body"><div class="grid g4">' +
      UI.metric('Control samples', U.fmtInt(g.control.length), 'blue') +
      UI.metric('Calibration samples', U.fmtInt(g.calibration.length), 'blue') +
      UI.metric('Patient samples', U.fmtInt(g.patient.length)) +
      UI.metric('Validated together', 'Control + Calibration', 'amber') +
      '</div>' +
      '<p class="muted mt3" style="font-size:12.5px">Control and calibration samples are validated together in a single run, ' +
      'drawn from every uploaded file' + (a.analyteScope.field ? ' for the selected analytics' : '') + '. ' +
      'Patient samples stay locked until that run passes and the configuration is approved.</p></div>';
    body.appendChild(flow);

    /* --- run / results --- */
    if (!v.controls && !v.calibration) {
      var runCard = Screens.card({
        title: 'Control & Calibration Validation',
        badge: '<span class="badge badge-info">Step 6 of ' + Store.STEPS.length + '</span>',
        body: UI.emptyState({
          icon: 'shield', title: 'Validation not run for v' + a.version,
          desc: 'Apply the ' + Store.activeRules(a).length +
            ' active rules to the ' + U.fmtInt(g.control.length + g.calibration.length) +
            ' QC samples in the uploaded data. Patient testing unlocks only after every required QC sample passes.',
          actions: [UI.btn('Run Validation', 'btn-primary', function () { runValidation(a); }, { icon: 'play' })]
        })
      });
      runCard.classList.add('mt4');
      body.appendChild(runCard);
      return Screens.workflowShell(a, 'validation', body);
    }

    var passed = Store.validationPassed(a);
    body.appendChild(resultHeader(a, passed));
    body.appendChild(qcResultsCard(a));

    if (!passed) {
      var lock = Screens.lockPanel(a);
      lock.classList.add('mt4');
      body.appendChild(lock);
    } else if (!v.approved) {
      var ok = el('div', { class: 'alert alert-success mt4' });
      ok.innerHTML = U.icon('check', 17) + '<div><div class="alert-t">✓ ALL VALIDATION PASSED</div>' +
        '<p>Controls and calibration are within the configured acceptance limits for v' + esc(a.version) +
        '. Approve the configuration to unlock patient testing.</p></div><div class="grow"></div>';
      U.$('.grow', ok).appendChild(UI.btn('Go to Approval', 'btn-success btn-sm', function () { App.go('analytic/' + a.id + '/approval'); }, { icon: 'arrowRight', iconSize: 14 }));
      body.appendChild(ok);
    }

    return Screens.workflowShell(a, 'validation', body);
  };

  function resultHeader(a, passed) {
    var v = a.validation;
    var wrap = el('div', { class: 'grid g2 mt4' });
    wrap.appendChild(runResultCard('Control Validation', v.controls, passed));
    wrap.appendChild(runResultCard('Calibration Validation', v.calibration, passed));
    return wrap;
  }

  function runResultCard(title, res, overall) {
    var card = el('div', { class: 'card' });
    if (!res || !res.total) {
      card.innerHTML = '<div class="card-body"><p class="eyebrow">' + esc(title) + '</p>' +
        '<p class="big-count muted">—</p><p class="muted" style="font-size:12.5px">No samples of this type in the uploaded file.</p></div>';
      return card;
    }
    var ok = res.failed === 0;
    card.innerHTML = '<div class="card-body">' +
      '<div class="row between"><p class="eyebrow">' + esc(title) + '</p>' +
      (ok ? '<span class="badge badge-success badge-lg">✓ Passed</span>' : '<span class="badge badge-danger badge-lg">✕ Failed</span>') + '</div>' +
      '<p class="big-count" style="color:' + (ok ? 'var(--green-700)' : 'var(--red-700)') + '">' +
      U.fmtInt(res.passed) + ' / ' + U.fmtInt(res.total) + '</p>' +
      '<p class="muted" style="font-size:12.5px">' + (ok ? 'All samples within acceptance limits' :
        res.failed + ' sample(s) outside acceptance limits' + (res.warning ? ' · ' + res.warning + ' warning(s)' : '')) + '</p>' +
      '<div class="progress mt3"><div class="bar ' + (ok ? 'green' : 'red') + '" style="width:' +
      (res.total ? (res.passed / res.total * 100) : 0) + '%"></div></div>' +
      '</div>';
    return card;
  }

  /** Combined control + calibration results table with per-row correction. */
  function qcResultsCard(a) {
    var recs = Store.recordsOf(a);
    var v = a.validation;
    var rows = [];
    [['control', v.controls], ['calibration', v.calibration]].forEach(function (pair) {
      var kind = pair[0], res = pair[1];
      if (!res) return;
      (res.rows || []).forEach(function (r) {
        var rec = recs[r.index] || {};
        var first = r.failures[0] || r.warnings[0] || null;
        rows.push({
          index: r.index, kind: kind, record: rec, status: r.status,
          failures: r.failures, warnings: r.warnings,
          failedRule: first ? first.rule : '', failedField: first ? first.field : '', message: first ? first.message : ''
        });
      });
    });

    /* choose display columns dynamically: id-ish, level-ish, and numeric fields */
    var idField = Screens.pickIdField(a);
    var levelField = pickLevelField(a);
    var numFields = a.fields.filter(function (f) { return f.type === 'number'; }).slice(0, 2);
    var failCount = rows.filter(function (r) { return r.status === 'fail'; }).length;
    var warnCount = rows.filter(function (r) { return r.status === 'warning'; }).length;

    var columns = [];
    if (idField) columns.push({ key: 'id', label: idField, render: function (r) { return '<span class="cell-strong">' + esc(r.record[idField]) + '</span>'; }, value: function (r) { return r.record[idField]; } });
    if (a.analyteScope.field) {
      columns.push({
        key: 'analyte', label: 'Analytics',
        value: function (r) { return r.record[a.analyteScope.field]; },
        render: function (r) { return '<span class="badge badge-violet">' + esc(r.record[a.analyteScope.field] || '—') + '</span>'; }
      });
    }
    columns.push({ key: 'kind', label: 'Type', render: function (r) { return UI.scopeBadges([r.kind]); }, value: function (r) { return r.kind; } });
    if (levelField) columns.push({ key: 'level', label: levelField, value: function (r) { return r.record[levelField]; }, render: function (r) { return esc(r.record[levelField] || '—'); } });
    numFields.forEach(function (f) {
      columns.push({
        key: 'n_' + f.name, label: f.name, align: 'right',
        value: function (r) { return r.record[f.name]; },
        render: function (r) { return U.isBlank(r.record[f.name]) ? '<span class="muted">—</span>' : '<span class="mono">' + esc(r.record[f.name]) + '</span>'; }
      });
    });
    if (Store.filesOf(a).length > 1) {
      columns.push({
        key: 'src', label: 'Source File', value: function (r) { return r.record.__src; },
        render: function (r) { return '<span class="cell-sub">' + esc(r.record.__src || '') + '</span>'; }
      });
    }
    columns.push({ key: 'status', label: 'Status', render: function (r) { return UI.resultBadge(r.status); }, value: function (r) { return r.status; } });
    columns.push({
      key: 'failedRule', label: 'Failed rule',
      render: function (r) {
        if (r.status === 'pass') return '<span class="muted">—</span>';
        var extra = r.failures.length + r.warnings.length - 1;
        return '<span class="cell-strong">' + esc(r.failedRule) + '</span>' +
          (extra > 0 ? ' <span class="badge badge-neutral">+' + extra + '</span>' : '');
      }
    });
    columns.push({
      key: 'actions', label: '', sortable: false,
      render: function (r) {
        if (r.status === 'pass') return '';
        var b = el('div', { class: 'tbl-actions' });
        b.appendChild(UI.btn('Correct', 'btn-secondary btn-xs', function () { Screens.correctionDrawer(a, r); }, { icon: 'edit', iconSize: 12 }));
        return b;
      }
    });

    var table = UI.dataTable({
      title: 'QC sample results',
      rows: rows, pageSize: 15, compact: true, unit: 'QC samples',
      searchPlaceholder: 'Search QC samples…',
      searchText: function (r) { return Object.keys(r.record).map(function (k) { return r.record[k]; }).join(' ') + ' ' + r.failedRule; },
      filters: [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'fail', label: 'Failed only', count: failCount, test: function (r) { return r.status === 'fail'; } },
        { key: 'warn', label: 'Warnings', count: warnCount, test: function (r) { return r.status === 'warning'; } },
        { key: 'pass', label: 'Passed only', count: rows.length - failCount - warnCount, test: function (r) { return r.status === 'pass'; } },
        { key: 'ctl', label: 'Control', count: rows.filter(function (r) { return r.kind === 'control'; }).length, test: function (r) { return r.kind === 'control'; } },
        { key: 'cal', label: 'Calibration', count: rows.filter(function (r) { return r.kind === 'calibration'; }).length, test: function (r) { return r.kind === 'calibration'; } }
      ],
      rowClass: function (r) { return r.status === 'fail' ? 'row-fail' : r.status === 'warning' ? 'row-warn' : ''; },
      columns: columns,
      onRow: function (r) { if (r.status !== 'pass') Screens.correctionDrawer(a, r); },
      toolbar: [
        UI.btn('Download Failed Records', 'btn-secondary btn-sm', function () { Screens.downloadFailed(a, 'qc'); },
          { icon: 'download', iconSize: 14, disabled: !(failCount + warnCount) }),
        UI.btn('Re-test', 'btn-secondary btn-sm', function () { runValidation(a, true); }, { icon: 'refresh', iconSize: 14 })
      ]
    });

    var card = Screens.card({ flush: true, body: table });
    card.classList.add('mt4');
    return card;
  }

  /**
   * Detect the QC "level" column without knowing its name: a level partitions the
   * QC material, so the target/measured value stays (near) constant within each
   * of its values. Whichever text column minimises that within-group spread wins.
   */
  function pickLevelField(a) {
    var g = Store.groups(a);
    var qc = g.control.concat(g.calibration);
    if (!qc.length) return null;
    var recs = Store.recordsOf(a);
    var numField = Seed.detectReferenceField(a.fields, recs, a.classification) ||
      Seed.detectResultField(a.fields, recs, a.classification, null);
    var best = null;

    a.fields.forEach(function (f) {
      if (f.type !== 'text') return;
      if (f.name === a.classification.field) return;   // already shown as the sample type column
      var buckets = {}, filled = 0;
      qc.forEach(function (r) {
        var v = r[f.name];
        if (U.isBlank(v)) return;
        filled++;
        (buckets[String(v)] = buckets[String(v)] || []).push(numField ? U.toNumber(r[numField]) : 0);
      });
      if (filled / qc.length < 0.9) return;
      var keys = Object.keys(buckets);
      if (keys.length < 2 || keys.length > 12) return;

      var spread = 0, counted = 0;
      keys.forEach(function (k) {
        var vals = buckets[k].filter(function (x) { return !isNaN(x); });
        if (!vals.length) return;
        var mean = U.sum(vals) / vals.length;
        var range = Math.max.apply(null, vals) - Math.min.apply(null, vals);
        spread += mean ? range / Math.abs(mean) : 0;
        counted++;
      });
      var score = counted ? 1 / (1 + spread / counted) : 0;
      score += Math.min(1, (qc.length / keys.length) / 4) * 0.2;   // a level recurs across samples
      score += 0.35 * overlapRatio(f.name, g.control, g.calibration); // levels are shared by both streams
      if (!best || score > best.score) best = { name: f.name, score: score };
    });
    return best ? best.name : null;
  }

  /** How much two sample streams share the same values for a field (0–1). */
  function overlapRatio(field, listA, listB) {
    if (!listA.length || !listB.length) return 0;
    function setOf(list) {
      var s = {};
      list.forEach(function (r) { if (!U.isBlank(r[field])) s[String(r[field])] = 1; });
      return Object.keys(s);
    }
    var a = setOf(listA), b = setOf(listB);
    if (!a.length || !b.length) return 0;
    var shared = a.filter(function (x) { return b.indexOf(x) > -1; }).length;
    return shared / Math.min(a.length, b.length);
  }
  Screens.pickLevelField = pickLevelField;

  /* ============================================================
     RUN / RE-TEST
     ============================================================ */
  function runValidation(a, isRetest) {
    var g = Store.groups(a);
    var runner = UI.progressRunner({ title: isRetest ? 'Re-testing control & calibration' : 'Validating…' });
    var m = UI.modal({ title: isRetest ? 'Re-test' : 'Control & Calibration validation', size: 'narrow', body: runner.body, autofocus: false });
    var total = g.control.length + g.calibration.length;

    UI.simulate({
      total: total || 1, duration: 1700,
      onTick: function (done, t, frac) {
        var c = Math.min(g.control.length, done);
        var k = U.clamp(done - g.control.length, 0, g.calibration.length);
        runner.set(frac,
          '<div class="run-line"><span class="run-ico' + (c >= g.control.length ? ' ok' : '') + '">' + (c >= g.control.length ? '✓' : '·') + '</span>' +
          '<span class="run-t">Control Samples</span><span class="run-v">' + U.fmtInt(c) + ' / ' + U.fmtInt(g.control.length) + '</span></div>' +
          '<div class="run-line"><span class="run-ico' + (k >= g.calibration.length ? ' ok' : '') + '">' + (k >= g.calibration.length ? '✓' : '·') + '</span>' +
          '<span class="run-t">Calibration Samples</span><span class="run-v">' + U.fmtInt(k) + ' / ' + U.fmtInt(g.calibration.length) + '</span></div>' +
          '<p class="muted mt3" style="font-size:12.5px">' + (frac < .9 ? 'Applying rules…' : 'Summarising acceptance limits…') + '</p>');
      },
      onDone: function () {
        var res = Store.runQCValidation(a);
        setTimeout(function () {
          UI.closeModal();
          if (res.passed) {
            UI.toast({
              kind: 'success', title: '✓ All validation passed',
              text: 'Controls ' + res.controls.passed + '/' + res.controls.total + ' · Calibration ' +
                res.calibration.passed + '/' + res.calibration.total + '. Approval is now available.'
            });
            App.render();
            showPassModal(a, res);
          } else {
            var failed = res.controls.failed + res.calibration.failed;
            UI.toast({
              kind: 'error', title: '✕ Validation failed',
              text: failed + ' record(s) still require correction. Patient testing remains locked.'
            });
            App.render();
            showFailModal(a, res);
          }
        }, 260);
      }
    });
  }
  Screens.runValidation = runValidation;

  function showFailModal(a, res) {
    var failed = res.controls.failed + res.calibration.failed;
    var body = el('div', {});
    body.innerHTML =
      '<div class="lock-panel" style="text-align:left;padding:16px">' +
      '<p class="lock-t" style="font-size:15px">✕ Validation Failed</p>' +
      '<p class="lock-d" style="margin-left:0">' + failed + ' record(s) still require correction before patient testing can unlock.</p>' +
      '</div>' +
      '<div class="grid g2 mt4">' +
      UI.metric('Control', res.controls.passed + ' / ' + res.controls.total, res.controls.failed ? 'red' : 'green') +
      UI.metric('Calibration', res.calibration.passed + ' / ' + res.calibration.total, res.calibration.failed ? 'red' : 'green') +
      '</div>';
    var m = UI.modal({
      title: 'Validation result', size: 'narrow', body: body, autofocus: false,
      footer: [
        UI.btn('Close', 'btn-secondary', function () { m.close(); }),
        UI.btn('View Failed', 'btn-primary', function () { m.close(); openFirstFailure(a); }, { icon: 'eye' })
      ]
    });
  }

  function showPassModal(a, res) {
    var body = el('div', {});
    body.innerHTML =
      '<div class="unlock-panel" style="padding:20px">' +
      '<div class="unlock-ico">' + U.icon('check', 24) + '</div>' +
      '<p style="font-size:15px;font-weight:750;color:var(--green-700)">✓ Control Validation Passed<br>✓ Calibration Validation Passed</p>' +
      '<p class="muted mt2" style="font-size:12.5px">Configuration v' + esc(a.version) + ' is ready for approval sign-off.</p>' +
      '</div>';
    var m = UI.modal({
      title: 'ALL VALIDATION PASSED', size: 'narrow', body: body, autofocus: false,
      footer: [
        UI.btn('Stay here', 'btn-secondary', function () { m.close(); }),
        UI.btn('Approve Validation', 'btn-success', function () { m.close(); App.go('analytic/' + a.id + '/approval'); }, { icon: 'check' })
      ]
    });
  }

  function openFirstFailure(a) {
    var recs = Store.recordsOf(a);
    var v = a.validation;
    var first = null;
    [['control', v.controls], ['calibration', v.calibration]].forEach(function (pair) {
      if (first || !pair[1]) return;
      (pair[1].rows || []).forEach(function (r) {
        if (first || r.status !== 'fail') return;
        first = { index: r.index, kind: pair[0], record: recs[r.index] || {}, status: r.status, failures: r.failures, warnings: r.warnings };
      });
    });
    if (first) Screens.correctionDrawer(a, first);
    else UI.toast({ kind: 'info', title: 'No failing QC samples' });
  }

  /* ============================================================
     FAILED SAMPLE CORRECTION DRAWER
     ============================================================ */
  Screens.correctionDrawer = function (a, row) {
    var rec = row.record;
    var idField = Screens.pickIdField(a);
    var levelField = pickLevelField(a);
    var issues = (row.failures || []).concat(row.warnings || []);
    var body = el('div', {});

    /* sample summary */
    var sum = el('div', {});
    sum.innerHTML =
      '<div class="grid g2">' +
      UI.metric('Sample', esc(idField ? rec[idField] : '#' + (row.index + 1))) +
      UI.metric('Sample type', U.titleCase(row.kind || 'sample')) +
      '</div>' +
      '<div class="grid g2 mt3">' +
      (a.analyteScope.field ? UI.metric('Analytics', esc(rec[a.analyteScope.field] || a.name)) : UI.metric('Analytics', esc(a.name))) +
      (levelField ? UI.metric(levelField, esc(rec[levelField] || '—')) : UI.metric('Row', '#' + ((rec.__row || 0) + 1))) +
      '</div>' +
      '<div class="grid g2 mt3">' +
      UI.metric('Source file', esc(rec.__src || (a.file ? a.file.name : '—'))) +
      UI.metric('Row in file', '#' + ((rec.__row === undefined ? row.index : rec.__row) + 1)) +
      '</div>';
    body.appendChild(sum);

    /* failing rules */
    var list = el('div', { class: 'mt5' });
    list.appendChild(el('p', { class: 'eyebrow mb3', text: 'Failed rules (' + issues.length + ')' }));
    issues.forEach(function (f) {
      var rule = a.rules.filter(function (r) { return r.id === f.ruleId; })[0];
      var item = el('div', { class: 'alert alert-' + (f.severity === 'warning' ? 'warn' : 'danger'), style: 'margin-bottom:10px;display:block' });
      item.innerHTML =
        '<div class="row between" style="gap:8px"><div><div class="alert-t">' + esc(f.rule) + '</div>' +
        '<p style="font-size:12.5px">Field <strong>[' + esc(f.field) + ']</strong>' +
        (rule ? ' · current definition: <span class="mono">' + esc(Rules.describe(rule)) + '</span>' : '') + '</p></div>' +
        UI.severityBadge(f.severity) + '</div>' +
        '<p style="font-size:12.5px;margin-top:6px">' + esc(f.message) + '</p>';
      if (rule) {
        var act = el('div', { class: 'row mt3' });
        act.appendChild(UI.btn('Edit Rule', 'btn-secondary btn-sm', function () {
          UI.closeDrawer();
          Screens.ruleBuilder(a, rule);
        }, { icon: 'rules', iconSize: 13 }));
        act.appendChild(el('span', {
          class: 'muted', style: 'font-size:11.5px',
          text: 'Changing a rule creates configuration v' + Store.bumpVersion(a.version) + '.'
        }));
        item.appendChild(act);
      }
      list.appendChild(item);
    });
    body.appendChild(list);

    /* correct data */
    var editable = {};
    issues.forEach(function (f) { editable[f.field] = true; });
    var dataBox = el('div', { class: 'mt5' });
    dataBox.appendChild(el('p', { class: 'eyebrow mb3', text: 'Correct sample data' }));
    var grid = el('div', { class: 'form-grid two' });
    var inputs = {};
    Object.keys(editable).forEach(function (fieldName) {
      var f = a.fields.filter(function (x) { return x.name === fieldName; })[0];
      var g = UI.fieldGroup({
        label: fieldName + '  (' + (f ? f.type : 'text') + ')',
        value: rec[fieldName], mono: true,
        hint: 'Recorded value in the file: ' + (function () {
          var src = Store.sourceRecord(a, rec) || {};
          return U.isBlank(src[fieldName]) ? '—' : src[fieldName];
        })()
      });
      inputs[fieldName] = g;
      grid.appendChild(g);
    });
    dataBox.appendChild(grid);
    dataBox.appendChild(el('p', {
      class: 'hint mt2',
      text: 'Corrections are recorded in the audit trail with the previous value. They never overwrite the source file.'
    }));
    body.appendChild(dataBox);

    var reason = UI.fieldGroup({
      label: 'Reason for correction', type: 'textarea', rows: 2,
      placeholder: 'e.g. Instrument recalibrated and QC material re-run'
    });
    body.appendChild(el('div', { class: 'mt4' }, reason));

    var d = UI.drawer({
      eyebrow: 'Failed Sample', wide: true,
      title: (idField ? String(rec[idField]) : 'Row #' + (row.index + 1)) + ' · ' + U.titleCase(row.kind || ''),
      body: body,
      footer: [
        el('div', { class: 'left' }, [UI.btn('Close', 'btn-ghost', function () { d.close(); })]),
        UI.btn('Save & Re-test', 'btn-primary', function () {
          var changed = 0;
          Object.keys(inputs).forEach(function (fieldName) {
            var val = inputs[fieldName].input.value.trim();
            var current = String(rec[fieldName] === undefined ? '' : rec[fieldName]);
            if (val !== current) {
              Store.correctData(a, rec, fieldName, val, reason.input.value.trim());
              changed++;
            }
          });
          if (!changed) {
            UI.toast({ kind: 'info', title: 'No data changes', text: 'Edit a value or change the rule, then re-test.' });
            return;
          }
          d.close();
          UI.toast({ kind: 'success', title: changed + ' value(s) corrected', text: 'Re-running control & calibration validation…' });
          runValidation(a, true);
        }, { icon: 'refresh' })
      ]
    });
  };

  /* ============================================================
     STEP 5 — APPROVAL
     ============================================================ */
  Screens.approval = function (a) {
    var v = a.validation;
    var g = Store.groups(a);
    var passed = Store.validationPassed(a);
    var body = el('div', {});

    if (!passed) {
      body.appendChild(Screens.card({
        title: 'Validation Approval',
        badge: '<span class="badge badge-warn">Blocked</span>',
        body: UI.emptyState({
          icon: 'lock', title: 'Approval unavailable',
          desc: 'Every required control and calibration sample must pass before the configuration can be approved.',
          actions: [UI.btn('Go to validation', 'btn-primary', function () { App.go('analytic/' + a.id + '/validation'); }, { icon: 'shield' })]
        })
      }));
      var lock = Screens.lockPanel(a);
      lock.classList.add('mt4');
      body.appendChild(lock);
      return Screens.workflowShell(a, 'approval', body);
    }

    var checklist = el('div', {});
    var actRules = Store.activeRules(a);
    checklist.innerHTML =
      checkLine(true, 'Data files', Store.filesOf(a).length + ' file(s) · ' + U.fmtInt(a.file.recordCount) + ' records · ' +
        U.fmtInt(Store.counts(a).inScope) + ' in scope') +
      checkLine(true, 'Analytics scope', a.analyteScope.field
        ? '[' + a.analyteScope.field + '] → ' + a.analyteScope.values.join(', ')
        : 'All uploaded records validated together') +
      checkLine(true, 'Fields selected for validation', Store.selectedFields(a).length + ' of ' + a.fields.length + ' detected fields') +
      checkLine(true, 'Rules valid', actRules.length + ' active rules across ' +
        Object.keys(actRules.reduce(function (m, r) { m[r.field] = 1; return m; }, {})).length + ' fields') +
      checkLine(true, 'Sample classification applied', 'Field [' + a.classification.field + '] — ' +
        U.fmtInt(g.control.length) + ' control · ' + U.fmtInt(g.calibration.length) + ' calibration · ' + U.fmtInt(g.patient.length) + ' patient') +
      checkLine(!v.controls || v.controls.failed === 0, 'Controls passed',
        v.controls ? U.fmtInt(v.controls.passed) + ' / ' + U.fmtInt(v.controls.total) + ' within acceptance limits' : 'No control samples in file') +
      checkLine(!v.calibration || v.calibration.failed === 0, 'Calibration passed',
        v.calibration ? U.fmtInt(v.calibration.passed) + ' / ' + U.fmtInt(v.calibration.total) + ' within acceptance limits' : 'No calibration samples in file') +
      checkLine(true, 'Configuration version', 'v' + a.version + ' · last QC run ' + U.fmtDateTime(v.ranAt));

    var warnTotal = (v.controls ? v.controls.warning : 0) + (v.calibration ? v.calibration.warning : 0);
    if (warnTotal) {
      checklist.innerHTML += '<div class="alert alert-warn mt4">' + U.icon('warning', 16) +
        '<div><div class="alert-t">' + warnTotal + ' QC warning(s) recorded</div>' +
        '<p>Warnings do not block approval, but they are stored against this version for review.</p></div></div>';
    }

    if (v.approved) {
      var done = el('div', { class: 'unlock-panel' });
      done.innerHTML = '<div class="unlock-ico">' + U.icon('unlock', 24) + '</div>' +
        '<p style="font-size:16px;font-weight:750;color:var(--green-700)">✓ Validation Approved</p>' +
        '<p class="muted mt2" style="font-size:13px">Patient testing is now unlocked for configuration v' + esc(a.version) + '.<br>' +
        'Approved by ' + esc(v.approvedBy) + ' on ' + esc(U.fmtDateTime(v.approvedAt)) + '.</p>';
      var row = el('div', { class: 'row mt4', style: 'justify-content:center' });
      row.appendChild(UI.btn('Go to Patient Testing', 'btn-primary', function () { App.go('analytic/' + a.id + '/patient'); }, { icon: 'flask' }));
      done.appendChild(row);
      body.appendChild(done);
    }

    var approveBtn = UI.btn('Approve Validation', 'btn-success', function () { approveNow(a, approveBtn); }, { icon: 'check' });
    var card = Screens.card({
      title: 'Validation Summary',
      badge: '<span class="badge badge-info">Step 7 of ' + Store.STEPS.length + '</span>',
      body: checklist,
      foot: v.approved ? [
        el('span', { class: 'muted', style: 'font-size:12.5px', text: 'This configuration is approved. Editing any rule creates a new version and re-locks patient testing.' })
      ] : [
        el('span', { class: 'muted', style: 'font-size:12.5px', text: 'Approval is recorded against configuration v' + a.version + ' in the audit trail.' }),
        el('div', { class: 'grow' }, [approveBtn])
      ]
    });
    card.classList.add('mt4');
    body.appendChild(card);
    return Screens.workflowShell(a, 'approval', body);
  };

  function checkLine(ok, title, detail) {
    return '<div class="run-line"><span class="run-ico ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓' : '✕') + '</span>' +
      '<div><div class="run-t">' + esc(title) + '</div>' +
      '<div class="muted" style="font-size:12px">' + esc(detail) + '</div></div></div>';
  }

  function approveNow(a, button) {
    var note = UI.fieldGroup({
      label: 'Approval note (optional)', type: 'textarea', rows: 2,
      placeholder: 'e.g. QC within 2 SD, calibration verified against reference material'
    });
    var body = el('div', {});
    body.innerHTML = '<p style="font-size:13px;color:var(--ink-2);line-height:1.6">You are approving configuration <strong>v' +
      esc(a.version) + '</strong> of <strong>' + esc(a.name) + '</strong>. This unlocks patient testing for the ' +
      U.fmtInt(Store.groups(a).patient.length) + ' patient records already present in ' +
      (Store.filesOf(a).length === 1 ? '<strong>' + esc(a.file.name) + '</strong>' : '<strong>' + Store.filesOf(a).length + ' uploaded files</strong>') +
      '.</p>';
    body.appendChild(el('div', { class: 'mt4' }, note));
    var m = UI.modal({
      title: 'Approve validation', size: 'narrow', body: body,
      footer: [
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        UI.btn('Approve & Unlock', 'btn-success', function () {
          Store.approve(a, note.input.value.trim());
          m.close();
          UI.toast({ kind: 'success', title: '✓ Validation approved', text: 'Patient testing is now unlocked.' });
          App.go('analytic/' + a.id + '/patient');
        }, { icon: 'unlock' })
      ]
    });
  }

  /* ============================================================
     PER-ANALYTIC VALIDATION HISTORY
     ============================================================ */
  Screens.analyticHistory = function (a) {
    var body = el('div', {});
    var v = a.validation;
    var current = {
      version: a.version, ruleCount: a.rules.length,
      controls: v.controls ? (v.controls.failed ? 'Failed' : 'Passed') : '—',
      calibration: v.calibration ? (v.calibration.failed ? 'Failed' : 'Passed') : '—',
      patientTests: a.patientTesting.summary ? a.patientTesting.summary.total : null,
      status: v.approved ? 'Active' : (v.controls || v.calibration ? (Store.validationPassed(a) ? 'Awaiting approval' : 'Failed') : 'Draft'),
      approvedAt: v.approvedAt, current: true
    };
    var list = [current].concat(a.versions.filter(function (x) { return x.version !== a.version; }));

    var table = el('div', { class: 'table-scroll' });
    table.innerHTML = '<table class="tbl"><thead><tr><th>Version</th><th>Rules</th><th>Controls</th><th>Calibration</th>' +
      '<th class="num">Patient Tests</th><th>Approved</th><th>Status</th></tr></thead><tbody>' +
      list.map(function (x) {
        return '<tr><td class="cell-strong">v' + esc(x.version) + (x.current ? ' <span class="badge badge-info">current</span>' : '') + '</td>' +
          '<td>v' + esc(x.rulesVersion || x.version) + ' <span class="cell-sub">(' + (x.ruleCount || '—') + ' rules)</span></td>' +
          '<td>' + Screens.statusText(x.controls) + '</td><td>' + Screens.statusText(x.calibration) + '</td>' +
          '<td class="num">' + (x.patientTests ? U.fmtInt(x.patientTests) : '—') + '</td>' +
          '<td>' + (x.approvedAt ? esc(U.fmtDate(x.approvedAt)) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + Screens.versionStatus(x.status) + '</td></tr>';
      }).join('') + '</tbody></table>';

    body.appendChild(Screens.card({
      title: 'Validation History',
      badge: '<span class="badge badge-neutral">' + list.length + ' versions</span>',
      flush: true, body: table
    }));

    var tl = el('div', { class: 'timeline' });
    (a.audit || []).slice(0, 25).forEach(function (e) { tl.appendChild(Screens.activityItem(e)); });
    body.appendChild(Screens.card({ title: 'Change history', body: (a.audit || []).length ? tl : el('p', { class: 'muted', text: 'No changes recorded.' }) }));

    return Screens.workflowShell(a, null, body);
  };
}(typeof window !== 'undefined' ? window : this));
