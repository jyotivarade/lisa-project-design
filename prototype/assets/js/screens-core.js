/* ============================================================
   screens-core.js — shared page furniture, dashboard, the analytics
   list, create/edit analytic and settings.
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

  /** Badge for one upload's status. */
  Screens.uploadStatusBadge = function (u) {
    var m = Store.UPLOAD_STATUS[u.status] || Store.UPLOAD_STATUS.completed;
    return '<span class="badge ' + m.badge + '">' + esc(m.label) + '</span>';
  };

  /** "3 uploads · last 2 days ago" summary line for an analytic. */
  Screens.uploadSummary = function (a) {
    var ups = Store.uploadsOf(a);
    if (!ups.length) return 'No uploads yet';
    var last = Store.latestUpload(a);
    return U.fmtInt(ups.length) + ' upload' + (ups.length === 1 ? '' : 's') +
      ' · last ' + U.relTime(last.uploadedAt);
  };

  /* ============================================================
     DASHBOARD
     ============================================================ */
  Screens.dashboard = function () {
    var o = Store.overview();
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Dashboard',
      sub: 'Every file uploaded for analytics, and what came out of it.',
      actions: [UI.btn('Go to Analytics', 'btn-primary', function () { App.go('analytics'); }, { icon: 'beaker' })]
    }));

    var tiles = el('div', { class: 'grid g4' });
    tiles.innerHTML =
      UI.stat({
        label: 'Analytics', value: U.fmtInt(o.analytics), icon: 'beaker', tone: 'blue',
        note: U.fmtInt(Store.all().filter(function (a) { return Store.statusOf(a) === 'active'; }).length) + ' with uploads'
      }) +
      UI.stat({
        label: 'Files uploaded', value: U.fmtInt(o.uploads), icon: 'upload', tone: 'violet',
        note: o.lastUploadAt ? 'Last ' + esc(U.relTime(o.lastUploadAt)) : 'No uploads yet'
      }) +
      UI.stat({
        label: 'Rows processed', value: U.fmtInt(o.rows), icon: 'table', tone: 'teal',
        note: U.fmtInt(o.failed) + ' failed · ' + U.fmtInt(o.warnings) + ' warning(s)'
      }) +
      UI.stat({
        label: 'Pass rate', value: o.passRate === null ? '—' : U.fmtPct(o.passRate),
        icon: 'check', tone: o.passRate !== null && o.passRate < 90 ? 'amber' : 'green',
        note: 'Across every processed upload'
      });
    wrap.appendChild(tiles);

    /* recent uploads across every analytic */
    var recent = Store.recentUploads(8);
    var body = el('div', {});
    if (!recent.length) {
      body.appendChild(UI.emptyState({
        icon: 'upload', title: 'Nothing uploaded yet',
        desc: 'Open an analytic and upload a file — it is processed on arrival and its analytics are kept for good.',
        actions: [UI.btn('Go to Analytics', 'btn-primary', function () { App.go('analytics'); }, { icon: 'beaker' })]
      }));
    } else {
      var list = el('div', { class: 'list-rows' });
      recent.forEach(function (r) { list.appendChild(Screens.uploadRow(r.analytic, r.upload, true)); });
      body.appendChild(list);
    }
    wrap.appendChild(el('div', { class: 'mt4' }, [Screens.card({
      title: 'Recent uploads',
      badge: '<span class="badge badge-neutral">' + U.fmtInt(Store.recentUploads().length) + ' total</span>',
      body: body
    })]));

    if (Store.S.storageDegraded) {
      wrap.appendChild(el('div', {
        class: 'mt4', html: UI.alertBox('warn', 'Browser storage is full',
          'Upload history is still saved, but the rows themselves are only held in memory for this session. ' +
          'Delete an older upload to make room.')
      }));
    }
    return wrap;
  };

  /** One line describing an upload — used on the dashboard and analytic screens. */
  Screens.uploadRow = function (a, u, showAnalytic) {
    var rep = u.report;
    var row = el('div', { class: 'lr' });
    row.innerHTML =
      '<span class="file-ico">' + esc((u.fileName.split('.').pop() || 'CSV').toUpperCase()) + '</span>' +
      '<div class="lr-main"><div class="lr-t">' + esc(u.fileName) +
      (showAnalytic ? ' <span class="muted">· ' + esc(a.name) + '</span>' : '') + '</div>' +
      '<div class="lr-d">Upload #' + esc(String(u.no)) + ' · ' + esc(U.fmtDateTime(u.uploadedAt)) +
      ' · ' + esc(u.uploadedBy) + ' · ' + U.fmtInt(u.rowCount) + ' rows' +
      (rep ? ' · ' + U.fmtInt(rep.passed) + ' passed / ' + U.fmtInt(rep.failed) + ' failed' : '') +
      '</div></div>';
    var act = el('div', { class: 'lr-act row', style: 'gap:6px' });
    act.appendChild(el('span', { html: Screens.uploadStatusBadge(u) }));
    act.appendChild(UI.btn('View analytics', 'btn-secondary btn-sm', function () {
      App.go('analytic/' + a.id + '/upload/' + u.id);
    }, { icon: 'report', iconSize: 13 }));
    row.appendChild(act);
    return row;
  };

  /* ============================================================
     ANALYTICS LIST
     ============================================================ */
  var listState = { q: '' };

  Screens.analytics = function () {
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Analytics',
      sub: 'Upload an Excel file to any analytic — every upload is processed on its own and keeps its own report.',
      actions: [UI.btn('Create Analytics', 'btn-primary', function () { Screens.analyticModal(); }, { icon: 'plus' })]
    }));

    var bar = el('div', { class: 'filter-bar' });
    var si = el('div', { class: 'search-inp' });
    si.innerHTML = U.icon('search', 15);
    var input = el('input', {
      class: 'inp', type: 'search', placeholder: 'Search analytics…', value: listState.q,
      oninput: U.debounce(function () { listState.q = input.value.trim().toLowerCase(); paint(); }, 160)
    });
    si.appendChild(input);
    bar.appendChild(si);
    wrap.appendChild(bar);

    var grid = el('div', { class: 'grid g-auto' });
    wrap.appendChild(grid);

    function paint() {
      grid.innerHTML = '';
      var rows = Store.all().filter(function (a) {
        if (!listState.q) return true;
        return (a.name + ' ' + a.code + ' ' + a.description).toLowerCase().indexOf(listState.q) > -1;
      });
      if (!rows.length) {
        var c = Screens.card({
          body: UI.emptyState({
            icon: 'beaker', title: 'No analytics match',
            desc: 'Try a different search term, or create a new analytic to upload files into.',
            actions: [UI.btn('Create Analytics', 'btn-primary', function () { Screens.analyticModal(); }, { icon: 'plus' })]
          })
        });
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
    var ups = Store.uploadsOf(a);
    var last = Store.latestUpload(a);
    var rep = last && last.report;
    var card = el('div', { class: 'a-card ' + meta.cls });

    card.innerHTML =
      '<div class="a-card-head">' +
        '<span class="a-ico" style="background:' + esc(a.color) + '">' + esc((a.code || a.name).slice(0, 4).toUpperCase()) + '</span>' +
        '<div style="min-width:0"><div class="a-name">' + esc(a.name) + '</div><div class="a-code">' + esc(a.code || a.id) + '</div></div>' +
      '</div>' +
      '<div class="a-card-body">' +
        '<div class="a-meta">' + UI.statusBadge(status) +
          '<span class="badge badge-neutral">' + U.icon('upload', 11) + ' ' + U.fmtInt(ups.length) +
          ' upload' + (ups.length === 1 ? '' : 's') + '</span>' +
          (last ? Screens.uploadStatusBadge(last) : '') +
        '</div>' +
        '<p class="a-desc">' + esc(a.description || 'No description provided.') + '</p>' +
        (last
          ? '<dl class="kv"><dt>Latest file</dt><dd>' + esc(last.fileName) + '</dd>' +
            '<dt>Uploaded</dt><dd>' + esc(U.fmtDateTime(last.uploadedAt)) + '</dd>' +
            '<dt>Result</dt><dd>' + (rep
              ? U.fmtInt(rep.passed) + ' passed · ' + U.fmtInt(rep.failed) + ' failed · ' + U.fmtInt(rep.warnings) + ' warning(s)'
              : esc(last.statusNote || '—')) + '</dd></dl>'
          : '<p class="muted" style="font-size:12.5px">No file has been uploaded to this analytic yet.</p>') +
      '</div>' +
      '<div class="a-card-foot"><span class="ts">' + esc(Screens.uploadSummary(a)) + '</span></div>';

    var foot = U.$('.a-card-foot', card);
    foot.appendChild(UI.btn('Upload File', 'btn-secondary btn-sm', function () { Uploads.pick(a); },
      { icon: 'upload', iconSize: 14 }));
    foot.appendChild(UI.btn('Open', 'btn-primary btn-sm', function () { App.go('analytic/' + a.id); },
      { icon: 'arrowRight', iconSize: 14 }));
    return card;
  }

  /* ============================================================
     CREATE / EDIT ANALYTIC
     ============================================================ */
  Screens.analyticModal = function (existing) {
    var name = UI.fieldGroup({ label: 'Analytics Name', required: true, placeholder: 'e.g. HbA1c Analysis', value: existing ? existing.name : '' });
    var code = UI.fieldGroup({ label: 'Analytics Code', required: true, placeholder: 'e.g. HBA1C', value: existing ? existing.code : '', hint: 'Short uppercase identifier used in exported file names.' });
    var desc = UI.fieldGroup({ label: 'Description', type: 'textarea', placeholder: 'What this analytic covers…', value: existing ? existing.description : '' });

    if (!existing) {
      name.input.addEventListener('input', function () {
        if (!code.input.dataset.touched) {
          code.input.value = name.input.value.replace(/[^A-Za-z0-9]+/g, '').slice(0, 10).toUpperCase();
        }
      });
      code.input.addEventListener('input', function () { code.input.dataset.touched = '1'; });
    }

    var body = el('div', {}, [
      el('div', { class: 'form-grid two' }, [name, code]),
      el('div', { class: 'form-grid mt4' }, [desc]),
      existing ? null : el('div', {
        class: 'alert alert-info mt4',
        html: U.icon('info', 16) + '<div><div class="alert-t">Upload as many files as you need</div>' +
          '<p>Each file you upload here is processed on its own and keeps its own analytics report. ' +
          'There is no limit, and a new upload never changes an earlier one.</p></div>'
      })
    ].filter(Boolean));

    var m = UI.modal({
      title: existing ? 'Edit Analytics' : 'Create Analytics', body: body,
      footer: [
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        UI.btn(existing ? 'Save changes' : 'Create Analytics', 'btn-primary', submit, { icon: existing ? 'check' : 'plus' })
      ]
    });

    function submit() {
      var ok = true;
      name.setError(''); code.setError('');
      var nameVal = name.input.value.trim(), codeVal = code.input.value.trim().toUpperCase();
      if (!nameVal) { name.setError('Analytics name is required'); ok = false; }
      if (!codeVal) { code.setError('Analytics code is required'); ok = false; }
      else if (Store.all().some(function (a) {
        return a.code && a.code.toUpperCase() === codeVal && (!existing || a.id !== existing.id);
      })) { code.setError('This code is already in use'); ok = false; }
      if (!ok) return;

      m.close();
      if (existing) {
        Store.update(existing, { name: nameVal, code: codeVal, description: desc.input.value.trim() });
        UI.toast({ kind: 'success', title: 'Analytics updated', text: nameVal });
        App.render();
        return;
      }
      var a = Store.create({ name: nameVal, code: codeVal, description: desc.input.value.trim() });
      UI.toast({ kind: 'success', title: 'Analytics created', text: a.name + ' — upload a file to generate analytics.' });
      App.go('analytic/' + a.id);
    }
  };

  /* ============================================================
     SETTINGS
     ============================================================ */
  Screens.settings = function () {
    var wrap = el('div', {});
    wrap.appendChild(Screens.pageHead({
      title: 'Settings',
      sub: 'Signed-in user, table defaults and prototype data.'
    }));

    var u = Store.S.user || {};
    var profile = el('dl', { class: 'kv' });
    profile.innerHTML =
      '<dt>Name</dt><dd>' + esc(u.name || '') + '</dd>' +
      '<dt>Email</dt><dd>' + esc(u.email || '') + '</dd>' +
      '<dt>Role</dt><dd>' + esc(u.role || '') + '</dd>';
    wrap.appendChild(Screens.card({ title: 'Profile', body: profile }));

    /* table + parsing defaults */
    var pageSize = UI.fieldGroup({
      label: 'Rows per page', type: 'select', value: String(Store.S.settings.pageSize),
      options: [10, 25, 50, 100].map(function (n) { return { value: String(n), label: n + ' rows' }; })
    });
    pageSize.input.addEventListener('change', function () {
      Store.S.settings.pageSize = parseInt(this.value, 10);
      Store.save();
      UI.toast({ kind: 'success', title: 'Saved', text: 'Tables now show ' + this.value + ' rows per page.' });
    });

    var tokens = UI.fieldGroup({
      label: 'Values treated as “no result”', value: Store.S.settings.missingTokens,
      hint: 'Comma separated. Instrument placeholders such as ---- or N.I.(High) are read as empty, so a column of numbers is still detected as numeric.'
    });
    tokens.input.addEventListener('change', function () {
      var list = this.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      Store.S.settings.missingTokens = list.join(', ');
      U.setMissingTokens(list);
      Store.save();
      UI.toast({ kind: 'success', title: 'Saved', text: list.length + ' token(s) treated as missing.' });
    });

    wrap.appendChild(el('div', { class: 'mt4' }, [Screens.card({
      title: 'Defaults',
      body: el('div', { class: 'form-grid two' }, [pageSize, tokens])
    })]));

    /* prototype data */
    var reset = el('div', {});
    reset.innerHTML = '<p style="font-size:13px;color:var(--ink-2);line-height:1.6">' +
      'Everything lives in this browser (<code>lisa.state.v2</code> in localStorage). Resetting rebuilds the demo ' +
      'analytics and their upload history, and discards any file you uploaded yourself.</p>';
    var rBtn = el('div', { class: 'row mt4' });
    rBtn.appendChild(UI.btn('Reset prototype data', 'btn-danger', function () {
      UI.confirm({
        title: 'Reset all prototype data?',
        message: 'Every analytic, upload and report goes back to the shipped demo state.',
        confirmLabel: 'Reset everything', danger: true
      }).then(function (ok) {
        if (!ok) return;
        Store.reset();
        UI.toast({ kind: 'success', title: 'Prototype reset' });
        App.go('dashboard');
        App.render();
      });
    }, { icon: 'refresh' }));
    reset.appendChild(rBtn);
    wrap.appendChild(el('div', { class: 'mt4' }, [Screens.card({ title: 'Prototype data', body: reset })]));

    return wrap;
  };
}(typeof window !== 'undefined' ? window : this));
