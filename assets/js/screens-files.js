/* ============================================================
   screens-files.js — the Files record for one analytic.

   Every file this analytic has ever seen, current or removed, in one
   place: what it contained, how it processed, and what came out of it.
   Uploading is available here at any point in the workflow, not only at
   the first step.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  var EVENT_META = {
    uploaded: { label: 'Uploaded', icon: 'upload', tone: 'blue' },
    removed: { label: 'Removed', icon: 'trash', tone: 'red' },
    processed: { label: 'Processed', icon: 'bolt', tone: 'green' },
    're-processed': { label: 'Re-processed', icon: 'refresh', tone: 'amber' }
  };

  Screens.files = function (a) {
    var body = el('div', {});
    var ledger = Store.fileLedger(a);
    var current = ledger.filter(function (r) { return r.current; });
    var removed = ledger.filter(function (r) { return !r.current; });

    /* ---------- always-available upload ---------- */
    body.appendChild(Screens.card({
      title: 'Files for ' + a.name,
      badge: '<span class="badge badge-info">' + U.fmtInt(current.length) + ' current</span>' +
        (removed.length ? ' <span class="badge badge-neutral">' + U.fmtInt(removed.length) + ' removed</span>' : ''),
      actions: [
        UI.btn('Download Sample File', 'btn-secondary btn-sm', function () {
          Screens.downloadSampleFile(a);
        }, { icon: 'download', iconSize: 14 }),
        UI.btn('Upload File', 'btn-primary btn-sm', function () {
          Screens.pickFiles(a);
        }, { icon: 'plus', iconSize: 14 })
      ],
      body: uploadZone(a)
    }));

    /* ---------- current files ---------- */
    if (!current.length) {
      body.appendChild(Screens.card({
        body: UI.emptyState({
          icon: 'file', title: 'No files in this analytics record yet',
          desc: 'Upload one or more data files — they all join the same workflow, and you can add more at any time.',
          actions: [UI.btn('Upload File', 'btn-primary', function () { Screens.pickFiles(a); }, { icon: 'plus' })]
        })
      }));
    } else {
      body.appendChild(Screens.card({
        title: 'Current files', flush: true,
        badge: '<span class="badge badge-neutral">' + U.fmtInt(U.sum(current.map(function (r) { return r.recordCount || 0; }))) + ' records</span>',
        body: filesTable(a, current)
      }));
    }

    /* ---------- previously removed, still reviewable ---------- */
    if (removed.length) {
      body.appendChild(Screens.card({
        title: 'Previously uploaded files',
        badge: '<span class="badge badge-neutral">' + U.fmtInt(removed.length) + '</span>',
        flush: true,
        body: filesTable(a, removed)
      }));
    }

    /* ---------- full history ---------- */
    body.appendChild(Screens.card({
      title: 'File history',
      badge: '<span class="badge badge-neutral">' + U.fmtInt(Store.fileHistoryOf(a).length) + ' events</span>',
      flush: true,
      body: historyList(a)
    }));

    return Screens.workflowShell(a, 'files', body);
  };

  /** Drag-and-drop that works from this screen at any workflow stage. */
  function uploadZone(a) {
    var wrap = el('div', {});
    var dz = el('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Upload data files' });
    dz.innerHTML =
      '<div class="dz-ico">' + U.icon('upload', 24) + '</div>' +
      '<p class="dz-t">Drop another file here, any time</p>' +
      '<p class="dz-d">or <span style="color:var(--blue-600);font-weight:650">browse from your computer</span></p>' +
      '<div class="dz-meta"><span>' + U.icon('file', 12) + ' CSV, XLSX or XLS</span><span>·</span>' +
      '<span>Joins the same analytics record</span><span>·</span>' +
      '<span>Existing files and results are kept</span></div>';

    dz.addEventListener('click', function () { Screens.pickFiles(a); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Screens.pickFiles(a); }
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files.length) Screens.handleDroppedFiles(a, e.dataTransfer.files);
    });
    wrap.appendChild(dz);
    return wrap;
  }

  /** One row per file, with everything needed to review it. */
  function filesTable(a, rows) {
    return UI.dataTable({
      rows: rows, unit: 'files', pageSize: 10, hideToolbar: rows.length <= 5,
      searchPlaceholder: 'Search file name…',
      searchText: function (r) { return r.name; },
      rowClass: function (r) { return r.current ? '' : 'row-muted'; },
      columns: [
        {
          key: 'name', label: 'File name',
          render: function (r) {
            return '<span class="cell-strong">' + esc(r.name) + '</span>' +
              (r.current ? '' : ' <span class="badge badge-neutral">removed</span>');
          }
        },
        {
          key: 'uploadedAt', label: 'Uploaded',
          render: function (r) {
            return r.uploadedAt
              ? esc(U.fmtDateTime(r.uploadedAt)) + '<br><span class="muted" style="font-size:11px">' +
                esc(U.relTime(r.uploadedAt)) + '</span>'
              : '<span class="muted">—</span>';
          }
        },
        { key: 'size', label: 'Size', align: 'right', render: function (r) { return r.size ? esc(U.fmtBytes(r.size)) : '<span class="muted">—</span>'; } },
        {
          key: 'recordCount', label: 'Records', align: 'right',
          render: function (r) {
            return U.fmtInt(r.recordCount || 0) +
              (r.blankRowsSkipped ? '<br><span class="muted" style="font-size:11px">' +
                U.fmtInt(r.blankRowsSkipped) + ' blank skipped</span>' : '');
          }
        },
        { key: 'columnCount', label: 'Columns', align: 'right', render: function (r) { return U.fmtInt(r.columnCount || 0); } },
        {
          key: 'processing', label: 'Processing', align: 'center',
          render: function (r) {
            var m = {
              completed: ['badge-success', 'Completed'], stale: ['badge-warn', 'Re-process required'],
              removed: ['badge-neutral', 'Removed'], 'not-processed': ['badge-neutral', 'Not processed']
            }[r.processing] || ['badge-neutral', U.titleCase(r.processing || '')];
            return '<span class="badge ' + m[0] + '">' + esc(m[1]) + '</span>';
          }
        },
        {
          key: 'result', label: 'Passed / Failed', align: 'right', sortable: false,
          render: function (r) {
            if (!r.run) return '<span class="muted">—</span>';
            return '<span style="color:var(--green-700);font-weight:650">' + U.fmtInt(r.passed) + '</span> / ' +
              '<span style="color:' + (r.failed ? 'var(--red-700)' : 'var(--ink-3)') + ';font-weight:650">' +
              U.fmtInt(r.failed) + '</span>';
          }
        },
        {
          key: 'actions', label: '', sortable: false,
          render: function (r) {
            var box = el('div', { class: 'row', style: 'gap:4px;justify-content:flex-end' });
            if (r.current) {
              box.appendChild(UI.iconBtn('eye', 'Preview this file', function () {
                App.go('analytic/' + a.id + '/preview?file=' + encodeURIComponent(r.id));
              }));
              box.appendChild(UI.iconBtn('info', 'File details', function () {
                Screens.fileDetails(a, r.id);
              }));
              box.appendChild(UI.iconBtn('trash', 'Remove from the dataset', function () {
                confirmRemove(a, r);
              }));
            } else {
              box.appendChild(el('span', {
                class: 'muted', style: 'font-size:11.5px',
                text: r.removedAt ? 'Removed ' + U.fmtDate(r.removedAt) : 'No longer in the dataset'
              }));
            }
            return box;
          }
        }
      ]
    });
  }

  function confirmRemove(a, r) {
    UI.confirm({
      title: 'Remove ' + r.name + '?',
      message: 'Its ' + U.fmtInt(r.recordCount || 0) + ' records leave the working dataset and any results built from ' +
        'them are invalidated. The file stays listed under “Previously uploaded files” for review.',
      confirmLabel: 'Remove file', danger: true
    }).then(function (ok) {
      if (!ok) return;
      Store.removeFileById(a, r.id);
      UI.toast({ kind: 'info', title: 'File removed', text: r.name + ' is still available in the file history.' });
      App.render();
    });
  }

  /** Everything that ever happened to a file on this analytic. */
  function historyList(a) {
    var events = Store.fileHistoryOf(a);
    if (!events.length) {
      return UI.emptyState({
        icon: 'audit', title: 'No file activity yet',
        desc: 'Uploads, removals and processing runs are listed here as they happen.'
      });
    }
    var list = el('div', { class: 'list-rows' });
    events.forEach(function (h) {
      var m = EVENT_META[h.event] || { label: U.titleCase(h.event), icon: 'info', tone: '' };
      var row = el('div', { class: 'lr' });
      row.innerHTML =
        '<span class="stat-ico ' + esc(m.tone) + '">' + U.icon(m.icon, 14) + '</span>' +
        '<div class="lr-main"><div class="lr-t">' + esc(m.label) + ' · ' + esc(h.fileName) + '</div>' +
        '<div class="lr-d">' +
        (h.recordCount !== null && h.recordCount !== undefined ? U.fmtInt(h.recordCount) + ' records · ' : '') +
        (h.columnCount ? h.columnCount + ' columns · ' : '') +
        esc(U.fmtDateTime(h.ts)) + ' · ' + esc(h.user) +
        (h.note ? ' · ' + esc(h.note) : '') +
        '</div></div>';
      if (Store.fileIsCurrent(a, h.fileId)) {
        var act = el('div', { class: 'lr-act' });
        act.appendChild(UI.btn('Review', 'btn-secondary btn-sm', function () {
          Screens.fileDetails(a, h.fileId);
        }, { icon: 'eye', iconSize: 13 }));
        row.appendChild(act);
      }
      list.appendChild(row);
    });
    return list;
  }
}(typeof window !== 'undefined' ? window : this));
