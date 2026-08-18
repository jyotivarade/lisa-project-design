/* ============================================================
   screens-core.js — dashboard, analytics list, create analytic,
   analytic overview + the shared workflow shell.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  /* ---------------------------------------------------------- shared bits */
  Screens.pageHead = function (o) {
    var head = el('div', { class: 'page-head' });
    var left = el('div', {});
    left.appendChild(el('h1', { class: 'page-title', text: o.title }));
    if (o.sub) left.appendChild(el('p', { class: 'page-sub', text: o.sub }));
    head.appendChild(left);
    if (o.actions && o.actions.length) {
      var acts = el('div', { class: 'page-head-actions' });
      o.actions.forEach(function (n) { if (n) acts.appendChild(n); });
      head.appendChild(acts);
    }
    return head;
  };

  Screens.card = function (o) {
    var c = el('div', { class: 'card' });
    if (o.title || o.actions) {
      var h = el('div', { class: 'card-head' });
      if (o.title) h.appendChild(el('h3', { class: 'section-title', text: o.title }));
      if (o.badge) h.appendChild(el('span', { html: o.badge }));
      if (o.actions) {
        var g = el('div', { class: 'grow' });
        o.actions.forEach(function (n) { if (n) g.appendChild(n); });
        h.appendChild(g);
      }
      c.appendChild(h);
    }
    var b = el('div', { class: 'card-body' + (o.flush ? ' flush' : '') + (o.tight ? ' tight' : '') });
    if (typeof o.body === 'string') b.innerHTML = o.body;
    else if (o.body instanceof Node) b.appendChild(o.body);
    else if (Array.isArray(o.body)) o.body.forEach(function (n) { if (n) b.appendChild(typeof n === 'string' ? el('div', { html: n }) : n); });
    c.appendChild(b);
    if (o.foot) {
      var f = el('div', { class: 'card-foot' });
      if (typeof o.foot === 'string') f.innerHTML = o.foot;
      else if (Array.isArray(o.foot)) o.foot.forEach(function (n) { if (n) f.appendChild(n); });
      else f.appendChild(o.foot);
      c.appendChild(f);
    }
    c.bodyEl = b;
    return c;
  };

  /** Analytic header + stepper wrapper used by every workflow step. */
  Screens.workflowShell = function (a, activeStep, contentNodes) {
    var wrap = el('div', {});
    var status = Store.statusOf(a);
    var head = el('div', { class: 'page-head' });
    var left = el('div', {});
    var title = el('div', { class: 'row', style: 'gap:10px' });
    title.innerHTML = '<span class="a-ico" style="background:' + esc(a.color) + '">' + esc((a.code || a.name).slice(0, 4).toUpperCase()) + '</span>';
    var titleText = el('div', {});
    titleText.appendChild(el('h1', { class: 'page-title', text: a.name }));
    var meta = el('div', { class: 'row', style: 'gap:8px;margin-top:3px' });
    meta.innerHTML = UI.statusBadge(status) + UI.versionChip(a.version) +
      '<span class="muted" style="font-size:12.5px">' + esc(a.code || a.id) + ' · ' + Store.stateOf(a).replace(/_/g, ' ') + '</span>';
    titleText.appendChild(meta);
    title.appendChild(titleText);
    left.appendChild(title);
    head.appendChild(left);

    var acts = el('div', { class: 'page-head-actions' });
    acts.appendChild(UI.btn('Analyte Configuration', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id + '/config'); }, { icon: 'settings', iconSize: 14 }));
    acts.appendChild(UI.btn('Criteria Module', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id + '/criteria'); }, { icon: 'rules', iconSize: 14 }));
    acts.appendChild(UI.btn('Validation History', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id + '/history'); }, { icon: 'version', iconSize: 14 }));
    acts.appendChild(UI.btn('Audit Trail', 'btn-secondary btn-sm', function () { App.go('audit?analytic=' + a.id); }, { icon: 'audit', iconSize: 14 }));
    head.appendChild(acts);
    wrap.appendChild(head);

    wrap.appendChild(UI.stepper(a, function (step) { App.go('analytic/' + a.id + '/' + step); }));

    (Array.isArray(contentNodes) ? contentNodes : [contentNodes]).forEach(function (n) {
      if (n) wrap.appendChild(n);
    });
    return wrap;
  };

  /**
   * FAILED RECORDS ONLY — a passed-records file is deliberately never produced;
   * passed records remain part of the original uploaded dataset.
   */
  Screens.downloadFailed = function (a, scope) {
    var data = Store.failedRecords(a, scope);
    if (!data.rows.length) {
      UI.toast({
        kind: 'info', title: 'Nothing to download',
        text: scope === 'patient' ? 'No patient record failed validation.' : 'No control or calibration record failed validation.'
      });
      return;
    }
    var name = Store.failedFileName(a, scope);
    U.downloadText(name, U.toCSV(data.columns, data.rows));
    Store.audit(a, {
      action: 'Failed records exported',
      detail: name + ' — ' + U.fmtInt(data.recordCount) + ' failed record(s), ' +
        U.fmtInt(data.failureCount) + ' rule failure row(s)',
      kind: 'info'
    });
    UI.toast({
      kind: 'success', title: 'Failed records exported',
      text: name + ' · ' + U.fmtInt(data.recordCount) + ' record(s) — passed records stay in the original dataset.'
    });
  };

  /** Preview of the failed-records extract before downloading. */
  Screens.failedRecordsDrawer = function (a, scope) {
    var data = Store.failedRecords(a, scope);
    var body = el('div', {});
    body.innerHTML = UI.alertBox('info', 'Only failed records are extracted',
      'Passed records are never exported — they remain part of the uploaded dataset. This extract carries the original ' +
      'fields plus analytics, sample type, source file, failed field, failed rule, reason and the validation timestamp.');

    var tiles = el('div', { class: 'grid g2 mt4' });
    tiles.innerHTML =
      UI.metric('Failed records', U.fmtInt(data.recordCount), 'red') +
      UI.metric('Rule failures', U.fmtInt(data.failureCount), 'amber');
    body.appendChild(tiles);

    var metaCols = Store.FAIL_META;
    var previewCols = ['Sample Type', 'Failed Field', 'Failed Rule', 'Failure Reason', 'Source File'];
    var table = UI.dataTable({
      rows: data.rows, pageSize: 8, compact: true, unit: 'failure rows', showCount: false,
      searchPlaceholder: 'Search failed records…',
      searchText: function (r) { return metaCols.map(function (c) { return r[c]; }).join(' '); },
      columns: previewCols.map(function (c) {
        return {
          key: c, label: c,
          render: function (r) {
            var v = r[c];
            if (U.isBlank(v)) return '<span class="muted">—</span>';
            if (c === 'Sample Type') return UI.scopeBadges([String(v).toLowerCase()]);
            return '<span class="cell-sub">' + esc(String(v)) + '</span>';
          },
          value: function (r) { return r[c]; }
        };
      })
    });
    body.appendChild(el('div', { class: 'mt4' }, table));
    body.appendChild(el('p', {
      class: 'hint mt2',
      text: 'The downloaded file also carries every selected field of the original record, the analytics value and the validation timestamp.'
    }));

    var d = UI.drawer({
      eyebrow: 'Failed records', wide: true,
      title: (scope === 'patient' ? 'Patient' : 'Control & calibration') + ' failures · v' + a.version,
      body: body,
      footer: [
        el('div', { class: 'left' }, [UI.btn('Close', 'btn-ghost', function () { d.close(); })]),
        UI.btn('Download Failed Records', 'btn-primary', function () { Screens.downloadFailed(a, scope); }, { icon: 'download' })
      ]
    });
  };

  /**
   * Pick the column that best identifies a record, without knowing its name:
   * a mostly-unique, mostly-populated text field that is not the analytics or
   * sample-type discriminator.
   */
  Screens.pickIdField = function (a) {
    var recs = Store.scopedRecords(a);
    if (!recs.length || !a.fields.length) return null;
    var skip = [a.analyteScope && a.analyteScope.field, a.classification && a.classification.field]
      .filter(Boolean);
    var sample = recs.slice(0, 400);
    var best = null;
    a.fields.forEach(function (f, idx) {
      if (skip.indexOf(f.name) > -1) return;
      var filled = 0, vals = {};
      sample.forEach(function (r) {
        if (U.isBlank(r[f.name])) return;
        filled++; vals[String(r[f.name])] = 1;
      });
      if (!filled) return;
      var uniqueness = Object.keys(vals).length / filled;
      var coverage = filled / sample.length;
      if (coverage < 0.9) return;
      var score = uniqueness * 2 + coverage - idx * 0.01;   // earlier columns break ties
      if (!best || score > best.score) best = { name: f.name, score: score };
    });
    if (best) return best.name;
    var fallback = a.fields.filter(function (f) { return skip.indexOf(f.name) === -1; })[0];
    return fallback ? fallback.name : a.fields[0].name;
  };

  /** Locked-panel used wherever patient testing is blocked. */
  Screens.lockPanel = function (a) {
    var g = Store.groups(a);
    var v = a.validation;
    var ctl = v.controls, cal = v.calibration;
    var failedQC = ((ctl ? ctl.failed : 0) + (cal ? cal.failed : 0));
    var node = el('div', { class: 'lock-panel' });
    node.innerHTML =
      '<div class="lock-ico">' + U.icon('lock', 26) + '</div>' +
      '<p class="lock-t">🔒 PATIENT TESTING LOCKED</p>' +
      '<p class="lock-d">Control and Calibration validation must be completed and approved on configuration <strong>v' +
      esc(a.version) + '</strong> before any patient sample can be released.</p>' +
      '<div class="lock-stats">' +
      lockStat('Control', ctl, g.control.length) +
      lockStat('Calibration', cal, g.calibration.length) +
      '<div class="lock-stat' + (failedQC ? ' bad' : '') + '"><div class="lk">Failed records</div><div class="lv">' +
        (ctl || cal ? U.fmtInt(failedQC) : '—') + '</div></div>' +
      '<div class="lock-stat"><div class="lk">Approval</div><div class="lv">' +
        (v.approved ? 'Approved' : 'Pending') + '</div></div>' +
      '</div>';
    var btnRow = el('div', { class: 'row', style: 'justify-content:center;position:relative' });
    btnRow.appendChild(UI.btn(ctl || cal ? 'Correct Validation' : 'Run Control & Calibration Validation', 'btn-primary',
      function () { App.go('analytic/' + a.id + '/validation'); }, { icon: 'shield' }));
    if (failedQC) {
      btnRow.appendChild(UI.btn('View Failed Records', 'btn-secondary', function () {
        Screens.failedRecordsDrawer(a, 'qc');
      }, { icon: 'eye' }));
    }
    if (!Store.activeRules(a).length) {
      btnRow.appendChild(UI.btn('Configure Rules', 'btn-secondary', function () { App.go('analytic/' + a.id + '/rules'); }, { icon: 'rules' }));
    }
    node.appendChild(btnRow);
    return node;
  };
  function lockStat(label, res, total) {
    if (!res) {
      return '<div class="lock-stat"><div class="lk">' + label + '</div><div class="lv">' +
        (total ? 'Not run' : 'None in file') + '</div></div>';
    }
    var ok = res.failed === 0;
    return '<div class="lock-stat ' + (ok ? 'ok' : 'bad') + '"><div class="lk">' + label + '</div><div class="lv">' +
      U.fmtInt(res.passed) + ' / ' + U.fmtInt(res.total) + ' Passed</div></div>';
  }

  /* ============================================================
     DASHBOARD
     ============================================================ */
  Screens.dashboard = function () {
    var o = Store.overview();
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Dashboard',
      sub: 'Validation posture across every analytic — controls, calibration, approvals and patient testing.',
      actions: [
        UI.btn('Create Analytics', 'btn-primary', function () { Screens.createAnalyticModal(); }, { icon: 'plus' })
      ]
    }));

    var tiles = el('div', { class: 'grid g4' });
    tiles.innerHTML =
      UI.stat({ label: 'Analytics configured', value: U.fmtInt(o.total), icon: 'beaker', tone: 'blue', note: o.active + ' active · ' + o.draft + ' draft' }) +
      UI.stat({ label: 'Patient samples tested', value: U.fmtInt(o.patientsTested), icon: 'flask', tone: 'teal', note: o.passRate === null ? 'No runs yet' : U.fmtPct(o.passRate) + ' pass rate', noteTone: 'up' }) +
      UI.stat({ label: 'QC samples validated', value: U.fmtInt(o.qcSamples), icon: 'shield', tone: 'violet', note: o.qcFailed ? o.qcFailed + ' failing QC sample(s)' : 'All QC within limits', noteTone: o.qcFailed ? 'down' : 'up' }) +
      UI.stat({ label: 'Blocked from patient testing', value: U.fmtInt(o.locked + o.validation), icon: 'lock', tone: o.locked ? 'red' : 'amber', note: o.awaitingApproval + ' awaiting approval' });
    wrap.appendChild(tiles);

    /* attention panel */
    var attention = Store.all().filter(function (a) {
      var s = Store.statusOf(a);
      return s === 'locked' || s === 'validation';
    });
    if (attention.length) {
      var list = el('div', { class: 'list-rows' });
      attention.forEach(function (a) {
        var st = Store.stateOf(a);
        var row = el('div', { class: 'lr' });
        row.innerHTML =
          '<span class="a-ico" style="background:' + esc(a.color) + ';width:32px;height:32px;border-radius:9px;font-size:10px">' +
          esc((a.code || a.name).slice(0, 4).toUpperCase()) + '</span>' +
          '<div class="lr-main"><div class="lr-t">' + esc(a.name) + ' ' + UI.versionChip(a.version) + '</div>' +
          '<div class="lr-d">' + esc(reasonFor(a, st)) + '</div></div>';
        var act = el('div', { class: 'lr-act' });
        act.appendChild(UI.btn(st === Store.STATES.VALIDATION_PASSED ? 'Approve' : 'Resolve', 'btn-secondary btn-sm',
          function () { App.go('analytic/' + a.id + '/' + (st === Store.STATES.VALIDATION_PASSED ? 'approval' : 'validation')); },
          { icon: 'arrowRight', iconSize: 14 }));
        row.appendChild(act);
        list.appendChild(row);
      });
      wrap.appendChild(Screens.card({
        title: 'Requires attention',
        badge: '<span class="badge badge-warn">' + attention.length + '</span>',
        flush: true, body: list
      }));
    }

    /* two column: validation posture + activity */
    var cols = el('div', { class: 'grid g2 mt4' });

    var postureBody = el('div', { class: 'list-rows' });
    Store.all().slice(0, 7).forEach(function (a) {
      var g = Store.groups(a);
      var v = a.validation;
      var row = el('div', { class: 'lr' });
      row.innerHTML =
        '<div class="lr-main"><div class="lr-t">' + esc(a.name) + '</div>' +
        '<div class="lr-d">' + (a.file
          ? U.fmtInt(a.file.recordCount) + ' records · ' + Store.filesOf(a).length + ' file(s) · ' + a.rules.length + ' rules'
          : 'No data file uploaded') + '</div></div>' +
        '<div class="row" style="gap:6px;flex:0 0 auto">' +
        miniCheck('C', v.controls, g.control.length) +
        miniCheck('K', v.calibration, g.calibration.length) +
        '<span class="badge ' + (Store.patientUnlocked(a) ? 'badge-success' : 'badge-neutral') + '">' +
          (Store.patientUnlocked(a) ? U.icon('unlock', 11) + ' Patient' : U.icon('lock', 11) + ' Patient') + '</span>' +
        '</div>';
      row.addEventListener('click', function () { App.go('analytic/' + a.id); });
      row.style.cursor = 'pointer';
      postureBody.appendChild(row);
    });
    cols.appendChild(Screens.card({
      title: 'Validation posture',
      actions: [UI.btn('All analytics', 'btn-ghost btn-sm', function () { App.go('analytics'); }, { icon: 'arrowRight', iconSize: 14 })],
      flush: true, body: postureBody
    }));

    var tl = el('div', { class: 'timeline' });
    Store.S.activityLog.slice(0, 8).forEach(function (e) {
      tl.appendChild(activityItem(e));
    });
    cols.appendChild(Screens.card({
      title: 'Recent activity',
      actions: [UI.btn('Audit log', 'btn-ghost btn-sm', function () { App.go('audit'); }, { icon: 'arrowRight', iconSize: 14 })],
      body: tl
    }));
    wrap.appendChild(cols);
    return wrap;
  };

  function reasonFor(a, st) {
    if (st === Store.STATES.VALIDATION_FAILED) {
      var f = (a.validation.controls ? a.validation.controls.failed : 0) + (a.validation.calibration ? a.validation.calibration.failed : 0);
      return f + ' QC sample(s) outside acceptance limits — patient testing locked.';
    }
    if (st === Store.STATES.VALIDATION_PASSED) return 'Controls and calibration passed — awaiting approval sign-off.';
    if (st === Store.STATES.RULES_CONFIGURED) return 'Configuration v' + a.version + ' needs a control & calibration validation run.';
    if (st === Store.STATES.FIELDS_SELECTED) return 'Fields selected — validation rules not configured yet.';
    if (st === Store.STATES.CLASSIFIED) return 'Sample types classified — field selection pending.';
    if (st === Store.STATES.ANALYTICS_SELECTED) return 'Analytics selected — sample classification pending.';
    if (st === Store.STATES.FILES_UPLOADED) return 'Files uploaded — analytics selection pending.';
    return 'Draft analytic — no data files uploaded.';
  }

  function miniCheck(letter, res, total) {
    if (!total) return '<span class="badge badge-neutral" title="No such samples in file">' + letter + ' —</span>';
    if (!res) return '<span class="badge badge-neutral" title="Not validated">' + letter + ' ?</span>';
    var ok = res.failed === 0;
    return '<span class="badge ' + (ok ? 'badge-success' : 'badge-danger') + '" title="' + res.passed + '/' + res.total + '">' +
      letter + ' ' + res.passed + '/' + res.total + '</span>';
  }

  function activityItem(e) {
    var item = el('div', { class: 'tl-item ' + (e.kind || 'info') });
    var html = '<div class="tl-dot"><i></i></div>' +
      '<div class="tl-time">' + esc(U.fmtDateTime(e.ts)) + ' · ' + esc(e.user) + '</div>' +
      '<div class="tl-t">' + esc(e.action) + '</div>' +
      '<div class="tl-d">' + esc(e.analyticName || '') + (e.detail ? ' — ' + esc(e.detail) : '') + '</div>';
    if (e.prev || e.next) {
      html += '<div class="diff">' + (e.prev ? '<span class="old">' + esc(e.prev) + '</span><span class="arr">→</span>' : '') +
        (e.next ? '<span class="new">' + esc(e.next) + '</span>' : '') + '</div>';
    }
    if (e.reason) html += '<div class="tl-d" style="font-style:italic">Reason: ' + esc(e.reason) + '</div>';
    item.innerHTML = html;
    return item;
  }
  Screens.activityItem = activityItem;

  /* ============================================================
     ANALYTICS LIST
     ============================================================ */
  var listState = { q: '', filter: 'all' };

  Screens.analytics = function (params) {
    if (params && params.filter) listState.filter = params.filter;
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Analytics',
      sub: 'Manage analytics validation, controls, calibration and patient testing.',
      actions: [UI.btn('Create Analytics', 'btn-primary', function () { Screens.createAnalyticModal(); }, { icon: 'plus' })]
    }));

    var bar = el('div', { class: 'filter-bar' });
    var si = el('div', { class: 'search-inp' });
    si.innerHTML = U.icon('search', 15);
    var input = el('input', {
      class: 'inp', type: 'search', placeholder: 'Search Analytics…', value: listState.q,
      oninput: U.debounce(function () { listState.q = input.value.trim().toLowerCase(); paint(); }, 160)
    });
    si.appendChild(input);
    bar.appendChild(si);

    var counts = {
      all: Store.all().length,
      active: Store.all().filter(function (a) { return Store.statusOf(a) === 'active'; }).length,
      draft: Store.all().filter(function (a) { return Store.statusOf(a) === 'draft'; }).length,
      validation: Store.all().filter(function (a) { return Store.statusOf(a) === 'validation'; }).length,
      locked: Store.all().filter(function (a) { return Store.statusOf(a) === 'locked'; }).length
    };
    var pills = el('div', { class: 'pills' });
    [['all', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['validation', 'Validation Required'], ['locked', 'Locked']]
      .forEach(function (p) {
        var b = el('button', { class: 'pill' + (listState.filter === p[0] ? ' on' : ''), type: 'button', 'data-f': p[0] });
        b.innerHTML = p[1] + ' <span class="c">' + counts[p[0]] + '</span>';
        b.addEventListener('click', function () {
          listState.filter = p[0];
          U.$$('.pill', pills).forEach(function (x) { x.classList.toggle('on', x.dataset.f === p[0]); });
          paint();
        });
        pills.appendChild(b);
      });
    bar.appendChild(pills);
    wrap.appendChild(bar);

    var grid = el('div', { class: 'grid g-auto' });
    wrap.appendChild(grid);

    function paint() {
      grid.innerHTML = '';
      var rows = Store.all().filter(function (a) {
        if (listState.filter !== 'all' && Store.statusOf(a) !== listState.filter) return false;
        if (!listState.q) return true;
        return (a.name + ' ' + a.code + ' ' + a.description).toLowerCase().indexOf(listState.q) > -1;
      });
      if (!rows.length) {
        var e = UI.emptyState({
          icon: 'beaker', title: 'No analytics match',
          desc: 'Try a different search term or filter, or create a new analytic to start a validation workflow.',
          actions: [UI.btn('Create Analytics', 'btn-primary', function () { Screens.createAnalyticModal(); }, { icon: 'plus' })]
        });
        var c = Screens.card({ body: e });
        c.style.gridColumn = '1 / -1';
        grid.appendChild(c);
        return;
      }
      rows.forEach(function (a) { grid.appendChild(analyticCard(a)); });
    }
    paint();
    return wrap;
  };

  function analyticCard(a) {
    var status = Store.statusOf(a);
    var meta = Store.STATUS_META[status];
    var g = Store.groups(a);
    var v = a.validation;
    var card = el('div', { class: 'a-card ' + meta.cls });

    var ctlState = !g.control.length ? ['pend', 'Not in file'] : !v.controls ? ['pend', 'Pending'] :
      v.controls.failed === 0 ? ['ok', 'Passed'] : ['bad', v.controls.passed + ' / ' + v.controls.total + ' Passed'];
    var calState = !g.calibration.length ? ['pend', 'Not in file'] : !v.calibration ? ['pend', 'Pending'] :
      v.calibration.failed === 0 ? ['ok', 'Passed'] : ['bad', v.calibration.passed + ' / ' + v.calibration.total + ' Passed'];
    var ptState = Store.patientUnlocked(a)
      ? (a.patientTesting.completedAt ? ['ok', 'Completed'] : ['ok', 'Ready'])
      : ['bad', 'Locked'];

    card.innerHTML =
      '<div class="a-card-head">' +
        '<span class="a-ico" style="background:' + esc(a.color) + '">' + esc((a.code || a.name).slice(0, 4).toUpperCase()) + '</span>' +
        '<div style="min-width:0"><div class="a-name">' + esc(a.name) + '</div><div class="a-code">' + esc(a.code || a.id) + '</div></div>' +
      '</div>' +
      '<div class="a-card-body">' +
        '<div class="a-meta">' + UI.statusBadge(status) + UI.versionChip(a.version) +
          (a.file ? '<span class="badge badge-neutral">' + U.icon('file', 11) + ' ' + U.fmtInt(a.file.recordCount) + '</span>' : '') +
        '</div>' +
        '<p class="a-desc">' + esc(a.description || 'No description provided.') + '</p>' +
        '<div class="a-checks">' +
          checkRow('Controls', ctlState) +
          checkRow('Calibration', calState) +
          checkRow('Patient Testing', ptState) +
        '</div>' +
      '</div>' +
      '<div class="a-card-foot"><span class="ts">' +
        (v.approvedAt ? 'Approved ' + esc(U.fmtDate(v.approvedAt)) : v.ranAt ? 'Last run ' + esc(U.fmtDate(v.ranAt)) : 'Updated ' + esc(U.fmtDate(a.updatedAt))) +
      '</span></div>';

    var foot = U.$('.a-card-foot', card);
    foot.appendChild(UI.btn('Open Analytics', 'btn-primary btn-sm', function () { App.go('analytic/' + a.id); }, { icon: 'arrowRight', iconSize: 14 }));
    return card;
  }
  function checkRow(label, s) {
    var glyph = s[0] === 'ok' ? '✓' : s[0] === 'bad' ? '✕' : '·';
    return '<div class="a-check"><span class="ck ' + s[0] + '">' + glyph + '</span>' + label +
      '<span class="cv ' + s[0] + '">' + esc(s[1]) + '</span></div>';
  }

  /* ============================================================
     CREATE ANALYTIC
     ============================================================ */
  Screens.createAnalyticModal = function () {
    var name = UI.fieldGroup({ label: 'Analytics Name', required: true, placeholder: 'e.g. HbA1c Analysis' });
    var code = UI.fieldGroup({ label: 'Analytics Code', required: true, placeholder: 'e.g. HBA1C', hint: 'Short uppercase identifier used in reports and audit entries.' });
    var desc = UI.fieldGroup({ label: 'Description', type: 'textarea', placeholder: 'Method, QC levels, calibration approach…' });
    var status = UI.fieldGroup({
      label: 'Status', type: 'select', value: 'draft',
      options: [{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }]
    });
    var refRatio = UI.fieldGroup({
      label: 'Reference Ratio Adjustment', type: 'number', value: 10, suffix: '%', step: '0.1',
      hint: 'How far the calibrators’ ion-ratio range is widened before patient ratios are judged against it. Editable later in Analyte Configuration.'
    });
    name.input.addEventListener('input', function () {
      if (!code.input.dataset.touched) {
        code.input.value = name.input.value.replace(/[^A-Za-z0-9]+/g, '').slice(0, 10).toUpperCase();
      }
    });
    code.input.addEventListener('input', function () { code.input.dataset.touched = '1'; });

    var body = el('div', {}, [
      el('div', { class: 'form-grid two' }, [name, code]),
      el('div', { class: 'form-grid mt4' }, [desc]),
      el('div', { class: 'form-grid two mt4' }, [status, refRatio]),
      el('div', {
        class: 'alert alert-info mt4',
        html: U.icon('info', 16) + '<div><div class="alert-t">One file drives the whole workflow</div>' +
          '<p>After creation you upload a single sample-data file containing control, calibration and patient records. ' +
          'Fields and rules are then derived from that file.</p></div>'
      })
    ]);

    var m = UI.modal({
      title: 'Create Analytics', body: body,
      footer: [
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        UI.btn('Create Analytics', 'btn-primary', submit, { icon: 'plus' })
      ]
    });

    function submit() {
      var ok = true;
      name.setError(''); code.setError('');
      if (!name.input.value.trim()) { name.setError('Analytics name is required'); ok = false; }
      if (!code.input.value.trim()) { code.setError('Analytics code is required'); ok = false; }
      else if (Store.all().some(function (a) { return a.code && a.code.toUpperCase() === code.input.value.trim().toUpperCase(); })) {
        code.setError('This code is already in use'); ok = false;
      }
      var adj = parseFloat(refRatio.input.value);
      refRatio.setError('');
      if (isNaN(adj) || adj < 0 || adj > 100) {
        refRatio.setError('Enter a percentage between 0 and 100'); return;
      }
      if (!ok) return;
      var a = Store.create({
        name: name.input.value.trim(), code: code.input.value.trim().toUpperCase(),
        description: desc.input.value.trim(), status: status.input.value
      });
      Store.assayOf(a).referenceRatioAdjustment = adj;
      Store.save();
      m.close();
      UI.toast({
        kind: 'success', title: 'Analytics created',
        text: a.name + ' — download the sample file, populate it, then upload it back.'
      });
      App.go('analytic/' + a.id + '/upload');
    }
  };

  /* ============================================================
     ANALYTIC OVERVIEW
     ============================================================ */
  Screens.analyticOverview = function (a) {
    var st = Store.stateOf(a);
    var g = Store.groups(a);
    var v = a.validation;
    var body = el('div', {});

    /* next-action banner */
    var next = nextAction(a, st);
    var banner = el('div', { class: 'card' });
    banner.innerHTML = '<div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<div style="width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto;background:' +
      next.bg + ';color:' + next.fg + '">' + U.icon(next.icon, 20) + '</div>' +
      '<div style="min-width:220px;flex:1 1 260px"><div style="font-size:14.5px;font-weight:700">' + esc(next.title) + '</div>' +
      '<p style="font-size:12.5px;color:var(--ink-3);margin-top:2px">' + esc(next.text) + '</p></div></div>';
    var bAct = el('div', { style: 'margin-left:auto;display:flex;gap:8px;flex-wrap:wrap' });
    bAct.appendChild(UI.btn(next.cta, 'btn-primary', function () { App.go('analytic/' + a.id + '/' + next.step); }, { icon: 'arrowRight' }));
    U.$('.card-body', banner).appendChild(bAct);
    body.appendChild(banner);

    /* summary tiles */
    var tiles = el('div', { class: 'grid g4 mt4' });
    tiles.innerHTML =
      UI.stat({
        label: Store.filesOf(a).length > 1 ? 'Records in ' + Store.filesOf(a).length + ' files' : 'Records in file',
        value: a.file ? U.fmtInt(a.file.recordCount) : '—', icon: 'file', tone: 'blue',
        note: a.file ? a.file.columnCount + ' columns · ' + esc(a.file.name) : 'No files uploaded'
      }) +
      UI.stat({ label: 'Control / Calibration', value: U.fmtInt(g.control.length) + ' / ' + U.fmtInt(g.calibration.length), icon: 'shield', tone: 'violet', note: a.classification.applied ? 'Classified on [' + esc(a.classification.field) + ']' : 'Classification pending' }) +
      UI.stat({
        label: 'Validation rules', value: U.fmtInt(a.rules.length), icon: 'rules', tone: 'teal',
        note: Store.activeRules(a).length + ' active · ' + Store.selectedFields(a).length + ' field(s) selected'
      }) +
      UI.stat({ label: 'Patient samples', value: U.fmtInt(g.patient.length), icon: 'flask', tone: Store.patientUnlocked(a) ? 'green' : 'red', note: Store.patientUnlocked(a) ? 'Testing unlocked' : 'Locked until approval' });
    body.appendChild(tiles);

    var cols = el('div', { class: 'grid g2 mt4' });

    /* validation summary */
    var vBody = el('div', {});
    vBody.innerHTML =
      '<div class="grid g2">' +
      UI.metric('Control samples', (v.controls ? U.fmtInt(v.controls.passed) + ' / ' + U.fmtInt(v.controls.total) : U.fmtInt(g.control.length) + ' pending'),
        v.controls ? (v.controls.failed ? 'red' : 'green') : '') +
      UI.metric('Calibration samples', (v.calibration ? U.fmtInt(v.calibration.passed) + ' / ' + U.fmtInt(v.calibration.total) : U.fmtInt(g.calibration.length) + ' pending'),
        v.calibration ? (v.calibration.failed ? 'red' : 'green') : '') +
      '</div>' +
      '<dl class="kv mt4">' +
      '<dt>Configuration version</dt><dd>v' + esc(a.version) + '</dd>' +
      '<dt>Analytics scope</dt><dd>' + (a.analyteScope.field
        ? esc(a.analyteScope.values.join(', ')) + ' <span class="muted">on [' + esc(a.analyteScope.field) + ']</span>'
        : 'All uploaded records') + '</dd>' +
      '<dt>Last QC run</dt><dd>' + (v.ranAt ? esc(U.fmtDateTime(v.ranAt)) : '—') + '</dd>' +
      '<dt>Approved</dt><dd>' + (v.approved ? esc(U.fmtDateTime(v.approvedAt)) + ' · ' + esc(v.approvedBy) : '<span class="badge badge-warn">Not approved</span>') + '</dd>' +
      '<dt>Patient testing</dt><dd>' + (Store.patientUnlocked(a) ? '<span class="badge badge-success">Unlocked</span>' : '<span class="badge badge-danger">' + U.icon('lock', 11) + ' Locked</span>') + '</dd>' +
      (a.patientTesting.summary ? '<dt>Last patient run</dt><dd>' + U.fmtInt(a.patientTesting.summary.total) + ' samples · ' +
        U.fmtInt(a.patientTesting.summary.failed) + ' failed</dd>' : '') +
      '</dl>';
    cols.appendChild(Screens.card({
      title: 'Validation summary',
      actions: [UI.btn('Open validation', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id + '/validation'); }, { icon: 'shield', iconSize: 14 })],
      body: vBody
    }));

    /* version history compact */
    var versions = a.versions.length ? a.versions : [{
      version: a.version, ruleCount: a.rules.length,
      controls: v.controls ? (v.controls.failed ? 'Failed' : 'Passed') : '—',
      calibration: v.calibration ? (v.calibration.failed ? 'Failed' : 'Passed') : '—',
      patientTests: a.patientTesting.summary ? a.patientTesting.summary.total : null,
      status: v.approved ? 'Active' : 'Draft'
    }];
    var vt = el('div', { class: 'table-scroll' });
    vt.innerHTML = '<table class="tbl compact"><thead><tr><th>Version</th><th>Rules</th><th>Controls</th><th>Calibration</th>' +
      '<th class="num">Patient Tests</th><th>Status</th></tr></thead><tbody>' +
      versions.slice(0, 6).map(function (x) {
        return '<tr><td class="cell-strong">v' + esc(x.version) + '</td><td>' + esc(x.ruleCount || '—') + '</td>' +
          '<td>' + statusText(x.controls) + '</td><td>' + statusText(x.calibration) + '</td>' +
          '<td class="num">' + (x.patientTests ? U.fmtInt(x.patientTests) : '—') + '</td>' +
          '<td>' + versionStatus(x.status) + '</td></tr>';
      }).join('') + '</tbody></table>';
    cols.appendChild(Screens.card({
      title: 'Configuration versions',
      actions: [UI.btn('Full history', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id + '/history'); }, { icon: 'version', iconSize: 14 })],
      flush: true, body: vt
    }));
    body.appendChild(cols);

    /* recent audit for this analytic */
    var tl = el('div', { class: 'timeline' });
    (a.audit || []).slice(0, 6).forEach(function (e) { tl.appendChild(activityItem(e)); });
    if (!a.audit.length) tl.appendChild(el('p', { class: 'muted', text: 'No activity recorded yet.' }));
    body.appendChild(Screens.card({
      title: 'Audit trail',
      actions: [UI.btn('View all', 'btn-secondary btn-sm', function () { App.go('audit?analytic=' + a.id); }, { icon: 'audit', iconSize: 14 })],
      body: tl
    }));

    return Screens.workflowShell(a, null, body);
  };

  function statusText(s) {
    if (s === 'Passed') return '<span class="badge badge-success">Passed</span>';
    if (s === 'Failed') return '<span class="badge badge-danger">Failed</span>';
    return '<span class="muted">—</span>';
  }
  function versionStatus(s) {
    if (s === 'Active') return '<span class="badge badge-success"><span class="bdot"></span>Active</span>';
    if (s === 'Failed') return '<span class="badge badge-danger">Failed</span>';
    if (s === 'Archived') return '<span class="badge badge-neutral">Archived</span>';
    return '<span class="badge badge-info">' + esc(s || 'Draft') + '</span>';
  }
  Screens.versionStatus = versionStatus;
  Screens.statusText = statusText;

  function nextAction(a, st) {
    var S = Store.STATES;
    switch (st) {
      case S.DRAFT: return { step: 'upload', cta: 'Upload Data Files', icon: 'upload', title: 'Upload the data files', text: 'One file or many — each may contain control, calibration and patient records.', bg: 'var(--blue-100)', fg: 'var(--blue-700)' };
      case S.FILES_UPLOADED: return { step: 'analytics', cta: 'Select Analytics', icon: 'beaker', title: 'Choose the analytics to validate', text: 'The uploaded files may cover several analytics — pick the ones this workflow validates.', bg: 'var(--violet-100)', fg: 'var(--violet-600)' };
      case S.ANALYTICS_SELECTED: return { step: 'mapping', cta: 'Classify Samples', icon: 'target', title: 'Identify the sample types', text: 'Map which values in the data mean control, calibration and patient.', bg: 'var(--blue-100)', fg: 'var(--blue-700)' };
      case S.CLASSIFIED: return { step: 'fields', cta: 'Select Fields', icon: 'clipboard', title: 'Select the fields to validate', text: 'Pick which of the detected fields take part in validation.', bg: 'var(--blue-100)', fg: 'var(--blue-700)' };
      case S.FIELDS_SELECTED: return { step: 'rules', cta: 'Configure Rules', icon: 'rules', title: 'Configure validation rules', text: 'Build rules for any selected field — nothing is hardcoded.', bg: 'var(--violet-100)', fg: 'var(--violet-600)' };
      case S.RULES_CONFIGURED: return { step: 'validation', cta: 'Run QC Validation', icon: 'shield', title: 'Validate controls and calibration', text: 'Both are validated together from the same file before patient testing.', bg: 'var(--violet-100)', fg: 'var(--violet-600)' };
      case S.VALIDATION_FAILED: return { step: 'validation', cta: 'Correct & Re-test', icon: 'warning', title: 'QC validation failed', text: 'Correct the failing rule or data, then re-test. Patient testing stays locked.', bg: 'var(--red-100)', fg: 'var(--red-700)' };
      case S.VALIDATION_PASSED: return { step: 'approval', cta: 'Approve Validation', icon: 'check', title: 'Ready for approval', text: 'Controls and calibration passed on v' + a.version + '. Sign off to unlock patient testing.', bg: 'var(--green-100)', fg: 'var(--green-700)' };
      case S.APPROVED: return { step: 'patient', cta: 'Start Patient Testing', icon: 'flask', title: 'Patient testing unlocked', text: 'Run the patient records already present in the uploaded file.', bg: 'var(--green-100)', fg: 'var(--green-700)' };
      case S.PATIENT_TESTING: return { step: 'patient', cta: 'Resume Testing', icon: 'play', title: 'Patient testing in progress', text: 'Continue the current patient sample run.', bg: 'var(--blue-100)', fg: 'var(--blue-700)' };
      default: return { step: 'results', cta: 'View Results', icon: 'report', title: 'Patient results available', text: 'Review pass / fail outcomes and export the run.', bg: 'var(--teal-100)', fg: 'var(--teal-600)' };
    }
  }
}(typeof window !== 'undefined' ? window : this));
