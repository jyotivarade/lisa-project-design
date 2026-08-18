/* ============================================================
   screens-uploads.js — the whole flow, in one file:

       Analytics → Upload file → Process → Analytics report
                 → Upload history → Any previous report

   `Screens.analytic`      one analytic: the drop zone plus every upload
                           it has ever received.
   `Screens.uploadReport`  the analytics generated from ONE upload.
   `Uploads`               picking, reading and processing files.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  var ACCEPT = ['.xlsx', '.xls', '.csv'];
  var MAX_BYTES = 25 * 1024 * 1024;

  /* ============================================================
     ONE ANALYTIC — upload here, and see everything uploaded before
     ============================================================ */
  Screens.analytic = function (a) {
    var wrap = el('div', {});
    var uploads = Store.uploadsNewestFirst(a);

    /* header */
    var head = el('div', { class: 'page-head' });
    var title = el('div', { class: 'row', style: 'gap:10px' });
    title.innerHTML = '<span class="a-ico" style="background:' + esc(a.color) + '">' +
      esc((a.code || a.name).slice(0, 4).toUpperCase()) + '</span>';
    var titleText = el('div', {});
    titleText.appendChild(el('h1', { class: 'page-title', text: a.name }));
    titleText.appendChild(el('div', {
      class: 'row', style: 'gap:8px;margin-top:3px',
      html: UI.statusBadge(Store.statusOf(a)) +
        '<span class="muted" style="font-size:12.5px">' + esc(a.code || a.id) + ' · ' +
        esc(Screens.uploadSummary(a)) + '</span>'
    }));
    title.appendChild(titleText);
    head.appendChild(title);

    var acts = el('div', { class: 'page-head-actions' });
    acts.appendChild(UI.btn('Edit', 'btn-secondary btn-sm', function () { Screens.analyticModal(a); }, { icon: 'edit', iconSize: 14 }));
    acts.appendChild(UI.btn('Upload Excel File', 'btn-primary btn-sm', function () { Uploads.pick(a); }, { icon: 'upload', iconSize: 14 }));
    head.appendChild(acts);
    wrap.appendChild(head);

    if (a.description) {
      wrap.appendChild(el('p', { class: 'page-sub', style: 'margin:-6px 0 14px', text: a.description }));
    }

    /* the drop zone is always here — upload a new file at any time */
    wrap.appendChild(Screens.card({
      title: 'Upload a file',
      actions: [
        UI.btn('Download Template', 'btn-secondary btn-sm', function () { Uploads.downloadTemplate(a); }, { icon: 'download', iconSize: 14 }),
        UI.btn('Use a demo file', 'btn-secondary btn-sm', function () { Uploads.loadDemo(a); }, { icon: 'bolt', iconSize: 14 })
      ],
      body: dropZone(a)
    }));

    /* upload history */
    var histBody = uploads.length
      ? historyTable(a, uploads)
      : UI.emptyState({
        icon: 'upload', title: 'No uploads yet',
        desc: 'Upload an Excel or CSV file. It is processed straight away and its analytics are saved here for good.',
        actions: [UI.btn('Upload Excel File', 'btn-primary', function () { Uploads.pick(a); }, { icon: 'upload' })]
      });

    wrap.appendChild(el('div', { class: 'mt4' }, [Screens.card({
      title: 'Upload history',
      badge: '<span class="badge badge-neutral">' + U.fmtInt(uploads.length) + ' upload' +
        (uploads.length === 1 ? '' : 's') + '</span>',
      flush: uploads.length > 0,
      body: histBody
    })]));

    /* deleting the analytic itself lives out of the way, at the bottom */
    var danger = el('div', { class: 'row' });
    danger.appendChild(UI.btn('Delete this analytic', 'btn-ghost btn-sm', function () {
      UI.confirm({
        title: 'Delete ' + a.name + '?',
        message: 'Its ' + U.fmtInt(uploads.length) + ' upload(s) and every report generated from them are removed.',
        confirmLabel: 'Delete analytic', danger: true
      }).then(function (ok) {
        if (!ok) return;
        Store.remove(a.id);
        UI.toast({ kind: 'info', title: 'Analytic deleted', text: a.name });
        App.go('analytics');
      });
    }, { icon: 'trash', iconSize: 13 }));
    wrap.appendChild(el('div', { class: 'mt4' }, [danger]));

    return wrap;
  };

  /** Drag & drop that works from this screen at any time. */
  function dropZone(a) {
    var dz = el('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Upload a data file' });
    dz.innerHTML =
      '<div class="dz-ico">' + U.icon('upload', 24) + '</div>' +
      '<p class="dz-t">Drop an Excel file here</p>' +
      '<p class="dz-d">or <span style="color:var(--blue-600);font-weight:650">browse from your computer</span></p>' +
      '<div class="dz-meta"><span>' + U.icon('file', 12) + ' XLSX, XLS or CSV</span><span>·</span>' +
      '<span>As many files as you need</span><span>·</span>' +
      '<span>Each upload keeps its own analytics</span></div>';

    dz.addEventListener('click', function () { Uploads.pick(a); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Uploads.pick(a); }
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files.length) Uploads.handle(a, e.dataTransfer.files);
    });
    return dz;
  }

  /** One row per upload — everything the spec asks to be tracked. */
  function historyTable(a, uploads) {
    return UI.dataTable({
      rows: uploads, unit: 'uploads', pageSize: 10, hideToolbar: uploads.length <= 5,
      searchPlaceholder: 'Search file name or user…',
      searchText: function (u) { return u.fileName + ' ' + u.uploadedBy; },
      defaultSort: 'uploadedAt', defaultDir: 'desc',
      onRow: function (u) { App.go('analytic/' + a.id + '/upload/' + u.id); },
      columns: [
        {
          key: 'no', label: '#', width: '56px',
          render: function (u) { return '<span class="cell-strong">' + esc(String(u.no)) + '</span>'; },
          value: function (u) { return u.no; }
        },
        {
          key: 'fileName', label: 'File name',
          render: function (u) {
            return '<span class="cell-strong">' + esc(u.fileName) + '</span>' +
              (u.simulated ? ' <span class="badge badge-warn">simulated parse</span>' : '') +
              '<br><span class="cell-sub">' + U.fmtBytes(u.size) + ' · ' + U.fmtInt(u.rowCount) + ' rows · ' +
              U.fmtInt(u.columnCount) + ' columns' +
              (u.blankRowsSkipped ? ' · ' + U.fmtInt(u.blankRowsSkipped) + ' blank skipped' : '') + '</span>';
          }
        },
        {
          key: 'uploadedAt', label: 'Upload date & time',
          render: function (u) {
            return esc(U.fmtDateTime(u.uploadedAt)) +
              '<br><span class="cell-sub">' + esc(U.relTime(u.uploadedAt)) + '</span>';
          },
          value: function (u) { return u.uploadedAt; }
        },
        { key: 'uploadedBy', label: 'Uploaded by', render: function (u) { return esc(u.uploadedBy); } },
        {
          key: 'status', label: 'Status', align: 'center',
          render: function (u) { return Screens.uploadStatusBadge(u); }
        },
        {
          key: 'result', label: 'Analytics generated', sortable: false,
          render: function (u) {
            if (!u.report) return '<span class="muted">' + esc(u.statusNote || 'Not processed') + '</span>';
            var r = u.report;
            if (r.notEvaluated === r.total) return '<span class="muted">' + esc(u.statusNote) + '</span>';
            return '<span style="color:var(--green-700);font-weight:650">' + U.fmtInt(r.passed) + ' passed</span>' +
              ' · <span style="color:' + (r.failed ? 'var(--red-700)' : 'var(--ink-3)') + ';font-weight:650">' +
              U.fmtInt(r.failed) + ' failed</span>' +
              ' · <span style="color:' + (r.warnings ? 'var(--amber-700)' : 'var(--ink-3)') + ';font-weight:650">' +
              U.fmtInt(r.warnings) + ' warning</span>' +
              (r.notEvaluated ? '<br><span class="cell-sub">' + U.fmtInt(r.notEvaluated) + ' row(s) not evaluated</span>' : '');
          }
        },
        {
          key: 'actions', label: '', sortable: false,
          render: function (u) {
            var box = el('div', { class: 'tbl-actions' });
            box.appendChild(UI.btn('View', 'btn-secondary btn-sm', function () {
              App.go('analytic/' + a.id + '/upload/' + u.id);
            }, { icon: 'report', iconSize: 13 }));
            box.appendChild(UI.iconBtn('trash', 'Delete this upload', function () {
              UI.confirm({
                title: 'Delete upload #' + u.no + '?',
                message: esc(u.fileName) + ' and the analytics generated from it are removed. Other uploads are untouched.',
                confirmLabel: 'Delete upload', danger: true
              }).then(function (ok) {
                if (!ok) return;
                Store.deleteUpload(a, u.id);
                UI.toast({ kind: 'info', title: 'Upload deleted', text: u.fileName });
                App.render();
              });
            }));
            return box;
          }
        }
      ]
    });
  }

  /* ============================================================
     THE ANALYTICS REPORT FOR ONE UPLOAD
     ============================================================ */
  Screens.uploadReport = function (a, u) {
    var wrap = el('div', {});
    var rep = u.report;

    /* header */
    var head = el('div', { class: 'page-head' });
    var left = el('div', {});
    left.appendChild(el('p', {
      class: 'eyebrow',
      html: '<button type="button" class="link-btn" data-back>' + U.icon('arrowLeft', 12) + ' ' + esc(a.name) + '</button>'
    }));
    left.appendChild(el('h1', { class: 'page-title', text: u.fileName }));
    left.appendChild(el('div', {
      class: 'row', style: 'gap:8px;margin-top:4px',
      html: '<span class="badge badge-info">Upload #' + esc(String(u.no)) + '</span>' +
        Screens.uploadStatusBadge(u) +
        '<span class="muted" style="font-size:12.5px">' + esc(U.fmtDateTime(u.uploadedAt)) +
        ' · ' + esc(u.uploadedBy) + '</span>'
    }));
    head.appendChild(left);
    var acts = el('div', { class: 'page-head-actions' });
    acts.appendChild(UI.btn('Preview rows', 'btn-secondary btn-sm', function () { previewDrawer(a, u); }, { icon: 'table', iconSize: 14 }));
    acts.appendChild(UI.btn('All uploads', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id); }, { icon: 'upload', iconSize: 14 }));
    head.appendChild(acts);
    wrap.appendChild(head);
    U.on(head, 'click', '[data-back]', function () { App.go('analytic/' + a.id); });

    if (!rep) {
      wrap.appendChild(Screens.card({
        body: UI.emptyState({
          icon: 'warning', title: 'This file could not be processed',
          desc: u.statusNote || 'The file was stored, but no analytics could be generated from it.',
          actions: [UI.btn('Back to uploads', 'btn-primary', function () { App.go('analytic/' + a.id); }, { icon: 'arrowLeft' })]
        })
      }));
      return wrap;
    }

    /* headline numbers */
    var tiles = el('div', { class: 'grid g4' });
    tiles.innerHTML =
      UI.stat({
        label: 'Rows processed', value: U.fmtInt(rep.total), icon: 'table', tone: 'blue',
        note: U.fmtInt(u.columnCount) + ' columns' +
          (rep.notEvaluated ? ' · ' + U.fmtInt(rep.notEvaluated) + ' row(s) not evaluated' : '')
      }) +
      UI.stat({ label: 'Passed', value: U.fmtInt(rep.passed), icon: 'check', tone: 'green', note: pct(rep.passed, rep.total) }) +
      UI.stat({ label: 'Failed', value: U.fmtInt(rep.failed), icon: 'x', tone: rep.failed ? 'red' : 'green', note: pct(rep.failed, rep.total) }) +
      UI.stat({ label: 'Warnings', value: U.fmtInt(rep.warnings), icon: 'warning', tone: rep.warnings ? 'amber' : 'green', note: pct(rep.warnings, rep.total) });
    wrap.appendChild(tiles);

    if (!Analyze.isReadable(rep)) {
      wrap.appendChild(el('div', {
        class: 'mt4',
        html: UI.alertBox('warn', 'No LISA criteria could be applied to this file',
          'None of the criteria columns (Sample ID / Sample Type, % Diff, ISTD Area, Conc., ion ratio, Found RT) were ' +
          'found in this file, or it holds no calibrators or controls — so no row was judged pass or fail. ' +
          'The classification and column profile below still describe everything the file contains.')
      }));
    }

    var cols2 = el('div', { class: 'grid g2 mt4' });
    cols2.appendChild(Screens.card({ title: 'Upload details', body: detailsList(a, u, rep) }));
    cols2.appendChild(Screens.card({ title: 'Sample classification', body: classificationBody(rep) }));
    wrap.appendChild(cols2);

    /* criteria outcome + the values derived from this file */
    wrap.appendChild(el('div', { class: 'mt4' }, [Screens.card({
      title: 'Criteria outcome',
      badge: '<span class="badge badge-neutral">' + U.fmtInt(rep.criteriaApplied.length) + ' criteria</span>',
      flush: true,
      body: criteriaTable(rep)
    })]));

    var derivedNode = derivedBody(rep);
    if (derivedNode) {
      wrap.appendChild(el('div', { class: 'mt4' }, [Screens.card({
        title: 'Values derived from this file',
        body: derivedNode
      })]));
    }

    /* exceptions — only meaningful when a criterion actually ran */
    if (rep.notEvaluated < rep.total) {
      wrap.appendChild(el('div', { class: 'mt4' }, [Screens.card({
        title: 'Exceptions',
        badge: '<span class="badge ' + (rep.exceptions.length ? 'badge-warn' : 'badge-success') + '">' +
          U.fmtInt(rep.exceptions.length) + ' row(s) flagged</span>',
        actions: [
          UI.btn('Download Exceptions', 'btn-secondary btn-sm', function () { downloadExceptions(a, u); }, { icon: 'download', iconSize: 14 }),
          UI.btn('Download Passed Rows', 'btn-secondary btn-sm', function () { downloadPassed(a, u); }, { icon: 'download', iconSize: 14 })
        ],
        flush: true,
        body: exceptionsTable(a, u, rep)
      })]));
    }

    /* column profile — works for any file, LISA-shaped or not */
    wrap.appendChild(el('div', { class: 'mt4' }, [Screens.card({
      title: 'Column profile',
      badge: '<span class="badge badge-neutral">' + U.fmtInt(rep.profile.length) + ' columns</span>',
      flush: true,
      body: profileTable(rep)
    })]));

    return wrap;
  };

  function pct(n, total) { return total ? U.fmtPct(n / total * 100) + ' of rows' : '—'; }

  function detailsList(a, u, rep) {
    var kv = el('dl', { class: 'kv' });
    var rows = [
      ['File name', u.fileName],
      ['Analytic', a.name + ' (' + (a.code || a.id) + ')'],
      ['Upload number', '#' + u.no],
      ['Upload date & time', U.fmtDateTime(u.uploadedAt)],
      ['Uploaded by', u.uploadedBy],
      ['Upload status', (Store.UPLOAD_STATUS[u.status] || {}).long || u.status],
      ['File size', U.fmtBytes(u.size)],
      ['Rows', U.fmtInt(u.rowCount) + (u.blankRowsSkipped ? ' (' + U.fmtInt(u.blankRowsSkipped) + ' blank row(s) skipped)' : '')],
      ['Columns', U.fmtInt(u.columnCount)],
      ['Processed at', U.fmtDateTime(rep.generatedAt)],
      ['Processing time', rep.durationMs + ' ms'],
      ['Sample ID column', rep.idColumn || 'not found'],
      ['Sample Type column', rep.typeColumn || 'not found']
    ];
    kv.innerHTML = rows.map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(String(r[1])) + '</dd>';
    }).join('');
    return kv;
  }

  function classificationBody(rep) {
    var c = rep.streamCounts;
    var box = el('div', {});
    var tiles = el('div', { class: 'grid g2' });
    tiles.innerHTML =
      UI.metric('Calibrators', U.fmtInt(c.calibrator)) +
      UI.metric('Controls', U.fmtInt(c.control)) +
      UI.metric('Patient samples', U.fmtInt(c.patient), 'blue') +
      UI.metric('Unclassified', U.fmtInt(c.unmatched), c.unmatched ? 'amber' : '');
    box.appendChild(tiles);
    box.appendChild(el('p', {
      class: 'hint mt3',
      text: rep.idColumn || rep.typeColumn
        ? 'Read from this file’s own ' +
          [rep.idColumn ? '[' + rep.idColumn + ']' : null, rep.typeColumn ? '[' + rep.typeColumn + ']' : null]
            .filter(Boolean).join(' and ') +
          ' values — calibrators Cal_n / Standard, controls WSC·WCS·UC / Control, patients numeric / Unknown.'
        : 'No Sample ID or Sample Type column was found, so every row is unclassified and the criteria could not run.'
    }));
    return box;
  }

  function criteriaTable(rep) {
    var wrap = el('div', { class: 'table-scroll' });
    wrap.innerHTML = '<table class="tbl compact"><thead><tr>' +
      '<th>Criterion</th><th>Applies to</th><th>Reads column</th><th>Rule applied</th>' +
      '<th class="num">Evaluated</th><th class="num">Failed</th><th class="num">Warnings</th>' +
      '</tr></thead><tbody>' +
      rep.criteriaApplied.map(function (c) {
        var x = rep.byCriterion[c.key] || { evaluated: 0, failed: 0, warnings: 0 };
        return '<tr' + (c.column ? '' : ' class="row-muted"') + '>' +
          '<td class="cell-strong">' + esc(c.name) + '</td>' +
          '<td>' + esc(Analyze.streamLabel(c.stream)) + '</td>' +
          '<td>' + (c.column ? esc(c.column) : '<span class="badge badge-neutral">not in file</span>') + '</td>' +
          '<td><span class="cell-sub">' + esc(c.rule) + '</span></td>' +
          '<td class="num">' + U.fmtInt(x.evaluated) + '</td>' +
          '<td class="num"' + (x.failed ? ' style="color:var(--red-700);font-weight:650"' : '') + '>' + U.fmtInt(x.failed) + '</td>' +
          '<td class="num"' + (x.warnings ? ' style="color:var(--amber-700);font-weight:650"' : '') + '>' + U.fmtInt(x.warnings) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
    return wrap;
  }

  function derivedBody(rep) {
    var d = rep.derived;
    var rows = [];
    if (d.cutoff !== null && d.cutoff !== undefined && !isNaN(d.cutoff)) {
      rows.push(['Cut-off', U.fmtNum(d.cutoff, 4) + ' ng/mL', d.cutoffSource]);
    }
    if (d.ionRatioRange) {
      rows.push(['Acceptable ion-ratio range', U.fmtNum(d.ionRatioRange[0], 2) + ' – ' + U.fmtNum(d.ionRatioRange[1], 2), d.ionRatioBasis]);
    }
    if (d.rtWindow) {
      rows.push(['Retention-time window', U.fmtNum(d.rtWindow[0], 3) + ' – ' + U.fmtNum(d.rtWindow[1], 3),
        'Calibrator average ' + U.fmtNum(d.rtAverage, 3) + ' ± ' + d.rtWindowPct + '%']);
    }
    if (d.calibrationRange) {
      rows.push(['Calibrated measuring range', U.fmtNum(d.calibrationRange[0], 4) + ' – ' + U.fmtNum(d.calibrationRange[1], 4) + ' ng/mL',
        'Lowest and highest calibrator standard concentration']);
    }
    if (!rows.length) return null;

    var box = el('div', { class: 'table-scroll' });
    box.innerHTML = '<table class="tbl compact"><thead><tr><th>Value</th><th>Derived</th><th>From</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="cell-strong">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td>' +
          '<td><span class="cell-sub">' + esc(r[2] || '') + '</span></td></tr>';
      }).join('') + '</tbody></table>';
    return box;
  }

  /** One row per finding, so a row failing two criteria appears twice. */
  function exceptionsTable(a, u, rep) {
    var rows = [];
    rep.exceptions.forEach(function (ex) {
      ex.issues.forEach(function (f) { rows.push({ ex: ex, f: f }); });
    });
    if (!rows.length) {
      return UI.emptyState({
        icon: 'check', title: 'Every evaluated row passed',
        desc: 'No criterion flagged a row in this file.'
      });
    }
    return UI.dataTable({
      rows: rows, unit: 'findings', pageSize: 15,
      searchPlaceholder: 'Search sample, criterion or reason…',
      rowClass: function (r) { return r.f.severity === 'Fail' ? 'row-fail' : 'row-warn'; },
      searchText: function (r) { return r.ex.id + ' ' + r.f.name + ' ' + r.f.reason; },
      filters: [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'fail', label: 'Failures', count: rows.filter(function (r) { return r.f.severity === 'Fail'; }).length, test: function (r) { return r.f.severity === 'Fail'; } },
        { key: 'warn', label: 'Warnings', count: rows.filter(function (r) { return r.f.severity === 'Warning'; }).length, test: function (r) { return r.f.severity === 'Warning'; } }
      ],
      columns: [
        { key: 'id', label: 'Sample ID', render: function (r) { return '<span class="cell-strong">' + esc(r.ex.id) + '</span>'; }, value: function (r) { return r.ex.id; } },
        { key: 'stream', label: 'Stream', render: function (r) { return esc(Analyze.streamLabel(r.ex.stream)); }, value: function (r) { return r.ex.stream; } },
        { key: 'criterion', label: 'Criterion', render: function (r) { return esc(r.f.name); }, value: function (r) { return r.f.name; } },
        { key: 'column', label: 'Column', render: function (r) { return esc(r.f.column || ''); }, value: function (r) { return r.f.column; } },
        { key: 'actual', label: 'Actual', align: 'right', render: function (r) { return esc(fmtVal(r.f.actual)); }, value: function (r) { return r.f.actual; } },
        { key: 'expected', label: 'Expected', align: 'right', render: function (r) { return esc(r.f.expected || ''); }, value: function (r) { return r.f.expected; } },
        {
          key: 'severity', label: 'Severity', align: 'center',
          render: function (r) {
            return r.f.severity === 'Fail'
              ? '<span class="badge badge-danger">Fail</span>'
              : '<span class="badge badge-warn">Warning</span>';
          },
          value: function (r) { return r.f.severity; }
        },
        { key: 'reason', label: 'Reason', sortable: false, render: function (r) { return '<span class="cell-sub">' + esc(r.f.reason) + '</span>'; } }
      ]
    });
  }

  function fmtVal(v) {
    if (v === undefined || v === null || v === '') return '—';
    return typeof v === 'number' ? U.fmtNum(v, 4) : String(v);
  }

  function profileTable(rep) {
    return UI.dataTable({
      rows: rep.profile, unit: 'columns', pageSize: 15, hideToolbar: rep.profile.length <= 10,
      searchPlaceholder: 'Search column…',
      searchText: function (f) { return f.name; },
      columns: [
        { key: 'name', label: 'Column', render: function (f) { return '<span class="cell-strong">' + esc(f.name) + '</span>'; } },
        { key: 'type', label: 'Type', align: 'center', render: function (f) { return UI.typeBadge(f.type); } },
        {
          key: 'coverage', label: 'Populated', align: 'right',
          render: function (f) {
            return U.fmtInt(f.populated) + ' <span class="cell-sub">(' + U.fmtPct(f.coverage * 100) + ')</span>';
          },
          value: function (f) { return f.coverage; }
        },
        { key: 'distinctCount', label: 'Distinct', align: 'right', render: function (f) { return U.fmtInt(f.distinctCount) + (f.distinctCount >= 60 ? '+' : ''); } },
        { key: 'min', label: 'Min', align: 'right', render: function (f) { return f.min === null ? '' : esc(U.fmtNum(f.min, 4)); } },
        { key: 'max', label: 'Max', align: 'right', render: function (f) { return f.max === null ? '' : esc(U.fmtNum(f.max, 4)); } },
        { key: 'mean', label: 'Mean', align: 'right', render: function (f) { return f.mean === null ? '' : esc(U.fmtNum(f.mean, 4)); } },
        {
          key: 'sample', label: 'Example values', sortable: false,
          render: function (f) { return '<span class="cell-sub">' + esc(f.sample.join(' · ')) + '</span>'; }
        }
      ]
    });
  }

  /** The uploaded rows, exactly as they arrived. */
  function previewDrawer(a, u) {
    var body = el('div', {});
    if (!u.records || !u.records.length) {
      body.appendChild(UI.emptyState({
        icon: 'table', title: 'Rows are no longer in memory',
        desc: 'Browser storage was full, so this upload’s rows were not kept. The report above is unaffected.'
      }));
    } else {
      var idx = Store.exceptionIndex(u.report || {});
      body.appendChild(UI.dataTable({
        rows: u.records.map(function (r, i) { return { i: i, r: r }; }),
        unit: 'rows', pageSize: 10, compact: true, columnToggle: true,
        searchPlaceholder: 'Search any value…',
        searchText: function (x) { return u.columns.map(function (c) { return x.r[c]; }).join(' '); },
        columns: [{
          key: '__status', label: 'Status', align: 'center', lockVisible: true, sortable: false,
          render: function (x) {
            var ex = idx[x.i];
            if (ex) return UI.resultBadge(ex.status);
            var rep = u.report;
            return rep && rep.notEvaluated === rep.total
              ? '<span class="muted">not evaluated</span>'
              : UI.resultBadge('pass');
          }
        }].concat(u.columns.map(function (c) {
          return {
            key: c, label: c,
            render: function (x) { return esc(U.displayValue(x.r[c])); },
            value: function (x) { return x.r[c]; }
          };
        }))
      }));
    }
    var d = UI.drawer({
      eyebrow: 'Uploaded rows', title: u.fileName, wide: true, body: body,
      footer: [UI.btn('Close', 'btn-ghost', function () { d.close(); })]
    });
  }

  /* ---------------------------------------------------------- downloads */
  function downloadPassed(a, u) {
    var out = Store.passedOutput(a, u);
    if (!out || !out.rows.length) {
      UI.toast({ kind: 'info', title: 'Nothing to export', text: 'No row in this file passed every criterion.' });
      return;
    }
    var name = Store.outputName(a, u, 'Passed');
    U.downloadText(name, U.toCSV(out.columns, out.rows));
    UI.toast({ kind: 'success', title: 'Passed rows exported', text: name + ' · ' + U.fmtInt(out.rows.length) + ' rows, exactly as uploaded.' });
  }

  function downloadExceptions(a, u) {
    var out = Store.exceptionsOutput(a, u);
    if (!out || !out.rows.length) {
      UI.toast({ kind: 'info', title: 'No exceptions', text: 'Every row in this file passed.' });
      return;
    }
    var name = Store.outputName(a, u, 'Exceptions');
    U.downloadText(name, U.toCSV(out.columns, out.rows));
    UI.toast({ kind: 'success', title: 'Exceptions exported', text: name + ' · ' + U.fmtInt(out.rows.length) + ' finding(s).' });
  }

  /* ============================================================
     UPLOADING
     ============================================================ */
  var Uploads = global.Uploads = {};

  Uploads.pick = function (a) {
    var input = el('input', { type: 'file', accept: ACCEPT.join(','), multiple: true, style: 'display:none' });
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      Uploads.handle(a, input.files);
      document.body.removeChild(input);
    });
    input.click();
  };

  /**
   * Read every chosen file and turn each one into its own upload.
   * Nothing that is already stored is touched.
   */
  Uploads.handle = function (a, fileList) {
    var chosen = Array.prototype.slice.call(fileList || []);
    if (!chosen.length) return;

    var accepted = [];
    chosen.forEach(function (f) {
      var ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
      if (ACCEPT.indexOf(ext) === -1) {
        UI.toast({ kind: 'error', title: 'File skipped', text: f.name + ' — only XLSX, XLS or CSV can be uploaded.' });
        return;
      }
      if (f.size > MAX_BYTES) {
        UI.toast({ kind: 'error', title: 'File skipped', text: f.name + ' — over 25 MB.' });
        return;
      }
      accepted.push(f);
    });
    if (!accepted.length) return;

    var parsed = [], errors = [], done = 0;
    accepted.forEach(function (file, idx) {
      var ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
      if (ext === '.csv') {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var res = U.parseTable(e.target.result);
            if (!res.columns.length || !res.rows.length) errors.push(file.name + ' — no readable rows');
            else parsed.push({ meta: { name: file.name, size: file.size, type: file.type }, columns: res.columns, rows: res.rows });
          } catch (err) { errors.push(file.name + ' — ' + err.message); }
          step();
        };
        reader.onerror = function () { errors.push(file.name + ' — could not be read'); step(); };
        reader.readAsText(file);
      } else {
        // Binary spreadsheet: this prototype ships no XLSX reader, so an
        // equivalent dataset is generated instead and clearly labelled.
        var ds = demoDataset(a, idx);
        parsed.push({
          meta: { name: file.name, size: file.size, type: file.type, simulated: true },
          columns: ds.columns, rows: ds.rows
        });
        step();
      }
    });

    function step() {
      done++;
      if (done < accepted.length) return;
      errors.forEach(function (e) { UI.toast({ kind: 'error', title: 'Could not read a file', text: e }); });
      if (!parsed.length) return;
      Uploads.process(a, parsed);
    }
  };

  /** Show the processing run, then store each file as its own upload. */
  Uploads.process = function (a, parsed) {
    var totalRows = U.sum(parsed.map(function (p) { return p.rows.length; }));
    var runner = UI.progressRunner({
      title: parsed.length === 1
        ? 'Processing ' + parsed[0].meta.name
        : 'Processing ' + parsed.length + ' files'
    });
    var m = UI.modal({ title: 'Generating analytics', size: 'narrow', body: runner.body, autofocus: false });

    UI.simulate({
      total: totalRows || 100, duration: 1300,
      onTick: function (d, t, frac) {
        runner.set(frac, '<p class="muted" style="font-size:12.5px">' +
          (frac < 0.3 ? 'Reading rows and detecting columns…'
            : frac < 0.7 ? 'Classifying calibrators, controls and patient samples…'
              : 'Applying the criteria row by row…') + '</p>');
      },
      onDone: function () {
        var created = parsed.map(function (p) { return Store.addUpload(a, p); });
        m.close();

        created.forEach(function (u) {
          if (u.status === 'failed') return;
          Store.notify({
            kind: u.report && u.report.failed ? 'warn' : 'success',
            title: a.name + ' — ' + u.fileName,
            text: u.statusNote, analyticId: a.id, uploadId: u.id
          });
        });

        var simulated = created.filter(function (u) { return u.simulated; });
        if (simulated.length) {
          UI.toast({
            kind: 'warn', duration: 7000, title: 'Spreadsheet read in prototype mode',
            text: 'Binary XLSX parsing needs a reader library or a server. A representative dataset with the same shape was used instead so the flow still works end to end.'
          });
        }

        if (created.length === 1) {
          var u = created[0];
          UI.toast({
            kind: u.status === 'failed' ? 'error' : 'success',
            title: 'Upload #' + u.no + ' processed',
            text: u.statusNote || u.fileName
          });
          App.go('analytic/' + a.id + '/upload/' + u.id);
        } else {
          UI.toast({
            kind: 'success', title: created.length + ' files uploaded',
            text: 'Each one was processed on its own and has its own analytics.'
          });
          App.render();
        }
      }
    });
  };

  /* ---------------------------------------------------------- helpers */
  function specFor(a) {
    var seedId = a.seed && a.seed.catalogId;
    return Seed.CATALOG.filter(function (c) { return c.id === seedId; })[0] ||
      Seed.CATALOG.filter(function (c) { return c.code === a.code; })[0] || Seed.CATALOG[0];
  }

  function demoDataset(a, i) {
    var spec = specFor(a);
    var n = Store.uploadsOf(a).length + i;
    if (spec.lisa) {
      var fs = spec.lisa.files[n % spec.lisa.files.length];
      return Seed.generateLisaFile(spec.lisa, spec.seedNo + n * 23, fs);
    }
    var parts = spec.gen.parts || [null];
    return Seed.generateDataset(spec.gen, spec.seedNo + n * 17, parts[n % parts.length]);
  }

  /** A file with nothing in it but the right columns, to fill in and upload back. */
  Uploads.downloadTemplate = function (a) {
    var last = Store.latestUpload(a);
    var cols = last && last.columns.length ? last.columns.slice() : TEMPLATE_COLUMNS.slice();
    var rows = TEMPLATE_EXAMPLES.map(function (ex) {
      var o = {};
      cols.forEach(function (c) { o[c] = ''; });
      Object.keys(ex).forEach(function (k) { if (cols.indexOf(k) > -1) o[k] = ex[k]; });
      return o;
    });
    var name = (a.code || a.name).replace(/[^A-Za-z0-9]+/g, '_') + '_Upload_Template.csv';
    U.downloadText(name, U.toCSV(cols, rows));
    UI.toast({
      kind: 'success', title: 'Template downloaded',
      text: name + ' — ' + cols.length + ' columns' +
        (last ? ', matching your last upload.' : ', the columns the criteria look for.')
    });
  };

  var TEMPLATE_COLUMNS = ['Sample ID', 'Sample Type', 'Analyte Name', '%Diff', 'ISTD Area',
    '% Recovery', 'Average % Recovery', 'Conc. (ng/mL)', 'Std. Conc. (ng/mL)',
    'Ref 1 Actual Ratio', 'Ref 1 Set Ratio', 'Found RT'];

  var TEMPLATE_EXAMPLES = [
    { 'Sample ID': 'Cal_1', 'Sample Type': 'Standard', '%Diff': '2.4', 'Std. Conc. (ng/mL)': '1', 'Conc. (ng/mL)': '1.02', 'Ref 1 Actual Ratio': '29.4', 'Found RT': '4.35' },
    { 'Sample ID': 'WCS1', 'Sample Type': 'Control', '%Diff': '-3.1', 'Std. Conc. (ng/mL)': '1.5', 'Conc. (ng/mL)': '1.45', 'Ref 1 Actual Ratio': '30.2', 'Found RT': '4.34' },
    { 'Sample ID': '2606251001', 'Sample Type': 'Unknown', 'ISTD Area': '184320', '% Recovery': '96.2', 'Average % Recovery': '99.4', 'Conc. (ng/mL)': '12.8', 'Ref 1 Actual Ratio': '31.0', 'Found RT': '4.36' }
  ];

  /** Load one generated demo file, so the flow can be tried without a real file. */
  Uploads.loadDemo = function (a) {
    var ds = demoDataset(a, 0);
    var spec = specFor(a);
    var n = Store.uploadsOf(a).length + 1;
    var base = spec.lisa ? spec.lisa.files[0].name : spec.gen.file;
    var name = base.replace(/(\.[^.]+)$/, '_demo' + n + '$1');
    Uploads.process(a, [{
      meta: { name: name, size: ds.rows.length * ds.columns.length * 9, type: 'text/csv' },
      columns: ds.columns, rows: ds.rows
    }]);
  };
}(typeof window !== 'undefined' ? window : this));
