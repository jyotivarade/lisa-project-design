/* ============================================================
   screens-workflow.js — upload, file preview, sample classification,
   dynamic rule configuration, rule builder and rule test preview.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  var ACCEPT = ['.csv', '.xlsx', '.xls'];

  /* ============================================================
     STEP 1 — UPLOAD SAMPLE DATA
     ============================================================ */
  /** STEP 2 — hand the user a correctly shaped file to populate. */
  Screens.downloadSampleFile = function (a) {
    var t = Store.sampleTemplate(a);
    var name = Store.sampleTemplateName(a);
    U.downloadText(name, U.toCSV(t.columns, t.rows));
    Store.audit(a, {
      action: 'Sample file downloaded',
      detail: name + ' — ' + t.columns.length + ' columns, ' + t.rows.length + ' example rows', kind: 'info'
    });
    UI.toast({
      kind: 'success', title: 'Sample file downloaded',
      text: name + ' — ' + t.columns.length + ' columns with calibration, control and patient examples.'
    });
  };

  function sampleFileBtn(a, cls) {
    return UI.btn('Download Sample File', cls || 'btn-secondary btn-sm', function () {
      Screens.downloadSampleFile(a);
    }, { icon: 'download', iconSize: 14 });
  }

  Screens.upload = function (a) {
    var body = el('div', {});
    var files = Store.filesOf(a);

    body.appendChild(Screens.card({
      title: 'Upload Data Files',
      badge: '<span class="badge badge-info">Step 1 of ' + Store.STEPS.length + '</span>',
      actions: files.length ? [
        sampleFileBtn(a),
        UI.btn('Add More Files', 'btn-primary btn-sm', function () { pickFiles(a); }, { icon: 'plus', iconSize: 14 })
      ] : [sampleFileBtn(a)],
      body: files.length ? uploadedView(a) : dropView(a)
    }));

    if (!files.length) {
      body.appendChild(el('div', {
        class: 'alert alert-info mt4',
        html: U.icon('info', 17) + '<div><div class="alert-t">Start from the sample file if you like</div>' +
          '<p><strong>Download Sample File</strong> gives you the exact columns this analyte expects, with ' +
          'calibration, control and patient example rows. Populate it and upload it back — or upload your own ' +
          'file, since the columns are read from whatever you provide.</p></div>'
      }));
      body.appendChild(el('div', {
        class: 'alert alert-info mt3',
        html: U.icon('info', 17) + '<div><div class="alert-t">One workflow, as many files as the run needs</div>' +
          '<p>Upload a single file or several — every file joins the <strong>same</strong> validation workflow. ' +
          'Files may contain control, calibration and patient records together, and may cover more than one analytic; ' +
          'both are identified in the next steps. No separate control, calibration or patient upload is ever required.</p></div>'
      }));
    }
    return Screens.workflowShell(a, 'upload', body);
  };

  function dropView(a) {
    var wrap = el('div', {});
    var dz = el('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Upload data files' });
    dz.innerHTML =
      '<div class="dz-ico">' + U.icon('upload', 26) + '</div>' +
      '<p class="dz-t">Drag &amp; drop one or more data files</p>' +
      '<p class="dz-d">or <span style="color:var(--blue-600);font-weight:650">browse from your computer</span></p>' +
      '<div class="dz-meta"><span>' + U.icon('file', 12) + ' CSV, XLSX or XLS</span><span>·</span>' +
      '<span>Multiple files supported</span><span>·</span>' +
      '<span>Controls + calibration + patients together</span><span>·</span><span>Max 25 MB each</span></div>';

    var input = el('input', { type: 'file', accept: ACCEPT.join(','), multiple: true, style: 'display:none' });
    input.addEventListener('change', function () { handleFiles(a, input.files); input.value = ''; });
    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (t) {
      dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(a, e.dataTransfer.files);
    });

    wrap.appendChild(dz);
    wrap.appendChild(input);

    var alt = el('div', { class: 'row mt4', style: 'justify-content:center' });
    alt.appendChild(sampleFileBtn(a, 'btn-primary'));
    alt.appendChild(UI.btn('Use generated demo files', 'btn-secondary', function () { loadDemo(a); }, { icon: 'bolt' }));
    alt.appendChild(el('span', {
      class: 'muted', style: 'font-size:12px',
      text: 'Sample CSV files are also included in the sample-data folder of this prototype.'
    }));
    wrap.appendChild(alt);
    return wrap;
  }

  function uploadedView(a) {
    var files = Store.filesOf(a);
    var d = a.file;
    var g = Store.groups(a);
    var wrap = el('div', {});
    wrap.innerHTML = UI.alertBox('success',
      files.length + ' file' + (files.length === 1 ? '' : 's') + ' uploaded',
      'Fields were detected from the files themselves — ' + d.columnCount + ' distinct columns, ' +
      U.fmtInt(d.recordCount) + ' records in total. All files are processed together in this workflow.');

    /* per-file list */
    var list = el('div', { class: 'list-rows mt4', style: 'border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden' });
    files.forEach(function (f) {
      var extra = (f.columns || []).filter(function (c) { return d.columns.indexOf(c) === -1; });
      var missing = d.columns.filter(function (c) { return (f.columns || []).indexOf(c) === -1; });
      var row = el('div', { class: 'lr' });
      row.innerHTML =
        '<span class="file-ico" style="width:34px;height:34px;border-radius:9px;font-size:9.5px">' +
        esc((f.name.split('.').pop() || 'CSV').toUpperCase()) + '</span>' +
        '<div class="lr-main"><div class="lr-t">' + esc(f.name) +
        (f.simulated ? ' <span class="badge badge-warn">simulated parse</span>' : '') +
        (f.sections && f.sections.length > 1 ? ' <span class="badge badge-violet">' + f.sections.length + ' sections</span>' : '') +
        '</div>' +
        '<div class="lr-d">' + U.fmtInt(f.recordCount) + ' records · ' + f.columnCount + ' columns · ' +
        U.fmtBytes(f.size) + ' · ' + esc(U.fmtDateTime(f.uploadedAt)) +
        (missing.length ? ' · <span style="color:var(--amber-700)">missing ' + missing.length + ' column(s)</span>' : '') +
        '</div></div>' +
        '<span class="badge badge-success">✓ Ready</span>';
      var act = el('div', { class: 'lr-act row', style: 'gap:4px' });
      act.appendChild(UI.iconBtn('eye', 'Preview this file', function () { App.go('analytic/' + a.id + '/preview?file=' + encodeURIComponent(f.id)); }));
      act.appendChild(UI.iconBtn('trash', 'Remove this file', function () { removeOne(a, f); }));
      row.appendChild(act);
      U.$('.lr-main', row).style.cursor = 'pointer';
      U.$('.lr-main', row).addEventListener('click', function () { Screens.fileDetails(a, f.id); });
      list.appendChild(row);
    });
    wrap.appendChild(list);

    var addRow = el('div', { class: 'row mt3' });
    addRow.appendChild(UI.btn('+ Add More Files', 'btn-secondary', function () { pickFiles(a); }, { icon: 'plus' }));
    addRow.appendChild(UI.btn('Add demo file', 'btn-ghost btn-sm', function () { loadDemo(a, true); }, { icon: 'bolt', iconSize: 13 }));
    addRow.appendChild(el('span', { class: 'muted', style: 'font-size:12px', text: 'Files with different columns are merged — every column becomes available for validation.' }));
    wrap.appendChild(addRow);

    var tiles = el('div', { class: 'grid g4 mt4' });
    tiles.innerHTML =
      UI.metric('Files', U.fmtInt(files.length), 'blue') +
      UI.metric('Total records', U.fmtInt(d.recordCount), 'blue') +
      UI.metric('Distinct columns', U.fmtInt(d.columnCount)) +
      UI.metric('In validation scope', a.analyteScope.applied ? U.fmtInt(Store.counts(a).inScope) : 'Pending');

    wrap.appendChild(tiles);
    if (a.classification.applied) {
      var tiles2 = el('div', { class: 'grid g3 mt3' });
      tiles2.innerHTML =
        UI.metric('Control samples', U.fmtInt(g.control.length)) +
        UI.metric('Calibration samples', U.fmtInt(g.calibration.length)) +
        UI.metric('Patient samples', U.fmtInt(g.patient.length));
      wrap.appendChild(tiles2);
    } else {
      wrap.appendChild(el('p', {
        class: 'muted mt3', style: 'font-size:12.5px',
        text: 'Analytics and sample-type counts appear once you complete the next two steps.'
      }));
    }

    var foot = el('div', { class: 'row mt5' });
    foot.appendChild(UI.btn('Preview merged data', 'btn-secondary', function () { App.go('analytic/' + a.id + '/preview'); }, { icon: 'table' }));
    foot.appendChild(UI.btn('Remove all files', 'btn-ghost', function () { removeAll(a); }, { icon: 'trash' }));
    var cont = UI.btn('Continue', 'btn-primary', function () { App.go('analytic/' + a.id + '/analytics'); }, { icon: 'arrowRight' });
    cont.style.marginLeft = 'auto';
    foot.appendChild(cont);
    wrap.appendChild(foot);
    return wrap;
  }

  /** Upload / processing status shown per file. */
  function fileStatusBadge(a, f) {
    var run = Store.runOf(a, f.id);
    if (!run) return '<span class="badge badge-neutral">Uploaded</span>';
    if (run.status === 'stale') return '<span class="badge badge-warn">Re-process required</span>';
    return '<span class="badge badge-success">Processed · ' + U.fmtInt(run.passed) + ' passed' +
      (run.failed ? ' · ' + U.fmtInt(run.failed) + ' failed' : '') + '</span>';
  }

  function pickFiles(a) {
    var input = el('input', { type: 'file', accept: ACCEPT.join(','), multiple: true, style: 'display:none' });
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      handleFiles(a, input.files);
      document.body.removeChild(input);
    });
    input.click();
  }

  function removeOne(a, f) {
    UI.confirm({
      title: 'Remove ' + esc(f.name) + '?',
      message: 'The other uploaded files stay in this workflow. Fields are re-profiled from the remaining data.',
      detail: a.validation.approved || a.validation.controls
        ? 'Changing the dataset creates configuration v' + Store.bumpVersion(a.version) + ' and re-locks patient testing.' : null,
      confirmLabel: 'Remove file', danger: true
    }).then(function (ok) {
      if (!ok) return;
      Store.removeFileById(a, f.id);
      UI.toast({ kind: 'warn', title: 'File removed', text: f.name + ' is no longer part of this workflow.' });
      App.render();
    });
  }

  function removeAll(a) {
    UI.confirm({
      title: 'Remove all uploaded files?',
      message: 'This clears the detected fields, validation rules, QC results and any approval for <strong>' + esc(a.name) + '</strong>.',
      confirmLabel: 'Remove everything', danger: true
    }).then(function (ok) {
      if (!ok) return;
      Store.removeFile(a);
      UI.toast({ kind: 'warn', title: 'Files removed', text: 'The analytic is back to draft state.' });
      App.render();
    });
  }

  /** Read + parse every chosen file, then add them all to this workflow. */
  function handleFiles(a, fileList) {
    var chosen = Array.prototype.slice.call(fileList || []);
    if (!chosen.length) return;

    var accepted = [], rejected = [];
    chosen.forEach(function (f) {
      var ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
      if (ACCEPT.indexOf(ext) === -1) { rejected.push(f.name + ' (unsupported type)'); return; }
      if (f.size > 25 * 1024 * 1024) { rejected.push(f.name + ' (over 25 MB)'); return; }
      accepted.push(f);
    });
    rejected.forEach(function (r) {
      UI.toast({ kind: 'error', title: 'File skipped', text: r });
    });
    if (!accepted.length) return;

    var runner = UI.progressRunner({ title: 'Uploading ' + accepted.length + ' file' + (accepted.length === 1 ? '' : 's') });
    var m = UI.modal({ title: 'Uploading data files', size: 'narrow', body: runner.body, autofocus: false });
    var results = [], errors = [], done = 0;

    accepted.forEach(function (file, idx) {
      var ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
      if (ext === '.csv') {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var res = U.parseTable(e.target.result);
            if (!res.columns.length || !res.rows.length) errors.push(file.name + ' — no readable rows');
            else {
              results.push({
                meta: {
                  name: file.name, size: file.size, type: file.type,
                  simulated: false, sections: res.sections
                },
                columns: res.columns, rows: res.rows
              });
            }
          } catch (err) { errors.push(file.name + ' — ' + err.message); }
          step();
        };
        reader.onerror = function () { errors.push(file.name + ' — could not be read'); step(); };
        reader.readAsText(file);
      } else {
        // Binary spreadsheet: no reader library in this prototype — synthesise an
        // equivalent dataset so the workflow can still be exercised end to end.
        var spec = specFor(a);
        var ds = Seed.generateDataset(spec.gen, spec.seedNo + idx * 31, { patients: Math.round(spec.gen.patients / (idx + 1)) });
        results.push({
          meta: { name: file.name, size: file.size, type: file.type, simulated: true },
          columns: ds.columns, rows: ds.rows
        });
        step();
      }
    });

    function step() {
      done++;
      if (done < accepted.length) return;
      UI.simulate({
        total: 100, duration: 1200,
        onTick: function (d, t, frac) {
          runner.set(frac, '<p class="muted" style="font-size:12.5px">' +
            (frac < 0.5 ? 'Transferring files…' : frac < 0.85 ? 'Parsing rows and detecting columns…' : 'Profiling field data types…') + '</p>');
        },
        onDone: function () {
          m.close();
          errors.forEach(function (e) { UI.toast({ kind: 'error', title: 'Could not read a file', text: e }); });
          if (!results.length) return;
          var added = Store.addFiles(a, results);
          var recs = U.sum(added.map(function (f) { return f.recordCount; }));
          UI.toast({
            kind: 'success',
            title: added.length + ' file' + (added.length === 1 ? '' : 's') + ' added',
            text: U.fmtInt(recs) + ' records joined this workflow — ' + U.fmtInt(a.file.recordCount) + ' in total.'
          });
          var sectioned = added.filter(function (f) { return f.sections && f.sections.length > 1; });
          if (sectioned.length) {
            UI.toast({
              kind: 'info', duration: 6500, title: 'Multi-section file detected',
              text: sectioned[0].name + ' contains ' + sectioned[0].sections.length +
                ' blocks; each block label was promoted to a column so the analytics can be selected next.'
            });
          }
          if (added.some(function (f) { return f.simulated; })) {
            UI.toast({
              kind: 'warn', duration: 7000, title: 'Spreadsheet parsed in prototype mode',
              text: 'Binary XLSX parsing needs a library or server-side reader. A representative dataset with the same workflow shape was generated instead.'
            });
          }
          App.render();
        }
      });
    }
  }

  function specFor(a) {
    var seedId = a.seed && a.seed.catalogId;
    return Seed.CATALOG.filter(function (c) { return c.id === seedId; })[0] ||
      Seed.CATALOG.filter(function (c) { return c.code === a.code; })[0] || Seed.CATALOG[0];
  }

  function loadDemo(a, append) {
    var spec = specFor(a);
    var existing = Store.filesOf(a).length;
    var parts = spec.gen.parts || [null];
    var part = parts[existing % parts.length] || {};
    var ds = Seed.generateDataset(spec.gen, spec.seedNo + existing * 17, part);
    var name = spec.gen.file.replace(/(\.[^.]+)$/, (existing ? '_run' + (existing + 1) : '') + '$1');
    var runner = UI.progressRunner({ title: 'Generating ' + name });
    var m = UI.modal({ title: 'Loading demo data', size: 'narrow', body: runner.body, autofocus: false });
    UI.simulate({
      total: 100, duration: 1000,
      onTick: function (d, t, frac) { runner.set(frac, '<p class="muted" style="font-size:12.5px">Building control, calibration and patient records…</p>'); },
      onDone: function () {
        m.close();
        if (!append) a.files = [];
        Store.addFiles(a, [{
          meta: { name: name, size: ds.rows.length * ds.columns.length * 8, type: 'text/csv', seedPart: part },
          columns: ds.columns, rows: ds.rows
        }]);
        UI.toast({ kind: 'success', title: 'Demo file loaded', text: U.fmtInt(ds.rows.length) + ' records with ' + ds.columns.length + ' columns.' });
        App.render();
      }
    });
  }

  /* ============================================================
     FILE PREVIEW
     ============================================================ */
  Screens.preview = function (a, params) {
    if (!Store.hasData(a)) return needFile(a);
    var files = Store.filesOf(a);
    var focus = params && params.file ? files.filter(function (f) { return f.id === params.file; })[0] : null;
    var recs = focus
      ? Store.recordsOf(a).filter(function (r) { return r.__fid === focus.id; })
      : Store.recordsOf(a);
    var cols = focus ? focus.columns : Store.columnsOf(a);
    var g = Store.groups(a);
    var body = el('div', {});

    if (files.length > 1) {
      var picker = el('div', { class: 'filter-bar' });
      var pills = el('div', { class: 'pills' });
      var allPill = el('button', { class: 'pill' + (focus ? '' : ' on'), type: 'button' });
      allPill.innerHTML = 'All files <span class="c">' + U.fmtInt(a.file.recordCount) + '</span>';
      allPill.addEventListener('click', function () { App.go('analytic/' + a.id + '/preview'); });
      pills.appendChild(allPill);
      files.forEach(function (f) {
        var p = el('button', { class: 'pill' + (focus && focus.id === f.id ? ' on' : ''), type: 'button' });
        p.innerHTML = esc(f.name) + ' <span class="c">' + U.fmtInt(f.recordCount) + '</span>';
        p.addEventListener('click', function () { App.go('analytic/' + a.id + '/preview?file=' + encodeURIComponent(f.id)); });
        pills.appendChild(p);
      });
      picker.appendChild(pills);
      body.appendChild(picker);
    }

    var tiles = el('div', { class: 'grid g4' });
    tiles.innerHTML =
      UI.metric(focus ? 'Records in file' : 'Total records', U.fmtInt(recs.length), 'blue') +
      UI.metric('Control samples', a.classification.applied ? U.fmtInt(g.control.length) : 'Pending') +
      UI.metric('Calibration samples', a.classification.applied ? U.fmtInt(g.calibration.length) : 'Pending') +
      UI.metric('Patient samples', a.classification.applied ? U.fmtInt(g.patient.length) : 'Pending');
    body.appendChild(tiles);

    /* detected fields */
    var fieldsTable = el('div', { class: 'table-scroll' });
    fieldsTable.innerHTML = '<table class="tbl compact"><thead><tr><th>#</th><th>Detected field</th><th>Inferred type</th>' +
      '<th class="num">Distinct</th><th class="num">Blank</th><th>Range / sample values</th></tr></thead><tbody>' +
      a.fields.map(function (f, i) {
        var range = f.type === 'number' && f.min !== null
          ? U.fmtNum(f.min) + ' – ' + U.fmtNum(f.max)
          : f.distinct.slice(0, 4).map(esc).join(', ') + (f.distinctCount > 4 ? ' …' : '');
        return '<tr><td class="muted">' + (i + 1) + '</td><td class="cell-strong">' + esc(f.name) + '</td>' +
          '<td>' + UI.typeBadge(f.type) + '</td><td class="num">' + U.fmtInt(f.distinctCount) + (f.distinctCount >= 60 ? '+' : '') + '</td>' +
          '<td class="num">' + U.fmtInt(f.blanks) + '</td><td class="mono" style="font-size:12px">' + range + '</td></tr>';
      }).join('') + '</tbody></table>';
    body.appendChild(Screens.card({
      title: 'Detected fields',
      badge: '<span class="badge badge-neutral">' + a.fields.length + ' columns</span>',
      flush: true, body: fieldsTable
    }));

    /* raw data table — source file first when several files are merged */
    var columns = [];
    if (files.length > 1 && !focus) {
      columns.push({
        key: '__src', label: 'Source File',
        render: function (row) { return '<span class="cell-sub">' + esc(row.__src) + '</span>'; },
        value: function (row) { return row.__src; }
      });
    }
    cols.forEach(function (c) {
      var f = a.fields.filter(function (x) { return x.name === c; })[0];
      columns.push({
        key: c, label: c, align: f && f.type === 'number' ? 'right' : '',
        render: function (row) {
          var v = row[c];
          return U.isEmptyCell(v) ? '<span class="muted">—</span>' : esc(U.displayValue(v));
        },
        value: function (row) { return row[c]; }
      });
    });
    var hidden = {};
    var tableCard = el('div', {});
    var colBtn = UI.btn('Columns', 'btn-secondary btn-sm', function () {
      var box = el('div', {});
      box.innerHTML = '<p style="font-size:13px;color:var(--ink-2)">Choose the columns to display. Hidden columns stay in the data ' +
        'and remain available to rules and criteria.</p>';
      var grid = el('div', { class: 'grid mt4', style: 'grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px' });
      columns.forEach(function (col) {
        grid.appendChild(UI.checkbox(col.label, !hidden[col.key], function (v) { hidden[col.key] = !v; }));
      });
      box.appendChild(grid);
      var m = UI.modal({
        title: 'Column visibility', size: 'wide', body: box,
        footer: [
          UI.btn('Show all', 'btn-secondary', function () { hidden = {}; m.close(); paintTable(); }),
          UI.btn('Apply', 'btn-primary', function () { m.close(); paintTable(); }, { icon: 'check' })
        ]
      });
    }, { icon: 'table', iconSize: 14 });

    function paintTable() {
      tableCard.innerHTML = '';
      tableCard.appendChild(buildTable());
    }
    function buildTable() {
      return UI.dataTable({
      title: focus ? 'Rows from ' + focus.name : 'Merged sample data',
      columns: columns.filter(function (c2) { return !hidden[c2.key]; }), rows: recs, pageSize: 25,
      toolbar: [colBtn],
      searchPlaceholder: 'Search any column…',
      searchText: function (r) { return cols.map(function (c) { return r[c]; }).join(' ') + ' ' + r.__src; },
      exportName: (a.code || 'analytic') + '_preview', unit: 'rows', compact: true
      });
    }
    paintTable();
    body.appendChild(Screens.card({ flush: true, body: tableCard }));

    var foot = el('div', { class: 'row mt4' });
    foot.appendChild(UI.btn('Back to upload', 'btn-secondary', function () { App.go('analytic/' + a.id + '/upload'); }, { icon: 'arrowLeft' }));
    var next = UI.btn('Continue', 'btn-primary', function () { App.go('analytic/' + a.id + '/analytics'); }, { icon: 'arrowRight' });
    next.style.marginLeft = 'auto';
    foot.appendChild(next);
    body.appendChild(foot);

    return Screens.workflowShell(a, 'analytics', body);
  };

  function needFile(a) {
    var e = UI.emptyState({
      icon: 'upload', title: 'No data files yet',
      desc: 'Upload one or more files containing control, calibration and patient records to continue this workflow.',
      actions: [UI.btn('Upload Data Files', 'btn-primary', function () { App.go('analytic/' + a.id + '/upload'); }, { icon: 'upload' })]
    });
    return Screens.workflowShell(a, 'upload', Screens.card({ body: e }));
  }
  Screens.needFile = needFile;

  /* ============================================================
     STEP 2 — ANALYTICS DETECTED IN THE UPLOADED FILES
     ============================================================ */
  Screens.analyticsStep = function (a) {
    if (!Store.hasData(a)) return needFile(a);
    var body = el('div', {});
    var det = Store.detectAnalytes(a);
    var tree = Store.analyticsByFile(a);
    var scope = a.analyteScope;

    var draft = {
      field: scope.field || (det ? det.field : ''),
      values: (scope.values && scope.values.length ? scope.values.slice() : null)
    };
    if (!draft.values) {
      // pre-select whatever looks like this analytic
      var hay = (a.name + ' ' + a.code).toLowerCase();
      var opts = det ? det.options : [];
      var hits = opts.filter(function (o) {
        var t = o.value.toLowerCase();
        return hay.indexOf(t) > -1 || (t.length > 3 && hay.split(/\s+/).some(function (w) { return w && t.indexOf(w) > -1; }));
      });
      draft.values = (hits.length ? hits : opts).map(function (o) { return o.value; });
    }

    /* file → analytics tree */
    var treeBox = el('div', {});
    tree.forEach(function (t) {
      var box = el('div', { class: 'rule-field-card' });
      box.innerHTML =
        '<div class="rfc-head"><span class="rfc-name">' + U.icon('file', 14) + ' ' + esc(t.file.name) + '</span>' +
        '<span class="badge badge-neutral">' + U.fmtInt(t.file.recordCount) + ' records</span>' +
        '<div class="grow"><span class="muted" style="font-size:12px">' +
        (t.field ? 'grouped by [' + esc(t.field) + ']' : 'no analytics column detected') + '</span></div></div>' +
        '<div class="rule-list">' + t.analytics.map(function (x, i) {
          var selected = draft.values.indexOf(x.value) > -1;
          return '<div class="rule-row"><span class="rule-grip">' +
            (i === t.analytics.length - 1 ? '└' : '├') + '</span>' +
            '<div class="rule-main"><div class="rule-t">' + esc(x.value) +
            (selected ? ' <span class="badge badge-success">selected</span>' : '') + '</div>' +
            '<div class="rule-d">' + U.fmtInt(x.count) + ' records</div></div></div>';
        }).join('') + '</div>';
      treeBox.appendChild(box);
    });

    body.appendChild(Screens.card({
      title: 'Analytics found in the uploaded files',
      badge: '<span class="badge badge-info">Step 2 of ' + Store.STEPS.length + '</span>',
      body: [
        el('p', {
          style: 'font-size:13px;color:var(--ink-2);line-height:1.6',
          text: 'A file may hold records for several analytics. Choose the column that identifies the analytic and ' +
            'select which analytics this workflow validates — rules configured here never touch the records of another analytic.'
        }),
        el('div', { class: 'mt4' }, treeBox)
      ]
    }));

    /* selection form */
    var form = el('div', {});
    var fieldSel = UI.fieldGroup({
      label: 'Analytics Field', type: 'select', value: draft.field,
      options: [{ value: '', label: '— no analytics column (validate every record) —' }].concat(
        a.fields.map(function (f) {
          return { value: f.name, label: f.name + '  (' + f.type + ', ' + f.distinctCount + ' distinct)' };
        })),
      hint: det ? 'Detected from the data: [' + det.field + ']' : 'No analytics column was detected — you can still pick one.',
      onChange: function () { draft.field = fieldSel.input.value; draft.values = []; rebuild(); }
    });
    var valuesWrap = el('div', { class: 'mt4' });

    function optionsFor(field) {
      if (!field) return [];
      var recs = Store.recordsOf(a);
      var tally = {};
      recs.forEach(function (r) {
        var v = r[field];
        if (U.isBlank(v)) return;
        var k = String(v).trim();
        tally[k] = (tally[k] || 0) + 1;
      });
      return Object.keys(tally).sort().map(function (k) { return { value: k, count: tally[k] }; });
    }

    function rebuild() {
      valuesWrap.innerHTML = '';
      if (!draft.field) {
        valuesWrap.appendChild(el('div', {
          class: 'alert alert-warn',
          html: U.icon('warning', 16) + '<div><div class="alert-t">Every record will be validated together</div>' +
            '<p>Without an analytics column the rules apply to all uploaded records. Pick a column above if the files mix analytics.</p></div>'
        }));
        return;
      }
      var opts = optionsFor(draft.field);
      valuesWrap.appendChild(el('p', { class: 'eyebrow mb3', text: 'Analytics to validate (' + opts.length + ' found)' }));
      var grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px' });
      opts.forEach(function (o) {
        var card = el('label', { class: 'rc' + (draft.values.indexOf(o.value) > -1 ? ' on' : '') });
        var cb = el('input', { type: 'checkbox', checked: draft.values.indexOf(o.value) > -1 });
        cb.addEventListener('change', function () {
          draft.values = draft.values.filter(function (v) { return v !== o.value; });
          if (cb.checked) draft.values.push(o.value);
          card.classList.toggle('on', cb.checked);
          updateSummary();
        });
        card.appendChild(cb);
        card.appendChild(el('div', {}, [
          el('div', { class: 'rc-t', text: o.value }),
          el('div', { class: 'rc-d', text: U.fmtInt(o.count) + ' records across ' + filesWith(draft.field, o.value) + ' file(s)' })
        ]));
        grid.appendChild(card);
      });
      valuesWrap.appendChild(grid);
      var bulk = el('div', { class: 'row mt3' });
      bulk.appendChild(UI.btn('Select All', 'btn-secondary btn-sm', function () {
        draft.values = opts.map(function (o) { return o.value; }); rebuild();
      }));
      bulk.appendChild(UI.btn('Clear All', 'btn-secondary btn-sm', function () { draft.values = []; rebuild(); }));
      valuesWrap.appendChild(bulk);
      valuesWrap.appendChild(summary);
      updateSummary();
    }

    function filesWith(field, value) {
      var n = 0;
      Store.filesOf(a).forEach(function (f) {
        if ((f.records || []).some(function (r) { return String(r[field]).trim() === value; })) n++;
      });
      return n;
    }

    var summary = el('div', { class: 'mt4' });
    function updateSummary() {
      var recs = Store.recordsOf(a);
      var inScope = !draft.field || !draft.values.length ? recs.length : recs.filter(function (r) {
        return draft.values.some(function (v) { return String(r[draft.field]).trim() === v; });
      }).length;
      summary.innerHTML = '<div class="grid g3">' +
        UI.metric('Analytics selected', U.fmtInt(draft.values.length), 'blue') +
        UI.metric('Records in scope', U.fmtInt(inScope), 'blue') +
        UI.metric('Records excluded', U.fmtInt(recs.length - inScope)) +
        '</div>';
    }

    form.appendChild(fieldSel);
    form.appendChild(valuesWrap);
    rebuild();

    var applyBtn = UI.btn(scope.applied ? 'Update Analytics Scope' : 'Confirm Analytics', 'btn-primary', function () {
      if (draft.field && !draft.values.length) {
        UI.toast({ kind: 'error', title: 'Nothing selected', text: 'Select at least one analytic, or clear the analytics field.' });
        return;
      }
      var willInvalidate = scope.applied && (a.validation.approved || a.validation.controls) &&
        (draft.field !== scope.field || draft.values.join('|') !== (scope.values || []).join('|'));
      var proceed = willInvalidate ? UI.confirm({
        title: 'Change the analytics scope?',
        message: 'This creates configuration <strong>v' + esc(Store.bumpVersion(a.version)) +
          '</strong>, invalidates the approval and re-locks patient testing.',
        confirmLabel: 'Change scope', danger: true
      }) : Promise.resolve(true);
      proceed.then(function (ok) {
        if (!ok) return;
        Store.applyAnalyteScope(a, draft);
        UI.toast({
          kind: 'success', title: 'Analytics scope applied',
          text: draft.field ? draft.values.join(', ') + ' — other analytics are excluded from this workflow.'
            : 'All uploaded records are in scope.'
        });
        App.go('analytic/' + a.id + '/mapping');
      });
    }, { icon: 'check' });

    body.appendChild(Screens.card({
      title: 'Select analytics to validate',
      body: form,
      foot: [
        el('span', { class: 'muted', style: 'font-size:12.5px', text: 'Values are read from the uploaded files — nothing is hardcoded.' }),
        el('div', { class: 'grow' }, [
          UI.btn('Back', 'btn-secondary', function () { App.go('analytic/' + a.id + '/upload'); }, { icon: 'arrowLeft' }),
          applyBtn
        ])
      ]
    }));

    return Screens.workflowShell(a, 'analytics', body);
  };

  /* ============================================================
     STEP 4 — SELECT FIELDS FOR VALIDATION
     ============================================================ */
  Screens.fields = function (a) {
    if (!Store.hasData(a)) return needFile(a);
    if (!a.classification.applied) return needStep(a, 'mapping', 'Classify the sample types first',
      'Field selection follows sample classification so each field can be profiled per sample type.');

    var body = el('div', {});
    var confirmed = Store.fieldsConfirmed(a);
    var sel = {};
    Store.selectedFields(a).forEach(function (f) { sel[f] = true; });
    if (!confirmed && a.analyteScope.field) sel[a.analyteScope.field] = false;

    var g = Store.groups(a);
    var scoped = Store.scopedRecords(a);
    var ruleCounts = {};
    (a.rules || []).forEach(function (r) { ruleCounts[r.field] = (ruleCounts[r.field] || 0) + 1; });

    var countLbl = el('span', { class: 'badge badge-info' });
    var rows = el('div', { class: 'list-rows' });

    function fill(fieldName, list) {
      if (!list.length) return null;
      var n = list.filter(function (r) { return !U.isBlank(r[fieldName]); }).length;
      return Math.round(n / list.length * 100);
    }

    a.fields.forEach(function (f) {
      var row = el('div', { class: 'lr' });
      var cover = [
        ['Control', fill(f.name, g.control)],
        ['Calibration', fill(f.name, g.calibration)],
        ['Patient', fill(f.name, g.patient)]
      ].filter(function (x) { return x[1] !== null; });
      var main = el('div', { class: 'lr-main' });
      main.innerHTML =
        '<div class="lr-t">' + esc(f.name) + ' ' + UI.typeBadge(f.type) +
        (f.name === a.analyteScope.field ? ' <span class="badge badge-violet">analytics column</span>' : '') +
        (f.name === a.classification.field ? ' <span class="badge badge-teal">sample-type column</span>' : '') +
        (ruleCounts[f.name] ? ' <span class="badge badge-neutral">' + ruleCounts[f.name] + ' rule(s)</span>' : '') +
        '</div>' +
        '<div class="lr-d">' + U.fmtInt(f.distinctCount) + (f.distinctCount >= 60 ? '+' : '') + ' distinct · ' +
        U.fmtInt(f.blanks) + ' blank of ' + U.fmtInt(scoped.length) + ' · populated: ' +
        cover.map(function (c) { return c[0] + ' ' + c[1] + '%'; }).join(' · ') +
        (f.type === 'number' && f.min !== null ? ' · range ' + U.fmtNum(f.min) + '–' + U.fmtNum(f.max) : '') +
        '</div>';
      row.appendChild(main);
      var act = el('div', { class: 'lr-act' });
      var sw = UI.switchToggle('', !!sel[f.name], function (v) {
        sel[f.name] = v;
        updateCount();
      });
      act.appendChild(sw);
      row.appendChild(act);
      rows.appendChild(row);
    });

    function chosen() {
      return a.fields.map(function (f) { return f.name; }).filter(function (n) { return !!sel[n]; });
    }
    function updateCount() {
      var c = chosen();
      countLbl.textContent = c.length + ' of ' + a.fields.length + ' fields selected';
      var orphan = (a.rules || []).filter(function (r) { return c.indexOf(r.field) === -1; }).length;
      warn.hidden = !orphan;
      if (orphan) {
        warn.innerHTML = U.icon('warning', 16) + '<div><div class="alert-t">' + orphan +
          ' existing rule(s) sit on unselected fields</div><p>They stay saved but are skipped during validation until their field is selected again.</p></div>';
      }
    }
    var warn = el('div', { class: 'alert alert-warn mt4', hidden: true });

    var card = Screens.card({
      title: 'Select Fields for Validation',
      badge: '<span class="badge badge-info">Step 4 of ' + Store.STEPS.length + '</span>',
      actions: [
        countLbl,
        UI.btn('Select All', 'btn-secondary btn-sm', function () {
          a.fields.forEach(function (f) { sel[f.name] = true; });
          U.$$('.lr .switch input', rows).forEach(function (i) { i.checked = true; });
          updateCount();
        }),
        UI.btn('Clear All', 'btn-secondary btn-sm', function () {
          a.fields.forEach(function (f) { sel[f.name] = false; });
          U.$$('.lr .switch input', rows).forEach(function (i) { i.checked = false; });
          updateCount();
        })
      ],
      flush: true, body: rows
    });
    body.appendChild(card);
    body.appendChild(warn);
    updateCount();

    var foot = el('div', { class: 'row mt4' });
    foot.appendChild(UI.btn('Back', 'btn-secondary', function () { App.go('analytic/' + a.id + '/mapping'); }, { icon: 'arrowLeft' }));
    var save = UI.btn(confirmed ? 'Update Field Selection' : 'Confirm Fields', 'btn-primary', function () {
      var c = chosen();
      if (!c.length) {
        UI.toast({ kind: 'error', title: 'No fields selected', text: 'Select at least one field to validate.' });
        return;
      }
      var willInvalidate = confirmed && (a.validation.approved || a.validation.controls);
      var proceed = willInvalidate ? UI.confirm({
        title: 'Change validated fields?',
        message: 'This creates configuration <strong>v' + esc(Store.bumpVersion(a.version)) +
          '</strong>, invalidates the approval and re-locks patient testing.',
        confirmLabel: 'Change fields', danger: true
      }) : Promise.resolve(true);
      proceed.then(function (ok) {
        if (!ok) return;
        Store.setSelectedFields(a, c);
        UI.toast({ kind: 'success', title: 'Fields confirmed', text: c.length + ' field(s) will be validated.' });
        App.go('analytic/' + a.id + '/rules');
      });
    }, { icon: 'check' });
    save.style.marginLeft = 'auto';
    foot.appendChild(save);
    body.appendChild(foot);

    return Screens.workflowShell(a, 'fields', body);
  };

  function needStep(a, step, title, desc) {
    var e = UI.emptyState({
      icon: 'target', title: title, desc: desc,
      actions: [UI.btn('Go to that step', 'btn-primary', function () { App.go('analytic/' + a.id + '/' + step); }, { icon: 'arrowRight' })]
    });
    return Screens.workflowShell(a, step, Screens.card({ body: e }));
  }

  /* ============================================================
     STEP 2 — SAMPLE CLASSIFICATION (FILE MAPPING)
     ============================================================ */
  Screens.mapping = function (a) {
    if (!Store.hasData(a)) return needFile(a);
    if (!a.analyteScope.applied) {
      return needStep(a, 'analytics', 'Select the analytics first',
        'Sample types are classified within the analytics you chose to validate, so that selection comes first.');
    }
    var recs = Store.scopedRecords(a);
    var body = el('div', {});
    var c = a.classification;
    var suggested = c.suggested || Seed.suggestClassification(a.fields, recs);

    var draft = {
      field: c.field || (suggested ? suggested.field : (a.fields[0] ? a.fields[0].name : '')),
      control: c.control || (suggested ? suggested.control : ''),
      calibration: c.calibration || (suggested ? suggested.calibration : ''),
      patient: c.patient || (suggested ? suggested.patient : '')
    };

    /* mode switch: value mapping (generic) or LISA Sample ID + Sample Type patterns */
    var modeBar = el('div', { class: 'row mb4' });
    modeBar.appendChild(el('span', { class: 'muted', style: 'font-size:12.5px', text: 'Classification method' }));
    modeBar.appendChild(UI.segmented([
      { value: 'values', label: 'Value mapping' },
      { value: 'patterns', label: 'LISA patterns' }
    ], c.mode === 'patterns' ? 'patterns' : 'values', function (v) {
      if (v === 'patterns') Screens.patternClassification(a);
      else App.go('analytic/' + a.id + '/mapping?mode=values');
    }));
    body.appendChild(modeBar);

    if (c.mode === 'patterns' && c.patterns) {
      body.appendChild(Screens.patternSummaryCard(a));
      return Screens.workflowShell(a, 'mapping', body);
    }

    var form = el('div', {});
    var fieldSel = UI.fieldGroup({
      label: 'Sample Type Field', required: true, type: 'select', value: draft.field,
      options: a.fields.map(function (f) { return { value: f.name, label: f.name + '  (' + f.type + ', ' + f.distinctCount + ' distinct)' }; }),
      hint: 'Any column from the uploaded file can act as the sample-type discriminator.',
      onChange: function () { draft.field = fieldSel.input.value; rebuildValues(); }
    });

    var valuesWrap = el('div', { class: 'form-grid three mt4' });
    var previewWrap = el('div', { class: 'mt4' });

    function distinctFor(field) {
      var f = a.fields.filter(function (x) { return x.name === field; })[0];
      return f ? f.distinct : [];
    }

    var controlSel, calSel, patSel;
    function rebuildValues() {
      var opts = distinctFor(draft.field).map(function (v) {
        var n = recs.filter(function (r) { return String(r[draft.field]) === v; }).length;
        return { value: v, label: v + '  (' + U.fmtInt(n) + ' rows)' };
      });
      var blank = [{ value: '', label: '— not present in this file —' }];
      valuesWrap.innerHTML = '';
      controlSel = UI.fieldGroup({ label: 'Control Value', type: 'select', value: draft.control, options: blank.concat(opts), onChange: function () { draft.control = controlSel.input.value; refreshPreview(); } });
      calSel = UI.fieldGroup({ label: 'Calibration Value', type: 'select', value: draft.calibration, options: blank.concat(opts), onChange: function () { draft.calibration = calSel.input.value; refreshPreview(); } });
      patSel = UI.fieldGroup({ label: 'Patient Value', type: 'select', value: draft.patient, options: blank.concat(opts), onChange: function () { draft.patient = patSel.input.value; refreshPreview(); } });
      valuesWrap.appendChild(controlSel); valuesWrap.appendChild(calSel); valuesWrap.appendChild(patSel);
      refreshPreview();
    }

    function tally() {
      var out = { control: 0, calibration: 0, patient: 0, unmatched: 0 };
      recs.forEach(function (r) {
        var v = String(r[draft.field] === undefined ? '' : r[draft.field]).trim().toLowerCase();
        if (draft.control && v === draft.control.toLowerCase()) out.control++;
        else if (draft.calibration && v === draft.calibration.toLowerCase()) out.calibration++;
        else if (draft.patient && v === draft.patient.toLowerCase()) out.patient++;
        else out.unmatched++;
      });
      return out;
    }

    function refreshPreview() {
      var t = tally();
      previewWrap.innerHTML =
        '<div class="flow"><div class="flow-node">' +
        (a.analyteScope.field ? esc(a.analyteScope.values.join(', ')).toUpperCase() + ' RECORDS' : 'UPLOADED RECORDS') +
        '<span class="fs">' + U.fmtInt(recs.length) + ' in scope' +
        (Store.filesOf(a).length > 1 ? ' · ' + Store.filesOf(a).length + ' files' : '') + '</span></div>' +
        '<div class="flow-arrow">' + U.icon('chevronDown', 18) + '</div>' +
        '<div class="flow-split">' +
        '<div class="flow-node c">CONTROL<span class="fs">' + U.fmtInt(t.control) + ' samples</span></div>' +
        '<div class="flow-node k">CALIBRATION<span class="fs">' + U.fmtInt(t.calibration) + ' samples</span></div>' +
        '<div class="flow-node p">PATIENT<span class="fs">' + U.fmtInt(t.patient) + ' samples</span></div>' +
        '</div></div>' +
        (t.unmatched ? '<div class="alert alert-warn mt3">' + U.icon('warning', 16) +
          '<div><div class="alert-t">' + U.fmtInt(t.unmatched) + ' records are not mapped</div>' +
          '<p>They will be excluded from control, calibration and patient validation. Map the remaining values or leave them out deliberately.</p></div></div>' : '');
    }

    form.appendChild(fieldSel);
    form.appendChild(valuesWrap);
    form.appendChild(previewWrap);
    rebuildValues();

    var applyBtn = UI.btn(c.applied ? 'Update Classification' : 'Apply Classification', 'btn-primary', function () {
      if (!draft.control && !draft.calibration && !draft.patient) {
        UI.toast({ kind: 'error', title: 'Nothing mapped', text: 'Map at least one sample type value before applying.' });
        return;
      }
      var t = tally();
      var willInvalidate = c.applied && (draft.field !== c.field || draft.control !== c.control ||
        draft.calibration !== c.calibration || draft.patient !== c.patient) &&
        (a.validation.approved || a.validation.controls);
      var proceed = willInvalidate
        ? UI.confirm({
          title: 'Re-classify samples?',
          message: 'Changing the sample classification creates configuration <strong>v' + esc(Store.bumpVersion(a.version)) +
            '</strong>, invalidates the current approval and re-locks patient testing.',
          confirmLabel: 'Re-classify', danger: true
        })
        : Promise.resolve(true);
      proceed.then(function (ok) {
        if (!ok) return;
        Store.applyClassification(a, draft);
        UI.toast({
          kind: 'success', title: 'Classification applied',
          text: U.fmtInt(t.control) + ' control · ' + U.fmtInt(t.calibration) + ' calibration · ' + U.fmtInt(t.patient) + ' patient samples.'
        });
        App.go('analytic/' + a.id + '/fields');
      });
    }, { icon: 'check' });

    body.appendChild(Screens.card({
      title: 'Sample Classification',
      badge: '<span class="badge badge-info">Step 3 of ' + Store.STEPS.length + '</span>',
      actions: suggested ? [UI.btn('Reset to detected mapping', 'btn-ghost btn-sm', function () {
        draft.field = suggested.field; draft.control = suggested.control;
        draft.calibration = suggested.calibration; draft.patient = suggested.patient;
        fieldSel.input.value = draft.field; rebuildValues();
        UI.toast({ kind: 'info', title: 'Detected mapping restored' });
      }, { icon: 'refresh', iconSize: 14 })] : null,
      body: form,
      foot: [
        el('span', { class: 'muted', style: 'font-size:12.5px', text: 'Values are read from the file — nothing is hardcoded.' }),
        el('div', { class: 'grow' }, [
          UI.btn('View file preview', 'btn-secondary', function () { App.go('analytic/' + a.id + '/preview'); }, { icon: 'table' }),
          applyBtn
        ])
      ]
    }));

    if (c.applied) {
      var counts = Store.counts(a);
      body.appendChild(el('div', {
        class: 'alert alert-success mt4',
        html: U.icon('check', 17) + '<div><div class="alert-t">Classification active on [' + esc(c.field) + ']</div>' +
          '<p>✓ ' + U.fmtInt(counts.control) + ' Control Samples &nbsp;·&nbsp; ✓ ' + U.fmtInt(counts.calibration) +
          ' Calibration Samples &nbsp;·&nbsp; ✓ ' + U.fmtInt(counts.patient) + ' Patient Samples</p></div>' +
          '<div class="grow"></div>'
      }));
      var g2 = U.$('.grow', body.lastChild);
      g2.appendChild(UI.btn('Continue to fields', 'btn-primary btn-sm', function () { App.go('analytic/' + a.id + '/fields'); }, { icon: 'arrowRight', iconSize: 14 }));
    }

    return Screens.workflowShell(a, 'mapping', body);
  };

  /* ============================================================
     STEP 3 — DYNAMIC RULE CONFIGURATION
     ============================================================ */
  Screens.rules = function (a) {
    if (!Store.hasData(a)) return needFile(a);
    if (!a.classification.applied) {
      return needStep(a, 'mapping', 'Classify the samples first',
        'Rules are scoped to control, calibration and patient samples, so the sample types must be mapped before rules can be configured.');
    }
    if (!Store.fieldsConfirmed(a)) {
      return needStep(a, 'fields', 'Select the fields to validate',
        'Rules are built per field, so confirm which of the detected fields take part in validation first.');
    }

    var body = el('div', {});
    var selected = Store.selectedFields(a);
    var selectedSet = {};
    selected.forEach(function (f) { selectedSet[f] = true; });
    var byField = {};
    a.rules.forEach(function (r) { (byField[r.field] = byField[r.field] || []).push(r); });

    /* --- summary banner --- */
    var active = Store.activeRules(a).length;
    var head = el('div', { class: 'grid g4' });
    head.innerHTML =
      UI.metric('Selected fields', U.fmtInt(selected.length) + ' / ' + a.fields.length, 'blue') +
      UI.metric('Fields with rules', U.fmtInt(Object.keys(byField).filter(function (f) { return selectedSet[f]; }).length)) +
      UI.metric('Active rules', U.fmtInt(active) + (a.rules.length - active ? ' / ' + a.rules.length : ''), 'green') +
      UI.metric('Configuration', 'v' + esc(a.version), a.validation.approved ? 'green' : 'amber');
    body.appendChild(head);

    if (!a.rules.length) {
      body.appendChild(Screens.card({
        title: 'Configure Validation Rules',
        badge: '<span class="badge badge-info">Step 5 of ' + Store.STEPS.length + '</span>',
        body: UI.emptyState({
          icon: 'rules', title: 'No rules configured yet',
          desc: 'Build rules for any of the ' + selected.length + ' selected fields, or start from a profile-derived set generated by inspecting the uploaded data itself.',
          actions: [
            UI.btn('Add Rule', 'btn-primary', function () { Screens.ruleBuilder(a, null); }, { icon: 'plus' }),
            UI.btn('Suggest rules from data profile', 'btn-secondary', function () { suggestRules(a); }, { icon: 'bolt' })
          ]
        })
      }));
      return Screens.workflowShell(a, 'rules', body);
    }

    /* --- fields summary table (§11) --- */
    var summary = el('div', { class: 'table-scroll' });
    summary.innerHTML = '<table class="tbl"><thead><tr><th>Field</th><th>Type</th><th class="num">Rules</th>' +
      '<th>Group logic</th><th>Scopes covered</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead><tbody>' +
      a.fields.filter(function (f) { return selectedSet[f.name]; }).map(function (f) {
        var rs = byField[f.name] || [];
        var on = rs.filter(function (r) { return r.enabled; }).length;
        var scopes = {};
        rs.forEach(function (r) { (r.scope || []).forEach(function (s) { scopes[s] = 1; }); });
        var status = !rs.length ? '<span class="badge badge-neutral">No rules</span>'
          : on === 0 ? '<span class="badge badge-warn">All disabled</span>'
            : '<span class="badge badge-success">✓ ' + on + ' active</span>';
        return '<tr data-field="' + esc(f.name) + '"><td class="cell-strong">' + esc(f.name) + '</td>' +
          '<td>' + UI.typeBadge(f.type) + '</td><td class="num">' + rs.length + '</td>' +
          '<td>' + (rs.length ? '<span class="badge badge-neutral">' + ((a.fieldLogic || {})[f.name] === 'ANY' ? 'ANY' : 'ALL') + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (Object.keys(scopes).length ? UI.scopeBadges(Object.keys(scopes)) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + status + '</td>' +
          '<td><div class="tbl-actions"><button class="btn btn-secondary btn-xs" data-edit-field="' + esc(f.name) + '">' +
          (rs.length ? 'Edit' : 'Add rule') + '</button></div></td></tr>';
      }).join('') + '</tbody></table>';
    U.on(summary, 'click', '[data-edit-field]', function () {
      var field = this.dataset.editField;
      var rs = byField[field] || [];
      if (!rs.length) { Screens.ruleBuilder(a, null, { field: field }); return; }
      var card = U.$('[data-field-card="' + cssEscape(field) + '"]', body);
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(card); }
    });

    body.appendChild(Screens.card({
      title: 'Configure Validation Rules',
      badge: '<span class="badge badge-info">Step 5 of ' + Store.STEPS.length + '</span>',
      actions: [
        UI.btn('Suggest from data', 'btn-secondary btn-sm', function () { suggestRules(a); }, { icon: 'bolt', iconSize: 14 }),
        UI.btn('Test Rules', 'btn-secondary btn-sm', function () { Screens.ruleTest(a); }, { icon: 'play', iconSize: 14 }),
        UI.btn('Add Rule', 'btn-primary btn-sm', function () { Screens.ruleBuilder(a, null); }, { icon: 'plus', iconSize: 14 })
      ],
      flush: true, body: summary
    }));

    /* --- per-field rule cards --- */
    var fieldsWithRules = a.fields.filter(function (f) { return byField[f.name] && selectedSet[f.name]; });
    // surface rules whose field is no longer selected, or no longer present in the data
    Object.keys(byField).forEach(function (name) {
      if (fieldsWithRules.some(function (f) { return f.name === name; })) return;
      var known = a.fields.filter(function (f) { return f.name === name; })[0];
      fieldsWithRules.push({
        name: name, type: known ? known.type : byField[name][0].dataType,
        orphan: !known, unselected: !!known
      });
    });

    var listWrap = el('div', { class: 'mt4' });
    listWrap.appendChild(el('h3', { class: 'section-title mb3', text: 'Rules by field' }));
    fieldsWithRules.forEach(function (f) {
      listWrap.appendChild(fieldRuleCard(a, f, byField[f.name] || []));
    });
    body.appendChild(listWrap);

    /* --- rule test summary + footer --- */
    if (a.ruleTest) body.appendChild(ruleTestSummaryCard(a));

    var foot = el('div', { class: 'row mt5' });
    foot.appendChild(UI.btn('Back', 'btn-secondary', function () { App.go('analytic/' + a.id + '/fields'); }, { icon: 'arrowLeft' }));
    var right = el('div', { style: 'margin-left:auto;display:flex;gap:8px;flex-wrap:wrap' });
    right.appendChild(UI.btn('Test Rules Against Uploaded Data', 'btn-secondary', function () { Screens.ruleTest(a); }, { icon: 'play' }));
    right.appendChild(UI.btn('Continue to Control & Calibration', 'btn-primary', function () { App.go('analytic/' + a.id + '/validation'); }, { icon: 'arrowRight' }));
    foot.appendChild(right);
    body.appendChild(foot);

    return Screens.workflowShell(a, 'rules', body);
  };

  function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function flash(node) {
    node.style.transition = 'box-shadow .3s';
    node.style.boxShadow = '0 0 0 3px var(--blue-100)';
    setTimeout(function () { node.style.boxShadow = ''; }, 900);
  }

  function fieldRuleCard(a, f, rules) {
    var card = el('div', { class: 'rule-field-card' });
    card.dataset.fieldCard = f.name;
    var logic = (a.fieldLogic || {})[f.name] === 'ANY' ? 'ANY' : 'ALL';

    var head = el('div', { class: 'rfc-head' });
    head.innerHTML = '<span class="rfc-name">' + esc(f.name) + '</span>' + UI.typeBadge(f.type) +
      (f.orphan ? '<span class="badge badge-warn">Not in current data</span>' : '') +
      (f.unselected ? '<span class="badge badge-warn">Field not selected — rules skipped</span>' : '') +
      '<span class="badge badge-neutral">' + rules.length + ' rule' + (rules.length === 1 ? '' : 's') + '</span>';
    var grow = el('div', { class: 'grow' });
    grow.appendChild(el('span', { class: 'muted', style: 'font-size:12px', text: 'Group logic' }));
    grow.appendChild(UI.segmented([{ value: 'ALL', label: 'ALL' }, { value: 'ANY', label: 'ANY' }], logic, function (v) {
      Store.setFieldLogic(a, f.name, v);
      UI.toast({ kind: 'info', title: 'Group logic updated', text: '[' + f.name + '] now requires ' + v + ' condition' + (v === 'ALL' ? 's' : '') + ' to pass.' });
      App.render();
    }));
    grow.appendChild(UI.btn('Add Rule', 'btn-secondary btn-sm', function () { Screens.ruleBuilder(a, null, { field: f.name }); }, { icon: 'plus', iconSize: 13 }));
    head.appendChild(grow);
    card.appendChild(head);

    var list = el('div', { class: 'rule-list' });
    rules.forEach(function (r) { list.appendChild(ruleRow(a, r, list)); });
    card.appendChild(list);
    return card;
  }

  function ruleRow(a, r, list) {
    var row = el('div', { class: 'rule-row' + (r.enabled ? '' : ' off'), draggable: 'true' });
    row.dataset.ruleId = r.id;
    var cond = Rules.conditionText(r);
    row.innerHTML =
      '<span class="rule-grip" title="Drag to reorder">' + U.icon('grip', 15) + '</span>' +
      '<div class="rule-main">' +
      '<div class="rule-t">' + esc(Rules.ruleLabel(r)) + UI.severityBadge(r.severity) + UI.scopeBadges(r.scope) +
      (r.enabled ? '' : '<span class="badge badge-neutral">Disabled</span>') + '</div>' +
      '<div class="rule-d">' + esc(Rules.describe(r)) + '</div>' +
      (cond ? '<div class="rule-cond">' + esc(cond) + '</div>' : '') +
      (r.note ? '<div class="rule-cond" style="color:var(--ink-4)">' + esc(r.note) + '</div>' : '') +
      '</div>';

    var acts = el('div', { class: 'rule-acts' });
    acts.appendChild(UI.switchToggle('', r.enabled, function () {
      Store.toggleRule(a, r.id);
      App.render();
    }, true));
    acts.appendChild(UI.iconBtn('edit', 'Edit rule', function () { Screens.ruleBuilder(a, r); }, 'ghost'));
    acts.appendChild(UI.iconBtn('copy', 'Duplicate rule', function () {
      Store.duplicateRule(a, r.id);
      UI.toast({ kind: 'success', title: 'Rule duplicated' });
      App.render();
    }, 'ghost'));
    acts.appendChild(UI.iconBtn('trash', 'Delete rule', function () { deleteRule(a, r); }, 'ghost'));
    row.appendChild(acts);

    /* drag to reorder within the field group */
    row.addEventListener('dragstart', function (e) {
      row.classList.add('dragging');
      e.dataTransfer.setData('text/plain', r.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', function () {
      row.classList.remove('dragging');
      U.$$('.rule-row', list).forEach(function (x) { x.classList.remove('drop-target'); });
    });
    row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('drop-target'); });
    row.addEventListener('dragleave', function () { row.classList.remove('drop-target'); });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      row.classList.remove('drop-target');
      var draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === r.id) return;
      var ids = U.$$('.rule-row', list).map(function (x) { return x.dataset.ruleId; });
      ids.splice(ids.indexOf(draggedId), 1);
      ids.splice(ids.indexOf(r.id), 0, draggedId);
      // rebuild global order: keep other fields untouched
      var others = a.rules.filter(function (x) { return ids.indexOf(x.id) === -1; }).map(function (x) { return x.id; });
      Store.reorderRules(a, ids.concat(others));
      UI.toast({ kind: 'info', title: 'Evaluation order updated' });
      App.render();
    });
    return row;
  }

  function deleteRule(a, r) {
    UI.confirm({
      title: 'Delete rule?',
      message: '<strong>' + esc(Rules.ruleLabel(r)) + '</strong> on [' + esc(r.field) + '] — ' + esc(Rules.describe(r)),
      detail: a.validation.approved ? 'This creates configuration v' + Store.bumpVersion(a.version) +
        ' and re-locks patient testing until QC revalidation passes.' : null,
      confirmLabel: 'Delete rule', danger: true
    }).then(function (ok) {
      if (!ok) return;
      maybeReason(a, 'Rule deleted').then(function (reason) {
        if (reason === false) return;
        Store.deleteRule(a, r.id, reason || '');
        UI.toast({ kind: 'warn', title: 'Rule deleted' });
        App.render();
      });
    });
  }

  /** Ask for a change reason when an approved configuration is being modified. */
  function maybeReason(a, action) {
    if (!a.validation.approved || !Store.S.settings.requireReasonOnRuleChange) return Promise.resolve('');
    return UI.reasonPrompt({
      title: action + ' — reason required',
      message: 'This analytic is approved on v' + a.version + '. The change creates v' + Store.bumpVersion(a.version) +
        ', invalidates the approval and locks patient testing until revalidation.',
      confirmLabel: 'Save & create new version'
    }).then(function (r) { return r === null ? false : r; });
  }

  function suggestRules(a) {
    var recs = Store.scopedRecords(a);
    var selectedNames = Store.selectedFields(a);
    var sug = Seed.suggestRules(
      a.fields.filter(function (f) { return selectedNames.indexOf(f.name) > -1; }),
      recs, a.classification);
    var body = el('div', {});
    body.innerHTML =
      '<p style="font-size:13px;color:var(--ink-2);line-height:1.6">' +
      '<strong>' + sug.rules.length + ' rules</strong> were derived by profiling the uploaded file — allowed values from the ' +
      'distinct values present, numeric limits from the population statistics of this file, and recovery limits against a ' +
      'detected target field. Nothing is taken from a hardcoded template. Review and edit them freely after adding.</p>' +
      (sug.notes.length ? '<div class="formula-help mt4">' + sug.notes.slice(0, 8).map(function (n) { return '• ' + esc(n); }).join('<br>') + '</div>' : '');

    var tbl = el('div', { class: 'table-scroll mt4', style: 'max-height:320px;overflow-y:auto' });
    tbl.innerHTML = '<table class="tbl compact"><thead><tr><th>Field</th><th>Rule</th><th>Definition</th><th>Scope</th><th>Severity</th></tr></thead><tbody>' +
      sug.rules.map(function (r) {
        return '<tr><td class="cell-strong">' + esc(r.field) + '</td><td>' + esc(Rules.ruleLabel(r)) + '</td>' +
          '<td class="mono" style="font-size:12px">' + esc(Rules.describe(r)) + '</td>' +
          '<td>' + UI.scopeBadges(r.scope) + '</td><td>' + UI.severityBadge(r.severity) + '</td></tr>';
      }).join('') + '</tbody></table>';
    body.appendChild(tbl);

    var replace = { value: a.rules.length > 0 };
    if (a.rules.length) {
      body.appendChild(el('div', { class: 'mt4' }, [
        UI.checkbox('Replace the ' + a.rules.length + ' existing rule(s) instead of appending', true, function (v) { replace.value = v; })
      ]));
    }

    var m = UI.modal({
      title: 'Suggested rules from data profile', size: 'wide', body: body,
      footer: [
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        UI.btn('Add ' + sug.rules.length + ' rules', 'btn-primary', function () {
          if (replace.value) a.rules = [];
          sug.rules.forEach(function (r) { a.rules.push(r); });
          Store.audit(a, {
            action: 'Validation rules configured',
            detail: sug.rules.length + ' rules derived from the data profile of ' + (a.file ? a.file.name : 'the uploaded files'),
            kind: 'info'
          });
          Store.invalidateApproval(a, 'Rule set regenerated from data profile');
          Store.save();
          m.close();
          UI.toast({ kind: 'success', title: 'Rules added', text: sug.rules.length + ' rules are now configured across ' + a.fields.length + ' fields.' });
          App.render();
        }, { icon: 'check' })
      ]
    });
  }

  /* ============================================================
     RULE BUILDER (add / edit)
     ============================================================ */
  Screens.ruleBuilder = function (a, existing, presets) {
    presets = presets || {};
    var isEdit = !!existing;
    var selectedNames = Store.selectedFields(a);
    var fields = a.fields.filter(function (f) { return selectedNames.indexOf(f.name) > -1; });
    if (!fields.length) fields = a.fields.length ? a.fields : [{ name: 'Value', type: 'text' }];
    var draft = isEdit ? U.clone(existing) : Rules.newRule(fields, { field: presets.field });
    if (!isEdit && presets.field) {
      var pf = fields.filter(function (f) { return f.name === presets.field; })[0];
      if (pf) {
        draft.dataType = pf.type;
        draft.type = Rules.catalogFor(pf.type)[0].key;
        draft.params = Rules.defaultParams(pf.type, draft.type);
      }
    }

    var body = el('div', {});
    var fieldSel = UI.fieldGroup({
      label: 'Field', required: true, type: 'select', value: draft.field,
      options: fields.map(function (f) { return { value: f.name, label: f.name }; }),
      onChange: function () {
        draft.field = fieldSel.input.value;
        var f = fields.filter(function (x) { return x.name === draft.field; })[0];
        draft.dataType = f ? f.type : 'text';
        typeInfo.input.value = draft.dataType;
        rebuildRuleTypes();
      }
    });
    var typeInfo = UI.fieldGroup({ label: 'Data Type', value: draft.dataType, disabled: true, hint: 'Inferred from the uploaded file' });
    var ruleSel = UI.fieldGroup({ label: 'Rule Type', required: true, type: 'select', value: draft.type, options: [] });
    ruleSel.input.addEventListener('change', function () {
      draft.type = ruleSel.input.value;
      draft.params = Rules.defaultParams(draft.dataType, draft.type);
      renderParams();
    });

    var paramBox = el('div', { class: 'param-box mt4' });
    var severitySel = UI.fieldGroup({
      label: 'Severity', type: 'select', value: draft.severity,
      options: Rules.SEVERITIES.map(function (s) { return { value: s.key, label: s.label }; }),
      hint: 'Error blocks approval · Warning only flags the record',
      onChange: function () { draft.severity = severitySel.input.value; }
    });

    /* apply-to */
    var scopeWrap = el('div', { class: 'fg' });
    scopeWrap.appendChild(el('label', { html: 'Apply To <span class="req">*</span>' }));
    var scopeRow = el('div', { class: 'row', style: 'gap:14px' });
    var allBox;
    var boxes = Rules.SCOPES.map(function (s) {
      var cb = UI.checkbox(s.label, draft.scope.indexOf(s.key) > -1, function (v) {
        draft.scope = draft.scope.filter(function (x) { return x !== s.key; });
        if (v) draft.scope.push(s.key);
        allBox.input.checked = draft.scope.length === Rules.SCOPES.length;
        scopeWrap.classList.remove('invalid');
      });
      scopeRow.appendChild(cb);
      return cb;
    });
    allBox = UI.checkbox('All', draft.scope.length === Rules.SCOPES.length, function (v) {
      draft.scope = v ? Rules.SCOPES.map(function (s) { return s.key; }) : [];
      boxes.forEach(function (b, i) { b.input.checked = v; });
      scopeWrap.classList.remove('invalid');
    });
    scopeRow.appendChild(allBox);
    scopeWrap.appendChild(scopeRow);
    scopeWrap.appendChild(el('p', { class: 'err' }));
    scopeWrap.appendChild(el('p', { class: 'hint', text: 'Rules only run against the sample types selected here.' }));

    /* rule status + note */
    var statusRow = el('div', { class: 'row mt4', style: 'gap:20px' });
    statusRow.appendChild(UI.switchToggle('Rule enabled', draft.enabled, function (v) { draft.enabled = v; }));
    var noteInput = UI.fieldGroup({ label: 'Internal note (optional)', value: draft.note || '', placeholder: 'Why this rule exists…' });

    /* advanced IF/THEN condition */
    var condWrap = el('div', { class: 'param-box mt4' });
    function renderCondition() {
      condWrap.innerHTML = '';
      var on = !!(draft.condition && draft.condition.field);
      var toggle = UI.switchToggle('Only apply when a condition is met (IF / THEN)', on, function (v) {
        draft.condition = v ? { field: fields[0].name, op: 'equals', value: '' } : null;
        renderCondition();
      });
      condWrap.appendChild(toggle);
      if (!on) {
        condWrap.appendChild(el('p', { class: 'hint mt2', text: 'Example: only apply a range check IF [Control Level] equals "L3".' }));
        return;
      }
      var grid = el('div', { class: 'form-grid three mt3' });
      var cf = UI.fieldGroup({
        label: 'IF field', type: 'select', value: draft.condition.field,
        options: fields.map(function (f) { return { value: f.name, label: f.name }; }),
        onChange: function () { draft.condition.field = cf.input.value; }
      });
      var co = UI.fieldGroup({
        label: 'Operator', type: 'select', value: draft.condition.op,
        options: Rules.CONDITION_OPS.map(function (o) { return { value: o.key, label: o.label }; }),
        onChange: function () { draft.condition.op = co.input.value; renderCondition(); }
      });
      grid.appendChild(cf); grid.appendChild(co);
      var opDef = Rules.CONDITION_OPS.filter(function (o) { return o.key === draft.condition.op; })[0];
      if (!opDef || !opDef.noValue) {
        var cv = UI.fieldGroup({
          label: 'Value', value: draft.condition.value,
          onInput: function () { draft.condition.value = cv.input.value; }
        });
        grid.appendChild(cv);
      }
      condWrap.appendChild(grid);
      condWrap.appendChild(el('p', { class: 'hint mt2', text: 'THEN the rule above is evaluated. Records not matching the condition are skipped.' }));
    }

    /* dynamic parameters */
    var paramInputs = {};
    function renderParams() {
      var d = Rules.def(draft.dataType, draft.type);
      paramBox.innerHTML = '';
      paramInputs = {};
      if (!d) return;
      if (!d.params.length) {
        paramBox.appendChild(el('p', { class: 'eyebrow mb3', text: 'No parameters needed' }));
        paramBox.appendChild(el('p', { class: 'muted', style: 'font-size:12.5px', text: d.hint || '' }));
        return;
      }
      paramBox.appendChild(el('p', {
        class: 'eyebrow mb3',
        html: 'Parameters' + (d.hint ? ' <span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--ink-3)">· ' + esc(d.hint) + '</span>' : '')
      }));
      var grid = el('div', { class: 'form-grid ' + (d.params.length > 1 ? 'two' : '') });
      d.params.forEach(function (spec) {
        var node = paramField(spec);
        if (spec.input === 'expr' || spec.input === 'list') grid.classList.remove('two');
        grid.appendChild(node);
      });
      paramBox.appendChild(grid);

      if (d.isCustom) {
        paramBox.appendChild(formulaHelper());
      }
    }

    function paramField(spec) {
      var value = draft.params[spec.key];
      if (value === undefined) value = spec.default;
      var g;
      if (spec.input === 'bool') {
        g = el('div', { class: 'fg' });
        g.appendChild(UI.switchToggle(spec.label, !!value, function (v) { draft.params[spec.key] = v; }));
        paramInputs[spec.key] = g;
        return g;
      }
      if (spec.input === 'select') {
        g = UI.fieldGroup({
          label: spec.label, required: spec.required, type: 'select', value: value,
          options: spec.options, onChange: function () { draft.params[spec.key] = g.input.value; }
        });
      } else if (spec.input === 'field') {
        var opts = a.fields
          .filter(function (f) { return spec.numericOnly ? f.type === 'number' : true; })
          .map(function (f) { return { value: f.name, label: f.name + ' (' + f.type + ')' }; });
        if (!opts.length) opts = [{ value: '', label: 'No suitable field in this file' }];
        g = UI.fieldGroup({
          label: spec.label, required: spec.required, type: 'select', value: value || opts[0].value,
          options: opts, hint: 'Any field from the uploaded file',
          onChange: function () { draft.params[spec.key] = g.input.value; }
        });
        if (draft.params[spec.key] === undefined) draft.params[spec.key] = g.input.value;
      } else if (spec.input === 'comparator') {
        g = UI.fieldGroup({
          label: spec.label, required: spec.required, type: 'select', value: value || '<=',
          options: Expr.COMPARATORS.map(function (c) { return { value: c.op, label: c.label }; }),
          onChange: function () { draft.params[spec.key] = g.input.value; }
        });
        if (draft.params[spec.key] === undefined) draft.params[spec.key] = g.input.value;
      } else if (spec.input === 'expr') {
        g = UI.fieldGroup({
          label: spec.label, required: spec.required, type: 'textarea', mono: true, rows: 2,
          value: value, placeholder: spec.placeholder,
          onInput: function () { draft.params[spec.key] = g.input.value; }
        });
      } else if (spec.input === 'list') {
        g = UI.fieldGroup({
          label: spec.label, required: spec.required, type: 'textarea', rows: 2,
          value: Array.isArray(value) ? value.join(', ') : value, placeholder: spec.placeholder,
          onInput: function () { draft.params[spec.key] = g.input.value; }
        });
      } else {
        g = UI.fieldGroup({
          label: spec.label, required: spec.required,
          type: spec.input === 'number' || spec.input === 'int' ? 'number' : (spec.input === 'date' ? 'date' : 'text'),
          step: spec.input === 'int' ? '1' : 'any',
          value: value, placeholder: spec.placeholder, mono: spec.mono, suffix: spec.suffix,
          onInput: function () { draft.params[spec.key] = g.input.value; }
        });
      }
      paramInputs[spec.key] = g;
      return g;
    }

    function formulaHelper() {
      var box = el('div', { class: 'mt4' });
      var help = el('div', { class: 'formula-help' });
      help.innerHTML = 'Reference any field with <code>[Field Name]</code>. Supported: <code>+ - * / % ^</code>, parentheses and ' +
        Expr.FUNC_NAMES.map(function (f) { return '<code>' + f + '()</code>'; }).join(' ') +
        '. Expressions are parsed by a restricted evaluator — arbitrary JavaScript is never executed.';
      box.appendChild(help);
      var tokens = el('div', { class: 'token-list' });
      a.fields.forEach(function (f) {
        var t = el('button', { class: 'token', type: 'button', text: '[' + f.name + ']', title: 'Insert into the left expression' });
        t.addEventListener('click', function () {
          var target = paramInputs.left && paramInputs.left.input;
          if (!target) return;
          target.value += (target.value ? ' ' : '') + '[' + f.name + ']';
          draft.params.left = target.value;
          target.focus();
        });
        tokens.appendChild(t);
      });
      box.appendChild(tokens);
      var out = el('p', { class: 'hint mt3' });
      var vb = UI.btn('Validate Formula', 'btn-secondary btn-sm', function () {
        var sample = sampleRecordFor(a, draft.scope[0] || 'patient');
        var names = Store.fieldNames(a);
        var L = Expr.compile(draft.params.left, names), R = Expr.compile(draft.params.right, names);
        if (paramInputs.left) paramInputs.left.setError(L.ok ? '' : L.error);
        if (paramInputs.right) paramInputs.right.setError(R.ok ? '' : R.error);
        if (!L.ok || !R.ok) {
          out.innerHTML = '<span style="color:var(--red-700)">✕ Formula is not valid.</span>';
          return;
        }
        if (!sample) { out.innerHTML = '<span style="color:var(--green-700)">✓ Syntax valid.</span> No sample record available to evaluate.'; return; }
        var lv = Expr.evaluate(L, sample, names), rv = Expr.evaluate(R, sample, names);
        if (!lv.ok || !rv.ok) {
          out.innerHTML = '<span style="color:var(--amber-700)">⚠ Syntax valid, but evaluation failed on a sample record: ' +
            esc((lv.error || rv.error)) + '</span>';
          return;
        }
        var passes = Expr.compare(lv.value, draft.params.op, rv.value);
        out.innerHTML = '<span style="color:var(--green-700)">✓ Valid.</span> On sample <strong>' +
          esc(String(sample[a.fields[0].name])) + '</strong>: ' + U.fmtNum(lv.value, 3) + ' ' + esc(draft.params.op) + ' ' +
          U.fmtNum(rv.value, 3) + ' → <strong>' + (passes ? 'PASS' : 'FAIL') + '</strong>';
      }, { icon: 'check', iconSize: 14 });
      box.appendChild(el('div', { class: 'row mt3' }, [vb, out]));
      return box;
    }

    function rebuildRuleTypes() {
      var cat = Rules.catalogFor(draft.dataType);
      ruleSel.input.innerHTML = '';
      cat.forEach(function (d) {
        ruleSel.input.appendChild(el('option', { value: d.key, text: d.label, selected: d.key === draft.type }));
      });
      if (!cat.some(function (d) { return d.key === draft.type; })) {
        draft.type = cat[0].key;
        draft.params = Rules.defaultParams(draft.dataType, draft.type);
        ruleSel.input.value = draft.type;
      }
      renderParams();
    }

    body.appendChild(el('div', { class: 'form-grid three' }, [fieldSel, typeInfo, ruleSel]));
    body.appendChild(paramBox);
    body.appendChild(el('div', { class: 'form-grid two mt4' }, [severitySel, scopeWrap]));
    body.appendChild(condWrap);
    body.appendChild(el('div', { class: 'form-grid two mt4' }, [noteInput]));
    body.appendChild(statusRow);
    rebuildRuleTypes();
    renderCondition();

    var saveBtn = UI.btn(isEdit ? 'Save Rule' : 'Save Rule', 'btn-primary', save, { icon: 'check' });
    var m = UI.modal({
      title: isEdit ? 'Edit Validation Rule' : 'Add Validation Rule',
      size: 'wide', body: body,
      footer: [
        el('div', { class: 'left' }, isEdit ? [
          UI.btn('Delete', 'btn-danger-soft', function () { m.close(); deleteRule(a, existing); }, { icon: 'trash' })
        ] : []),
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        saveBtn
      ]
    });

    function save() {
      draft.note = noteInput.input.value.trim();
      Object.keys(paramInputs).forEach(function (k) { if (paramInputs[k].setError) paramInputs[k].setError(''); });
      var check = Rules.validateRule(draft, { fieldNames: Store.fieldNames(a) });
      if (!check.ok) {
        Object.keys(check.errors).forEach(function (k) {
          if (k === 'scope') {
            scopeWrap.classList.add('invalid');
            U.$('.err', scopeWrap).textContent = check.errors[k];
          } else if (paramInputs[k] && paramInputs[k].setError) paramInputs[k].setError(check.errors[k]);
        });
        UI.toast({ kind: 'error', title: 'Rule is incomplete', text: Object.keys(check.errors).map(function (k) { return check.errors[k]; })[0] });
        return;
      }

      maybeReason(a, isEdit ? 'Rule modified' : 'Rule created').then(function (reason) {
        if (reason === false) return;
        if (isEdit) Store.updateRule(a, existing.id, draft, reason || '');
        else Store.addRule(a, draft, reason || '');
        m.close();
        UI.toast({
          kind: 'success', title: isEdit ? 'Rule updated' : 'Rule created',
          text: '[' + draft.field + '] ' + Rules.ruleLabel(draft) + ' — ' + Rules.describe(draft)
        });
        App.render();
      });
    }
  };

  function sampleRecordFor(a, scope) {
    var g = Store.groups(a);
    var list = g[scope] && g[scope].length ? g[scope] : (g.patient.length ? g.patient : Store.recordsOf(a));
    return list[0] || null;
  }

  /* ============================================================
     RULE TEST PREVIEW
     ============================================================ */
  Screens.ruleTest = function (a) {
    if (!a.rules.length) {
      UI.toast({ kind: 'error', title: 'No rules to test', text: 'Add at least one validation rule first.' });
      return;
    }
    var runner = UI.progressRunner({ title: 'Testing rules against uploaded data' });
    var m = UI.modal({ title: 'Rule test', size: 'wide', body: runner.body, autofocus: false });
    var counts = Store.counts(a);
    var total = counts.control + counts.calibration + counts.patient;

    UI.simulate({
      total: total, duration: 1600,
      onTick: function (done, t, frac) {
        runner.set(frac, '<div class="run-line"><span class="run-ico">' + (frac > .4 ? '✓' : '·') + '</span>' +
          '<span class="run-t">Control samples</span><span class="run-v">' + U.fmtInt(Math.min(counts.control, done)) + ' / ' + U.fmtInt(counts.control) + '</span></div>' +
          '<div class="run-line"><span class="run-ico">' + (frac > .6 ? '✓' : '·') + '</span>' +
          '<span class="run-t">Calibration samples</span><span class="run-v">' + U.fmtInt(Math.min(counts.calibration, Math.max(0, done - counts.control))) + ' / ' + U.fmtInt(counts.calibration) + '</span></div>' +
          '<div class="run-line"><span class="run-ico">' + (frac >= 1 ? '✓' : '·') + '</span>' +
          '<span class="run-t">Patient samples</span><span class="run-v">' + U.fmtInt(Math.max(0, done - counts.control - counts.calibration)) + ' / ' + U.fmtInt(counts.patient) + '</span></div>' +
          '<p class="muted mt3" style="font-size:12.5px">Applying ' + a.rules.filter(function (r) { return r.enabled; }).length + ' active rules…</p>');
      },
      onDone: function () {
        var res = Store.runRuleTest(a);
        UI.closeModal();
        showRuleTestResult(a, res);
      }
    });
  };

  function showRuleTestResult(a, res) {
    var body = el('div', {});
    var tiles = el('div', { class: 'result-tiles' });
    tiles.innerHTML =
      '<div class="rt total"><div class="rtk">' + U.icon('table', 13) + ' Records tested</div><div class="rtv">' + U.fmtInt(res.total) + '</div>' +
      '<div class="rtp">' + res.ruleCount + ' active rules</div></div>' +
      '<div class="rt pass"><div class="rtk">✓ Passed</div><div class="rtv">' + U.fmtInt(res.passed) + '</div>' +
      '<div class="rtp">' + U.fmtPct(res.total ? res.passed / res.total * 100 : 0) + '</div></div>' +
      '<div class="rt fail"><div class="rtk">✕ Failed</div><div class="rtv">' + U.fmtInt(res.failed) + '</div>' +
      '<div class="rtp">' + U.fmtPct(res.total ? res.failed / res.total * 100 : 0) + '</div></div>' +
      '<div class="rt warn"><div class="rtk">⚠ Warning</div><div class="rtv">' + U.fmtInt(res.warning) + '</div>' +
      '<div class="rtp">' + U.fmtPct(res.total ? res.warning / res.total * 100 : 0) + '</div></div>';
    body.appendChild(tiles);

    var scopeTable = el('div', { class: 'table-scroll mt4' });
    scopeTable.innerHTML = '<table class="tbl compact"><thead><tr><th>Sample type</th><th class="num">Tested</th>' +
      '<th class="num">Passed</th><th class="num">Failed</th><th class="num">Warning</th><th>Outcome</th></tr></thead><tbody>' +
      ['control', 'calibration', 'patient'].map(function (k) {
        var s = res.byScope[k] || { total: 0, passed: 0, failed: 0, warning: 0 };
        return '<tr><td class="cell-strong">' + U.titleCase(k) + '</td><td class="num">' + U.fmtInt(s.total) + '</td>' +
          '<td class="num">' + U.fmtInt(s.passed) + '</td><td class="num">' + U.fmtInt(s.failed) + '</td>' +
          '<td class="num">' + U.fmtInt(s.warning) + '</td><td>' +
          (!s.total ? '<span class="muted">—</span>' : s.failed ? '<span class="badge badge-danger">' + s.failed + ' failing</span>' :
            s.warning ? '<span class="badge badge-warn">Warnings only</span>' : '<span class="badge badge-success">All passed</span>') +
          '</td></tr>';
      }).join('') + '</tbody></table>';
    body.appendChild(scopeTable);

    if (res.failedRows.length) {
      var recs = Store.recordsOf(a);
      var idField = a.fields[0] ? a.fields[0].name : null;
      var rows = res.failedRows.map(function (r) {
        var rec = recs[r.index] || {};
        var first = (r.failures[0] || r.warnings[0] || {});
        return {
          id: idField ? rec[idField] : '#' + (r.index + 1),
          scope: r.scope, status: r.status, field: first.field, rule: first.rule,
          reason: first.message, extra: (r.failures.length + r.warnings.length - 1)
        };
      });
      var table = UI.dataTable({
        title: 'Records that did not pass', rows: rows, pageSize: 10, compact: true,
        searchPlaceholder: 'Search sample or rule…',
        searchText: function (r) { return [r.id, r.scope, r.field, r.rule, r.reason].join(' '); },
        filters: [
          { key: 'all', label: 'All', count: rows.length },
          { key: 'fail', label: 'Failed', count: rows.filter(function (r) { return r.status === 'fail'; }).length, test: function (r) { return r.status === 'fail'; } },
          { key: 'warn', label: 'Warning', count: rows.filter(function (r) { return r.status === 'warning'; }).length, test: function (r) { return r.status === 'warning'; } }
        ],
        rowClass: function (r) { return r.status === 'fail' ? 'row-fail' : 'row-warn'; },
        columns: [
          { key: 'id', label: 'Sample', render: function (r) { return '<span class="cell-strong">' + esc(r.id) + '</span>'; } },
          { key: 'scope', label: 'Type', render: function (r) { return UI.scopeBadges([r.scope]); } },
          { key: 'status', label: 'Status', render: function (r) { return UI.resultBadge(r.status); } },
          { key: 'field', label: 'Field' },
          { key: 'rule', label: 'Failed rule', render: function (r) { return '<span class="cell-strong">' + esc(r.rule || '—') + '</span>' + (r.extra > 0 ? ' <span class="badge badge-neutral">+' + r.extra + '</span>' : ''); } },
          { key: 'reason', label: 'Reason', render: function (r) { return '<span class="cell-sub">' + esc(r.reason || '') + '</span>'; } }
        ],
        exportName: (a.code || 'analytic') + '_rule_test_exceptions'
      });
      body.appendChild(el('div', { class: 'mt4' }, table));
      if (res.failedRows.length >= 500) {
        body.appendChild(el('p', { class: 'muted mt2', style: 'font-size:12px', text: 'Showing the first 500 exception records.' }));
      }
    } else {
      body.appendChild(el('div', {
        class: 'alert alert-success mt4',
        html: U.icon('check', 17) + '<div><div class="alert-t">Every record satisfied every active rule</div>' +
          '<p>You can proceed to control &amp; calibration validation.</p></div>'
      }));
    }

    var m = UI.modal({
      title: 'Rule test results', size: 'wide', body: body, autofocus: false,
      footer: [
        UI.btn('Back to rules', 'btn-secondary', function () { m.close(); App.render(); }),
        UI.btn('Continue to Control & Calibration', 'btn-primary', function () {
          m.close(); App.go('analytic/' + a.id + '/validation');
        }, { icon: 'arrowRight' })
      ]
    });
  }

  function ruleTestSummaryCard(a) {
    var t = a.ruleTest;
    var c = Screens.card({
      title: 'Last rule test',
      badge: '<span class="badge badge-neutral">' + esc(U.fmtDateTime(t.ranAt)) + '</span>',
      actions: [UI.btn('Re-test', 'btn-secondary btn-sm', function () { Screens.ruleTest(a); }, { icon: 'refresh', iconSize: 14 })],
      body: '<div class="result-tiles">' +
        '<div class="rt total"><div class="rtk">Records tested</div><div class="rtv">' + U.fmtInt(t.total) + '</div></div>' +
        '<div class="rt pass"><div class="rtk">✓ Passed</div><div class="rtv">' + U.fmtInt(t.passed) + '</div></div>' +
        '<div class="rt fail"><div class="rtk">✕ Failed</div><div class="rtv">' + U.fmtInt(t.failed) + '</div></div>' +
        '<div class="rt warn"><div class="rtk">⚠ Warning</div><div class="rtv">' + U.fmtInt(t.warning) + '</div></div>' +
        '</div>'
    });
    c.classList.add('mt4');
    return c;
  }
}(typeof window !== 'undefined' ? window : this));
