/* ============================================================
   screens-lisa.js — LISA-specific screens layered on the existing
   design system: Analyte Configuration, Criteria Module, criterion
   configuration drawer, Test Criteria, Execute Processing, per-file
   Processing results and the File Details drawer.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  /* ============================================================
     ANALYTE CONFIGURATION
     ============================================================ */
  Screens.analyteConfig = function (a) {
    var assay = Store.assayOf(a);
    var body = el('div', {});

    var tiles = el('div', { class: 'grid g4' });
    tiles.innerHTML =
      UI.metric('Analyte', esc(assay.analyteName || a.name), 'blue') +
      UI.metric('Analyte code', esc(assay.analyteCode || a.code || '—')) +
      UI.metric('Reference Ratio Adjustment', esc(assay.referenceRatioAdjustment) + ' %', 'amber') +
      UI.metric('Criteria version', 'v' + esc(assay.criteriaVersion), 'green');
    body.appendChild(tiles);

    var name = UI.fieldGroup({ label: 'Analyte Name', required: true, value: assay.analyteName });
    var code = UI.fieldGroup({ label: 'Analyte Code', required: true, value: assay.analyteCode, hint: 'Short code used on outputs and audit entries.' });
    var assayName = UI.fieldGroup({ label: 'Assay', value: assay.assayName, hint: 'Method / instrument assay this analyte is reported under.' });
    var matrix = UI.fieldGroup({ label: 'Matrix', value: assay.matrix, placeholder: 'e.g. Urine, Blood, Oral fluid' });

    var ratio = UI.fieldGroup({
      label: 'Reference Ratio Adjustment', type: 'number', step: '0.1', value: assay.referenceRatioAdjustment,
      suffix: '%', required: true,
      hint: 'Widens the ion-ratio range built from this run’s calibrators: lowest × (1 − adj) … highest × (1 + adj).'
    });
    var zeroRatios = el('div', { class: 'fg' }, [
      el('label', { text: 'Zero / missing calibrator ratios' }),
      UI.switchToggle('Exclude zero ratios when deriving the range', assay.ignoreZeroRatios !== false, function (v) { draft.ignoreZeroRatios = v; }),
      el('p', { class: 'hint', text: 'A calibrator reporting 0 usually means the qualifier ion was not integrated; including it would widen the range dramatically.' })
    ]);

    var cutoffMode = UI.fieldGroup({
      label: 'Cut-off configuration', type: 'select', value: assay.cutoffMode,
      options: [
        { value: 'wcs1', label: 'Dynamic — from the cut-off control row (WCS1)' },
        { value: 'fixed', label: 'Fixed value' }
      ],
      onChange: function () { draft.cutoffMode = cutoffMode.input.value; paintCutoff(); }
    });
    var cutoffWrap = el('div', {});

    var draft = {
      cutoffMode: assay.cutoffMode,
      ignoreZeroRatios: assay.ignoreZeroRatios !== false,
      cutoffSampleId: assay.cutoffSampleId,
      cutoffValue: assay.cutoffValue
    };
    var sampleIdInput, fixedInput;

    function paintCutoff() {
      cutoffWrap.innerHTML = '';
      if (draft.cutoffMode === 'fixed') {
        fixedInput = UI.fieldGroup({
          label: 'Cut-off value', type: 'number', step: 'any', value: draft.cutoffValue, suffix: 'ng/mL',
          hint: 'Applied to every patient concentration in this analyte.',
          onInput: function () { draft.cutoffValue = fixedInput.input.value; }
        });
        cutoffWrap.appendChild(fixedInput);
      } else {
        sampleIdInput = UI.fieldGroup({
          label: 'Cut-off control Sample ID', value: draft.cutoffSampleId, mono: true,
          hint: 'The Std. Conc. of this control row becomes the cut-off for the run.',
          onInput: function () { draft.cutoffSampleId = sampleIdInput.input.value; }
        });
        cutoffWrap.appendChild(sampleIdInput);
      }
      var ctx = Store.hasData(a) ? Store.criteriaContext(a) : null;
      var derivedNote = el('div', { class: 'alert alert-info mt3' });
      var cut = ctx ? ctx.derived.cutoff : null;
      derivedNote.innerHTML = U.icon('info', 16) +
        '<div><div class="alert-t">Cut-off currently resolving to ' +
        (cut === null || cut === undefined || isNaN(cut) ? '— (not derivable yet)' : U.fmtNum(cut, 4) + ' ng/mL') + '</div>' +
        '<p>' + esc((ctx && ctx.derived.cutoffSource) || 'Upload a run file containing the cut-off control to derive this value.') + '</p></div>';
      cutoffWrap.appendChild(derivedNote);
    }
    paintCutoff();

    var saveBtn = UI.btn('Save Configuration', 'btn-primary', function () {
      name.setError(''); code.setError(''); ratio.setError('');
      var ok = true;
      if (!name.input.value.trim()) { name.setError('Analyte name is required'); ok = false; }
      if (!code.input.value.trim()) { code.setError('Analyte code is required'); ok = false; }
      var adj = parseFloat(ratio.input.value);
      if (isNaN(adj) || adj < 0 || adj > 100) { ratio.setError('Enter a percentage between 0 and 100'); ok = false; }
      if (!ok) return;

      var patch = {
        analyteName: name.input.value.trim(), analyteCode: code.input.value.trim().toUpperCase(),
        assayName: assayName.input.value.trim(), matrix: matrix.input.value.trim(),
        referenceRatioAdjustment: adj, cutoffMode: draft.cutoffMode,
        ignoreZeroRatios: draft.ignoreZeroRatios,
        cutoffSampleId: draft.cutoffMode === 'wcs1' ? (draft.cutoffSampleId || 'WCS1') : assay.cutoffSampleId,
        cutoffValue: draft.cutoffMode === 'fixed' ? parseFloat(draft.cutoffValue) : assay.cutoffValue
      };
      var willInvalidate = Object.keys(Store.runOf(a, (Store.filesOf(a)[0] || {}).id) ? { x: 1 } : {}).length > 0;
      var proceed = willInvalidate ? UI.reasonPrompt({
        title: 'Analyte configuration change',
        message: 'Processed files were produced with criteria v' + assay.criteriaVersion +
          '. Saving creates a new criteria version and marks those runs for re-processing.',
        confirmLabel: 'Save & re-version'
      }) : Promise.resolve('');
      proceed.then(function (reason) {
        if (reason === null) return;
        Store.saveAssayConfig(a, patch, reason || '');
        UI.toast({ kind: 'success', title: 'Analyte configuration saved', text: Store.describeAssay(Store.assayOf(a)) });
        App.render();
      });
    }, { icon: 'check' });

    var card = Screens.card({
      title: 'Analyte Configuration',
      badge: '<span class="badge badge-info">Stored against this analyte</span>',
      body: [
        el('div', { class: 'form-grid two' }, [name, code, assayName, matrix]),
        el('div', { class: 'divider' }),
        el('p', { class: 'eyebrow mb3', text: 'Criteria parameters' }),
        el('div', { class: 'form-grid two' }, [ratio, zeroRatios]),
        el('div', { class: 'form-grid two mt4' }, [cutoffMode, el('div', {}, cutoffWrap)])
      ],
      foot: [
        el('span', { class: 'muted', style: 'font-size:12.5px', text: 'Every analyte carries its own values — nothing is shared or hardcoded.' }),
        el('div', { class: 'grow' }, [
          UI.btn('Criteria Module', 'btn-secondary', function () { App.go('analytic/' + a.id + '/criteria'); }, { icon: 'rules' }),
          saveBtn
        ])
      ]
    });
    card.classList.add('mt4');
    body.appendChild(card);

    /* how this analyte compares with the others */
    var others = Store.all().filter(function (x) { return x.id !== a.id; });
    if (others.length) {
      var t = el('div', { class: 'table-scroll' });
      t.innerHTML = '<table class="tbl compact"><thead><tr><th>Analyte</th><th>Code</th>' +
        '<th class="num">Reference Ratio Adjustment</th><th>Cut-off</th><th>Criteria version</th></tr></thead><tbody>' +
        [a].concat(others).map(function (x) {
          var s = Store.assayOf(x);
          return '<tr' + (x.id === a.id ? ' class="row-warn"' : '') + '><td class="cell-strong">' + esc(s.analyteName || x.name) +
            (x.id === a.id ? ' <span class="badge badge-info">this analyte</span>' : '') + '</td>' +
            '<td>' + esc(s.analyteCode || x.code || '—') + '</td>' +
            '<td class="num">' + esc(s.referenceRatioAdjustment) + ' %</td>' +
            '<td>' + (s.cutoffMode === 'fixed' ? 'Fixed ' + esc(s.cutoffValue) : 'Dynamic · ' + esc(s.cutoffSampleId)) + '</td>' +
            '<td>v' + esc(s.criteriaVersion) + '</td></tr>';
        }).join('') + '</tbody></table>';
      var c2 = Screens.card({
        title: 'Per-analyte configuration across the platform', flush: true, body: t
      });
      c2.classList.add('mt4');
      body.appendChild(c2);
    }

    return Screens.workflowShell(a, null, body);
  };

  /* ============================================================
     LISA SAMPLE CLASSIFICATION (Sample ID patterns + Sample Type values)
     ============================================================ */
  var STREAM_DEFS = [
    { key: 'calibrator', label: 'Calibrators', hint: 'e.g. Sample ID Cal_1 … Cal_7 · Sample Type "Standard"', tone: 'k' },
    { key: 'control', label: 'Controls', hint: 'e.g. Sample ID WSC_* / WCS* / UC · Sample Type "Control"', tone: 'c' },
    { key: 'patient', label: 'Patient Samples', hint: 'e.g. numeric Sample ID · Sample Type "Unknown"', tone: 'p' }
  ];

  Screens.patternClassification = function (a) {
    var suggested = Store.suggestPatterns(a);
    var current = a.classification.mode === 'patterns' && a.classification.patterns
      ? {
        idField: a.classification.idField, typeField: a.classification.typeField,
        calibrator: a.classification.patterns.calibrator,
        control: a.classification.patterns.control,
        patient: a.classification.patterns.patient
      }
      : suggested;
    if (!current) {
      UI.toast({ kind: 'error', title: 'Cannot build patterns', text: 'No Sample ID or Sample Type column was detected in the uploaded data.' });
      return;
    }
    var draft = U.clone(current);
    var body = el('div', {});
    body.innerHTML = UI.alertBox('info', 'LISA sample definitions',
      'Calibrators, controls and patient specimens are identified from the Sample ID pattern and/or the Sample Type value. ' +
      'Both are read from the uploaded files and fully editable.');

    var fieldGrid = el('div', { class: 'form-grid two mt4' });
    var idSel = UI.fieldGroup({
      label: 'Sample ID column', type: 'select', value: draft.idField || '',
      options: [{ value: '', label: '— none —' }].concat(a.fields.map(function (f) { return { value: f.name, label: f.name }; })),
      onChange: function () { draft.idField = idSel.input.value; refresh(); }
    });
    var typeSel = UI.fieldGroup({
      label: 'Sample Type column', type: 'select', value: draft.typeField || '',
      options: [{ value: '', label: '— none —' }].concat(a.fields.map(function (f) { return { value: f.name, label: f.name }; })),
      onChange: function () { draft.typeField = typeSel.input.value; refresh(); }
    });
    fieldGrid.appendChild(idSel); fieldGrid.appendChild(typeSel);
    body.appendChild(fieldGrid);

    var streamsWrap = el('div', { class: 'mt4' });
    var summary = el('div', { class: 'mt4' });

    function typeOptions() {
      if (!draft.typeField) return [];
      var f = a.fields.filter(function (x) { return x.name === draft.typeField; })[0];
      return f ? f.distinct.slice(0, 20) : [];
    }

    function paintStreams() {
      streamsWrap.innerHTML = '';
      STREAM_DEFS.forEach(function (sd) {
        var p = draft[sd.key] = draft[sd.key] || { types: [], idPattern: '', match: 'either' };
        var card = el('div', { class: 'rule-field-card' });
        var head = el('div', { class: 'rfc-head' });
        head.innerHTML = '<span class="rfc-name">' + esc(sd.label) + '</span>' +
          '<span class="badge badge-neutral">' + esc(sd.hint) + '</span>';
        card.appendChild(head);
        var b = el('div', { class: 'card-body tight' });

        var idInput = UI.fieldGroup({
          label: 'Sample ID pattern (regular expression)', value: p.idPattern, mono: true,
          placeholder: '^Cal[_-]?\\\\d+$',
          hint: 'Leave empty to match on Sample Type alone.',
          onInput: function () { p.idPattern = idInput.input.value; refresh(); }
        });

        var typeWrap = el('div', { class: 'fg' });
        typeWrap.appendChild(el('label', { text: 'Sample Type values' }));
        var opts = typeOptions();
        if (!opts.length) {
          typeWrap.appendChild(el('p', { class: 'hint', text: 'No Sample Type column selected.' }));
        } else {
          var chips = el('div', { class: 'row', style: 'gap:10px' });
          opts.forEach(function (v) {
            chips.appendChild(UI.checkbox(v, (p.types || []).indexOf(v) > -1, function (on) {
              p.types = (p.types || []).filter(function (x) { return x !== v; });
              if (on) p.types.push(v);
              refresh();
            }));
          });
          typeWrap.appendChild(chips);
        }

        var matchSel = UI.fieldGroup({
          label: 'Match rule', type: 'select', value: p.match || 'either',
          options: [
            { value: 'either', label: 'Sample ID pattern OR Sample Type value' },
            { value: 'all', label: 'Sample ID pattern AND Sample Type value' }
          ],
          onChange: function () { p.match = matchSel.input.value; refresh(); }
        });

        b.appendChild(el('div', { class: 'form-grid two' }, [idInput, matchSel]));
        b.appendChild(el('div', { class: 'mt3' }, typeWrap));
        card.appendChild(b);
        streamsWrap.appendChild(card);
      });
    }

    function tally() {
      var recs = Store.recordsOf(a);
      var out = { calibrator: 0, control: 0, patient: 0, unmatched: 0 };
      var cfg = { idField: draft.idField, typeField: draft.typeField };
      recs.forEach(function (r) {
        var hit = null;
        ['calibrator', 'control', 'patient'].some(function (k) {
          if (match(r, draft[k], cfg)) { hit = k; return true; }
          return false;
        });
        out[hit || 'unmatched']++;
      });
      return out;
    }
    function match(row, p, cfg) {
      if (!p) return false;
      var typeOk = true, idOk = true;
      if (p.types && p.types.length) {
        var tv = String(row[cfg.typeField] === undefined ? '' : row[cfg.typeField]).trim().toLowerCase();
        typeOk = p.types.some(function (t) { return String(t).trim().toLowerCase() === tv; });
      }
      if (p.idPattern) {
        var idv = String(row[cfg.idField] === undefined ? '' : row[cfg.idField]).trim();
        try { idOk = new RegExp(p.idPattern, 'i').test(idv); } catch (e) { idOk = false; }
      }
      if (p.match === 'either') return typeOk || idOk;
      return typeOk && idOk;
    }

    function refresh() {
      var t = tally();
      summary.innerHTML = '<p class="eyebrow mb3">Sample Classification</p><div class="grid g4">' +
        UI.metric('Calibrators', U.fmtInt(t.calibrator), t.calibrator ? '' : 'amber') +
        UI.metric('Controls', U.fmtInt(t.control), t.control ? '' : 'amber') +
        UI.metric('Patient Samples', U.fmtInt(t.patient), t.patient ? '' : 'amber') +
        UI.metric('Total', U.fmtInt(t.calibrator + t.control + t.patient + t.unmatched), 'blue') +
        '</div>' +
        (t.unmatched ? '<div class="alert alert-warn mt3">' + U.icon('warning', 16) +
          '<div><div class="alert-t">' + U.fmtInt(t.unmatched) + ' row(s) unmatched</div>' +
          '<p>Rows such as BLANK or Double Blank injections normally stay unmatched — they are excluded from every criterion.</p></div></div>' : '');
    }

    paintStreams();
    body.appendChild(streamsWrap);
    body.appendChild(summary);
    refresh();

    var m = UI.modal({
      title: 'LISA sample classification', size: 'wide', body: body,
      footer: [
        el('div', { class: 'left' }, [UI.btn('Restore detected patterns', 'btn-ghost', function () {
          draft = U.clone(suggested || draft);
          idSel.input.value = draft.idField || '';
          typeSel.input.value = draft.typeField || '';
          paintStreams(); refresh();
        }, { icon: 'refresh' })]),
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        UI.btn('Apply Classification', 'btn-primary', function () {
          var t = tally();
          if (!t.calibrator && !t.control && !t.patient) {
            UI.toast({ kind: 'error', title: 'Nothing matched', text: 'Adjust the patterns so at least one stream matches rows.' });
            return;
          }
          Store.applyPatternClassification(a, draft);
          m.close();
          UI.toast({
            kind: 'success', title: 'Classification applied',
            text: U.fmtInt(t.calibrator) + ' calibrators · ' + U.fmtInt(t.control) + ' controls · ' + U.fmtInt(t.patient) +
              ' patient samples. Confirm the individual records next.'
          });
          App.go('analytic/' + a.id + '/samples');
        }, { icon: 'check' })
      ]
    });
  };

  /** Read-only summary shown on the Sample Types step when patterns are active. */
  Screens.patternSummaryCard = function (a) {
    var c = a.classification;
    var g = Store.groups(a);
    var wrap = el('div', {});
    var rows = el('div', { class: 'table-scroll' });
    rows.innerHTML = '<table class="tbl compact"><thead><tr><th>Stream</th><th>Sample ID pattern</th>' +
      '<th>Sample Type values</th><th>Match</th><th class="num">Rows</th></tr></thead><tbody>' +
      STREAM_DEFS.map(function (sd) {
        var p = c.patterns[sd.key] || {};
        var n = sd.key === 'calibrator' ? g.calibration.length : sd.key === 'control' ? g.control.length : g.patient.length;
        return '<tr><td class="cell-strong">' + esc(sd.label) + '</td>' +
          '<td class="mono">' + (p.idPattern ? esc(p.idPattern) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + ((p.types || []).length ? (p.types || []).map(function (t) { return '<span class="badge badge-neutral">' + esc(t) + '</span>'; }).join(' ') : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (p.match === 'all' ? 'ID AND Type' : 'ID OR Type') + '</td>' +
          '<td class="num cell-strong">' + U.fmtInt(n) + '</td></tr>';
      }).join('') + '</tbody></table>';

    var card = Screens.card({
      title: 'Sample Classification',
      badge: '<span class="badge badge-info">LISA patterns on [' + esc(c.idField || '—') + '] / [' + esc(c.typeField || '—') + ']</span>',
      actions: [
        UI.btn('Edit patterns', 'btn-secondary btn-sm', function () { Screens.patternClassification(a); }, { icon: 'edit', iconSize: 14 }),
        UI.btn('Select Records', 'btn-primary btn-sm', function () { App.go('analytic/' + a.id + '/samples'); }, { icon: 'arrowRight', iconSize: 14 })
      ],
      flush: true, body: rows
    });
    wrap.appendChild(card);

    var tiles = el('div', { class: 'grid g4 mt4' });
    var total = g.calibration.length + g.control.length + g.patient.length + g.unmatched.length;
    tiles.innerHTML =
      UI.metric('Calibrators', U.fmtInt(g.calibration.length)) +
      UI.metric('Controls', U.fmtInt(g.control.length)) +
      UI.metric('Patient Samples', U.fmtInt(g.patient.length)) +
      UI.metric('Total', U.fmtInt(total), 'blue');
    wrap.appendChild(tiles);
    if (g.unmatched.length) {
      wrap.appendChild(el('p', {
        class: 'muted mt3', style: 'font-size:12.5px',
        text: U.fmtInt(g.unmatched.length) + ' row(s) match no stream (blanks, double blanks, solvent injections) and are excluded from processing.'
      }));
    }
    return wrap;
  };

  /* ============================================================
     CRITERIA MODULE
     ============================================================ */
  Screens.criteria = function (a) {
    if (!Store.hasData(a)) return Screens.needFile(a);
    if (!a.classification.applied) {
      return Screens.card({ body: UI.emptyState({
        icon: 'target', title: 'Classify the samples first',
        desc: 'Criteria run per sample stream (calibrators, controls, patients), so the streams must be identified first.',
        actions: [UI.btn('Go to Sample Types', 'btn-primary', function () { App.go('analytic/' + a.id + '/mapping'); }, { icon: 'arrowRight' })]
      }) });
    }

    var assay = Store.assayOf(a);
    var list = Store.criteriaOf(a);
    var ctx = Store.criteriaContext(a);
    var qc = Store.criteriaQCStatus(a);
    var body = el('div', {});

    /* flow + derived values */
    var head = el('div', { class: 'grid g4' });
    head.innerHTML =
      UI.metric('Criteria enabled', list.filter(function (c) { return c.enabled; }).length + ' / ' + list.length, 'blue') +
      UI.metric('Criteria version', 'v' + esc(assay.criteriaVersion), 'green') +
      UI.metric('Files to process', U.fmtInt(Store.filesOf(a).length)) +
      UI.metric('Processed', U.fmtInt(qc.processedFiles) + ' / ' + U.fmtInt(qc.totalFiles),
        qc.stale ? 'amber' : (qc.processedFiles === qc.totalFiles && qc.totalFiles ? 'green' : ''));
    body.appendChild(head);

    if (qc.stale) {
      body.appendChild(el('div', {
        class: 'alert alert-warn mt4',
        html: U.icon('warning', 17) + '<div><div class="alert-t">' + qc.stale + ' processed file(s) are out of date</div>' +
          '<p>The analyte configuration or criteria changed after they were processed. Re-run processing to produce outputs on criteria v' +
          esc(assay.criteriaVersion) + '.</p></div>'
      }));
    }

    /* derived values card */
    var derivedRows = [
      ['Cut-off (Std. Conc. of ' + esc(assay.cutoffSampleId) + ')', ctx.derived.cutoff === null || isNaN(ctx.derived.cutoff)
        ? null : U.fmtNum(ctx.derived.cutoff, 4) + ' ng/mL', ctx.derived.cutoffSource],
      ['Acceptable ion-ratio range', ctx.derived.ionRatioRange
        ? U.fmtNum(ctx.derived.ionRatioRange[0], 2) + ' – ' + U.fmtNum(ctx.derived.ionRatioRange[1], 2) : null,
        ctx.derived.ionRatioBasis],
      ['Retention-time window', ctx.derived.rtWindow
        ? U.fmtNum(ctx.derived.rtWindow[0], 3) + ' – ' + U.fmtNum(ctx.derived.rtWindow[1], 3) : null,
        ctx.derived.rtAverage ? 'Calibrator average ' + U.fmtNum(ctx.derived.rtAverage, 3) + ' ± ' + ctx.derived.rtWindowPct + '%' : null],
      ['Calibrated measuring range', ctx.derived.calibrationRange
        ? U.fmtNum(ctx.derived.calibrationRange[0], 4) + ' – ' + U.fmtNum(ctx.derived.calibrationRange[1], 4) + ' ng/mL' : null,
        'Lowest to highest calibrator Std. Conc.']
    ];
    var dv = el('div', { class: 'table-scroll' });
    dv.innerHTML = '<table class="tbl compact"><thead><tr><th>Derived value</th><th>Current</th><th>Derived from</th></tr></thead><tbody>' +
      derivedRows.map(function (r) {
        return '<tr><td class="cell-strong">' + r[0] + '</td>' +
          '<td class="mono">' + (r[1] ? esc(r[1]) : '<span class="badge badge-warn">not derivable</span>') + '</td>' +
          '<td class="cell-sub">' + esc(r[2] || '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
    var dvCard = Screens.card({
      title: 'Values derived from this run',
      badge: '<span class="badge badge-violet">computed from the uploaded data</span>',
      actions: [UI.btn('Analyte Configuration', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id + '/config'); }, { icon: 'settings', iconSize: 14 })],
      flush: true, body: dv
    });
    dvCard.classList.add('mt4');
    body.appendChild(dvCard);

    /* criteria list */
    var rows = el('div', { class: 'list-rows' });
    list.forEach(function (cfg) {
      var d = Criteria.def(cfg.key);
      if (!d) return;
      var mappedCol = ctx.map[cfg.role];
      var row = el('div', { class: 'lr' });
      var main = el('div', { class: 'lr-main' });
      main.innerHTML =
        '<div class="lr-t">' + esc(d.name) +
        ' ' + UI.scopeBadges([d.stream === 'calibrator' ? 'calibration' : d.stream]) +
        (mappedCol ? '' : ' <span class="badge badge-warn">column not mapped</span>') +
        (cfg.severity === 'transform' ? ' <span class="badge badge-info">transform</span>' :
          cfg.severity === 'warning' ? ' <span class="badge badge-warn">warning</span>' : ' <span class="badge badge-danger">fail</span>') +
        '</div>' +
        '<div class="lr-d">' + esc(d.description) + '</div>' +
        '<div class="rule-d mt2">' + esc(Criteria.describe(cfg, ctx)) + '</div>';
      row.appendChild(main);
      var act = el('div', { class: 'lr-act row', style: 'gap:6px' });
      act.appendChild(UI.switchToggle('', cfg.enabled, function (v) {
        Store.saveCriterion(a, cfg.key, { enabled: v });
        UI.toast({ kind: 'info', title: (v ? 'Criterion enabled' : 'Criterion disabled'), text: d.name });
        App.render();
      }, true));
      act.appendChild(UI.btn('Configure', 'btn-secondary btn-sm', function () { Screens.criterionDrawer(a, cfg.key); }, { icon: 'edit', iconSize: 13 }));
      row.appendChild(act);
      rows.appendChild(row);
    });

    var criteriaCard = Screens.card({
      title: 'Criteria Module',
      badge: '<span class="badge badge-info">Step 4 of ' + Store.STEPS.length + '</span>',
      actions: [
        UI.btn('Column Mapping', 'btn-secondary btn-sm', function () { Screens.columnMapDrawer(a); }, { icon: 'table', iconSize: 14 }),
        UI.btn('Test Criteria', 'btn-secondary btn-sm', function () { Screens.testCriteria(a); }, { icon: 'play', iconSize: 14 }),
        UI.btn('Execute Processing', 'btn-primary btn-sm', function () { Screens.executeProcessing(a); }, { icon: 'bolt', iconSize: 14 })
      ],
      flush: true, body: rows
    });
    criteriaCard.classList.add('mt4');
    body.appendChild(criteriaCard);

    /* processing flow reminder */
    body.appendChild(el('div', {
      class: 'flow mt4',
      html: '<div class="flow-node">CSV<span class="fs">' + Store.filesOf(a).length + ' file(s) · ' +
        U.fmtInt(Store.counts(a).inScope) + ' rows</span></div>' +
        '<div class="flow-arrow">' + U.icon('chevronDown', 18) + '</div>' +
        '<div class="flow-node">ROW PARSER<span class="fs">row by row</span></div>' +
        '<div class="flow-arrow">' + U.icon('chevronDown', 18) + '</div>' +
        '<div class="flow-node k">CRITERIA MODULE<span class="fs">' +
        list.filter(function (c) { return c.enabled; }).length + ' criteria · v' + esc(assay.criteriaVersion) + '</span></div>' +
        '<div class="flow-arrow">' + U.icon('chevronDown', 18) + '</div>' +
        '<div class="flow-split"><div class="flow-node p">PASS<span class="fs">processed output</span></div>' +
        '<div class="flow-node c">FAIL<span class="fs">exceptions report</span></div></div>'
    }));

    if (qc.ran) {
      var pc = Screens.card({
        title: 'Processing status',
        actions: [UI.btn('Open processing', 'btn-secondary btn-sm', function () { App.go('analytic/' + a.id + '/processing'); }, { icon: 'arrowRight', iconSize: 14 })],
        body: Screens.processingSummary(a, qc)
      });
      pc.classList.add('mt4');
      body.appendChild(pc);
    }

    return Screens.workflowShell(a, 'criteria', body);
  };

  Screens.processingSummary = function (a, qc) {
    qc = qc || Store.criteriaQCStatus(a);
    var wrap = el('div', {});
    wrap.innerHTML =
      '<div class="grid g4">' +
      UI.metric('Calibrators', U.fmtInt(qc.calibrator.total - qc.calibrator.failed) + ' / ' + U.fmtInt(qc.calibrator.total) + ' passed',
        qc.calibrator.failed ? 'red' : 'green') +
      UI.metric('Controls', U.fmtInt(qc.control.total - qc.control.failed) + ' / ' + U.fmtInt(qc.control.total) + ' passed',
        qc.control.failed ? 'red' : 'green') +
      UI.metric('Patient rows failed', U.fmtInt(qc.patient.failed), qc.patient.failed ? 'amber' : 'green') +
      UI.metric('Patient warnings', U.fmtInt(qc.patient.warnings), '') +
      '</div>';
    if (!qc.passed) {
      var why = qc.calibrator.failed || qc.control.failed
        ? 'Calibrator / control criteria failed — patient results are held until the batch is corrected and re-processed.'
        : qc.stale ? 'Configuration changed since processing — re-run to release patient results.'
          : 'Not every uploaded file has been processed yet.';
      wrap.appendChild(el('div', {
        class: 'alert alert-danger mt4',
        html: U.icon('lock', 17) + '<div><div class="alert-t">🔒 Patient results held</div><p>' + esc(why) + '</p></div>'
      }));
    } else {
      wrap.appendChild(el('div', {
        class: 'alert alert-success mt4',
        html: U.icon('check', 17) + '<div><div class="alert-t">Batch acceptable — patient results released</div>' +
          '<p>Calibrator and control criteria passed on every processed file for criteria v' +
          esc(Store.assayOf(a).criteriaVersion) + '.</p></div>'
      }));
    }
    return wrap;
  };

  /* ============================================================
     CRITERION CONFIGURATION DRAWER
     ============================================================ */
  Screens.criterionDrawer = function (a, key) {
    var cfg = Store.criteriaOf(a).filter(function (c) { return c.key === key; })[0];
    var d = Criteria.def(key);
    if (!cfg || !d) return;
    var ctx = Store.criteriaContext(a);
    var body = el('div', {});
    var draft = U.clone(cfg);

    body.appendChild(el('p', { style: 'font-size:13px;color:var(--ink-2);line-height:1.6', text: d.description }));
    body.appendChild(el('div', {
      class: 'formula-help mt3',
      html: '<strong>Calculation:</strong> ' + esc(d.calculation)
    }));

    var streamInfo = UI.fieldGroup({
      label: 'Sample Type / stream', value: U.titleCase(d.stream), disabled: true,
      hint: 'Fixed by the criterion — it only inspects this sample stream.'
    });
    var colSel = UI.fieldGroup({
      label: 'Column (' + Criteria.roleLabel(cfg.role) + ')', type: 'select',
      value: ctx.map[cfg.role] || '',
      options: [{ value: '', label: '— not mapped —' }].concat(a.fields.map(function (f) {
        return { value: f.name, label: f.name + ' (' + f.type + ')' };
      })),
      hint: 'Read from the uploaded files — re-point it if your export names the column differently.'
    });

    var opSel = null, thr = null;
    var fixedOperator = ['ion_ratio', 'calibration_range'].indexOf(key) > -1;
    if (!fixedOperator) {
      opSel = UI.fieldGroup({
        label: 'Operator', type: 'select', value: draft.operator,
        options: Criteria.OPERATORS.filter(function (o) { return o.test; }).map(function (o) {
          return { value: o.key, label: o.label + '  (' + o.symbol + ')' };
        }),
        onChange: function () { draft.operator = opSel.input.value; }
      });
    }
    if (key !== 'concentration_cutoff' && key !== 'ion_ratio' && key !== 'calibration_range') {
      thr = UI.fieldGroup({
        label: 'Threshold', type: 'number', step: 'any', value: draft.threshold, suffix: draft.unit || '',
        onInput: function () { draft.threshold = thr.input.value; }
      });
    }

    var extras = el('div', {});
    if (key === 'internal_standard') {
      extras.appendChild(el('p', { class: 'eyebrow mb3 mt4', text: 'Internal standard checks' }));
      extras.appendChild(UI.switchToggle('Flag missing internal standard (no peak / blank / "----")',
        draft.checkMissing !== false, function (v) { draft.checkMissing = v; }));
      extras.appendChild(el('div', { class: 'mt3' }, UI.switchToggle('Flag suppressed internal standard',
        draft.checkSuppression !== false, function (v) { draft.checkSuppression = v; })));
      extras.appendChild(el('p', {
        class: 'hint mt2',
        text: 'Suppression compares % Recovery with Average % Recovery. When those columns are absent, the batch mean ISTD area is used instead.'
      }));
    }
    if (key === 'concentration_cutoff') {
      extras.appendChild(el('div', {
        class: 'alert alert-info mt4',
        html: U.icon('info', 16) + '<div><div class="alert-t">Cut-off comes from the analyte configuration</div>' +
          '<p>Currently ' + (ctx.derived.cutoff === null || isNaN(ctx.derived.cutoff) ? 'not derivable' :
            U.fmtNum(ctx.derived.cutoff, 4) + ' ng/mL — ' + esc(ctx.derived.cutoffSource || '')) +
          '. Any patient concentration below it is reported as 0.</p></div>'
      }));
      var cfgBtn = UI.btn('Open Analyte Configuration', 'btn-secondary btn-sm', function () {
        UI.closeDrawer(); App.go('analytic/' + a.id + '/config');
      }, { icon: 'settings', iconSize: 13 });
      extras.appendChild(el('div', { class: 'mt3' }, cfgBtn));
    }
    if (key === 'ion_ratio') {
      extras.appendChild(el('div', {
        class: 'alert alert-info mt4',
        html: U.icon('info', 16) + '<div><div class="alert-t">Range derived from the calibrators</div>' +
          '<p>' + esc(ctx.derived.ionRatioBasis || 'No calibrator ratios available yet') + '. The widening percentage is the ' +
          'analyte’s Reference Ratio Adjustment (' + esc(Store.assayOf(a).referenceRatioAdjustment) + '%).</p></div>'
      }));
      extras.appendChild(el('div', { class: 'mt3' }, UI.switchToggle('Report concentration as 0 when the ion ratio fails',
        draft.zeroToCutoff !== false, function (v) { draft.zeroToCutoff = v; })));
    }
    if (key === 'calibration_range') {
      extras.appendChild(el('div', { class: 'form-grid mt4' }, [UI.fieldGroup({
        label: 'Severity', type: 'select', value: draft.severity,
        options: [{ value: 'warning', label: 'Warning — flag but keep the result' }, { value: 'fail', label: 'Fail — exclude the result' }],
        onChange: function (e) { draft.severity = e.target.value; }
      })]));
      extras.appendChild(el('p', {
        class: 'hint mt2',
        text: 'Range: ' + (ctx.derived.calibrationRange
          ? U.fmtNum(ctx.derived.calibrationRange[0], 4) + ' – ' + U.fmtNum(ctx.derived.calibrationRange[1], 4) + ' ng/mL'
          : 'not derivable yet')
      }));
    }

    body.appendChild(el('div', { class: 'form-grid two mt4' },
      [streamInfo, colSel].concat(opSel ? [opSel] : []).concat(thr ? [thr] : [])));
    body.appendChild(extras);
    body.appendChild(el('div', { class: 'mt4' }, UI.switchToggle('Criterion enabled', draft.enabled, function (v) { draft.enabled = v; })));

    var d2 = UI.drawer({
      eyebrow: 'Criteria Module', title: d.name, wide: true, body: body,
      footer: [
        el('div', { class: 'left' }, [UI.btn('Cancel', 'btn-ghost', function () { d2.close(); })]),
        UI.btn('Save', 'btn-primary', function () {
          if (thr && (thr.input.value === '' || isNaN(parseFloat(thr.input.value)))) {
            thr.setError('Enter a numeric threshold'); return;
          }
          if (thr) draft.threshold = parseFloat(thr.input.value);
          if (colSel.input.value !== (ctx.map[cfg.role] || '')) {
            Store.setColumnRole(a, cfg.role, colSel.input.value || null);
          }
          Store.saveCriterion(a, key, {
            enabled: draft.enabled, operator: draft.operator, threshold: draft.threshold,
            severity: draft.severity, checkMissing: draft.checkMissing,
            checkSuppression: draft.checkSuppression, zeroToCutoff: draft.zeroToCutoff
          });
          d2.close();
          UI.toast({ kind: 'success', title: 'Criterion saved', text: d.name + ' — criteria v' + Store.assayOf(a).criteriaVersion });
          App.render();
        }, { icon: 'check' })
      ]
    });
  };

  /* ============================================================
     COLUMN MAPPING DRAWER
     ============================================================ */
  Screens.columnMapDrawer = function (a) {
    var map = Store.columnMapOf(a);
    var body = el('div', {});
    body.innerHTML = UI.alertBox('info', 'Criteria read mapped columns',
      'Roles were auto-detected from the uploaded files. Re-point any role if your instrument export uses different column names — ' +
      'the criteria themselves never assume a column name.');
    var grid = el('div', { class: 'form-grid two mt4' });
    var pending = {};
    Criteria.ROLES.forEach(function (role) {
      var g = UI.fieldGroup({
        label: role.label, type: 'select', value: map[role.key] || '',
        options: [{ value: '', label: '— not mapped —' }].concat(a.fields.map(function (f) {
          return { value: f.name, label: f.name + ' (' + f.type + ')' };
        })),
        hint: role.type === 'number' ? 'Numeric column expected' : 'Text column expected',
        onChange: function () { pending[role.key] = g.input.value; }
      });
      grid.appendChild(g);
    });
    body.appendChild(grid);
    var d = UI.drawer({
      eyebrow: 'Criteria Module', title: 'Column mapping', wide: true, body: body,
      footer: [
        el('div', { class: 'left' }, [UI.btn('Cancel', 'btn-ghost', function () { d.close(); })]),
        UI.btn('Save mapping', 'btn-primary', function () {
          var n = 0;
          Object.keys(pending).forEach(function (role) {
            if ((map[role] || '') !== pending[role]) { Store.setColumnRole(a, role, pending[role] || null); n++; }
          });
          d.close();
          UI.toast({
            kind: n ? 'success' : 'info',
            title: n ? n + ' mapping(s) updated' : 'No changes',
            text: n ? 'Criteria v' + Store.assayOf(a).criteriaVersion : 'Column mapping left unchanged.'
          });
          App.render();
        }, { icon: 'check' })
      ]
    });
  };

  /* ============================================================
     TEST CRITERIA (dry run)
     ============================================================ */
  Screens.testCriteria = function (a) {
    var enabled = Store.criteriaOf(a).filter(function (c) { return c.enabled; });
    if (!enabled.length) {
      UI.toast({ kind: 'error', title: 'No criteria enabled', text: 'Enable at least one criterion before testing.' });
      return;
    }
    var runner = UI.progressRunner({ title: 'Testing criteria against the uploaded rows' });
    var m = UI.modal({ title: 'Test Criteria', size: 'narrow', body: runner.body, autofocus: false });
    var total = Store.counts(a).inScope;
    UI.simulate({
      total: total || 1, duration: 1400,
      onTick: function (done, t, frac) {
        runner.set(frac, '<p class="muted" style="font-size:12.5px">Row ' + U.fmtInt(done) + ' of ' + U.fmtInt(total) +
          ' · applying ' + enabled.length + ' criteria…</p>');
      },
      onDone: function () {
        var res = Store.testCriteria(a);
        UI.closeModal();
        showCriteriaResult(a, res, false);
      }
    });
  };

  function showCriteriaResult(a, res, executed) {
    var body = el('div', {});
    var tiles = el('div', { class: 'result-tiles' });
    tiles.innerHTML =
      '<div class="rt total"><div class="rtk">Rows processed</div><div class="rtv">' + U.fmtInt(res.total) + '</div></div>' +
      '<div class="rt pass"><div class="rtk">✓ PASS</div><div class="rtv">' + U.fmtInt(res.passed) + '</div></div>' +
      '<div class="rt fail"><div class="rtk">✕ FAIL</div><div class="rtv">' + U.fmtInt(res.failed) + '</div></div>' +
      '<div class="rt warn"><div class="rtk">⚠ WARNING</div><div class="rtv">' + U.fmtInt(res.warnings) + '</div></div>';
    body.appendChild(tiles);
    if (res.transformed) {
      body.appendChild(el('div', {
        class: 'alert alert-info mt4',
        html: U.icon('info', 16) + '<div><div class="alert-t">' + U.fmtInt(res.transformed) +
          ' concentration(s) reported as 0</div><p>Values below the cut-off (or with a non-conforming ion ratio) are zeroed rather than failed.</p></div>'
      }));
    }

    var t = el('div', { class: 'table-scroll mt4' });
    t.innerHTML = '<table class="tbl compact"><thead><tr><th>Criterion</th><th>Stream</th><th class="num">Evaluated</th>' +
      '<th class="num">Failed</th><th class="num">Warning</th><th class="num">Zeroed</th><th class="num">Skipped</th></tr></thead><tbody>' +
      Object.keys(res.byCriterion).map(function (k) {
        var d = Criteria.def(k), s = res.byCriterion[k];
        return '<tr><td class="cell-strong">' + esc(d ? d.name : k) + '</td>' +
          '<td>' + UI.scopeBadges([d && d.stream === 'calibrator' ? 'calibration' : (d ? d.stream : '')]) + '</td>' +
          '<td class="num">' + U.fmtInt(s.evaluated) + '</td>' +
          '<td class="num">' + (s.failed ? '<span style="color:var(--red-700);font-weight:650">' + U.fmtInt(s.failed) + '</span>' : '0') + '</td>' +
          '<td class="num">' + U.fmtInt(s.warnings) + '</td>' +
          '<td class="num">' + U.fmtInt(s.transformed) + '</td>' +
          '<td class="num">' + U.fmtInt(s.skipped) + '</td></tr>';
      }).join('') + '</tbody></table>';
    body.appendChild(t);

    if (res.notMapped && res.notMapped.length) {
      body.appendChild(el('div', {
        class: 'alert alert-warn mt4',
        html: U.icon('warning', 16) + '<div><div class="alert-t">' + res.notMapped.length +
          ' criterion(s) skipped — column not mapped</div><p>' +
          res.notMapped.map(function (k) { var d = Criteria.def(k); return esc(d ? d.name : k); }).join(', ') +
          '</p></div>'
      }));
    }

    var m = UI.modal({
      title: executed ? 'Processing complete' : 'Criteria test results', size: 'wide', body: body, autofocus: false,
      footer: [
        UI.btn('Close', 'btn-secondary', function () { m.close(); App.render(); }),
        executed
          ? UI.btn('Open processing results', 'btn-primary', function () { m.close(); App.go('analytic/' + a.id + '/processing'); }, { icon: 'arrowRight' })
          : UI.btn('Execute Processing', 'btn-primary', function () { m.close(); Screens.executeProcessing(a); }, { icon: 'bolt' })
      ]
    });
  }

  /* ============================================================
     EXECUTE PROCESSING
     ============================================================ */
  Screens.executeProcessing = function (a) {
    var files = Store.filesOf(a);
    if (!files.length) { UI.toast({ kind: 'error', title: 'No files to process' }); return; }
    var enabled = Store.criteriaOf(a).filter(function (c) { return c.enabled; });
    if (!enabled.length) { UI.toast({ kind: 'error', title: 'No criteria enabled' }); return; }

    var body = el('div', {});
    var lines = el('div', {});
    body.appendChild(el('p', { class: 'eyebrow', text: 'Executing criteria v' + Store.assayOf(a).criteriaVersion }));
    body.appendChild(lines);
    var track = el('div', { class: 'progress lg mt4' }, [el('div', { class: 'bar', style: 'width:0%' })]);
    body.appendChild(track);
    var m = UI.modal({ title: 'Execute Processing', size: 'narrow', body: body, autofocus: false });

    UI.simulate({
      total: files.length, duration: 400 + files.length * 500,
      onTick: function (done, t, frac) {
        U.$('.bar', track).style.width = Math.round(frac * 100) + '%';
        lines.innerHTML = files.map(function (f, i) {
          var state = i < done ? 'ok' : (i === done ? '' : 'idle');
          return '<div class="run-line"><span class="run-ico ' + (state === 'ok' ? 'ok' : '') + '">' +
            (state === 'ok' ? '✓' : '·') + '</span><span class="run-t">' + esc(f.name) + '</span>' +
            '<span class="run-v">' + (i < done ? U.fmtInt(f.recordCount) + ' rows' : i === done ? 'processing…' : 'queued') + '</span></div>';
        }).join('');
      },
      onDone: function () {
        var out = Store.processAllFiles(a);
        var agg = { total: 0, passed: 0, failed: 0, warnings: 0, transformed: 0, byCriterion: {}, notMapped: [] };
        out.runs.forEach(function (r) {
          agg.total += r.total; agg.passed += r.passed; agg.failed += r.failed;
          agg.warnings += r.warnings; agg.transformed += r.transformed;
          Object.keys(r.byCriterion).forEach(function (k) {
            var s = agg.byCriterion[k] = agg.byCriterion[k] || { evaluated: 0, failed: 0, warnings: 0, transformed: 0, skipped: 0 };
            ['evaluated', 'failed', 'warnings', 'transformed', 'skipped'].forEach(function (f) { s[f] += r.byCriterion[k][f]; });
          });
          (r.notMapped || []).forEach(function (k) { if (agg.notMapped.indexOf(k) === -1) agg.notMapped.push(k); });
        });
        setTimeout(function () {
          UI.closeModal();
          var qc = Store.criteriaQCStatus(a);
          UI.toast({
            kind: qc.passed ? 'success' : 'warn',
            title: 'Processing complete — ' + out.runs.length + ' file(s)',
            text: U.fmtInt(agg.passed) + ' passed · ' + U.fmtInt(agg.failed) + ' failed · ' +
              U.fmtInt(agg.warnings) + ' warning(s)' + (qc.passed ? '' : ' — patient results held')
          });
          showCriteriaResult(a, agg, true);
        }, 250);
      }
    });
  };

  /* ============================================================
     PROCESSING RESULTS (per file + rows)
     ============================================================ */
  Screens.processing = function (a, params) {
    if (!Store.hasData(a)) return Screens.needFile(a);
    var qc = Store.criteriaQCStatus(a);
    var files = Store.filesOf(a);
    var body = el('div', {});

    if (!qc.ran) {
      body.appendChild(Screens.card({
        body: UI.emptyState({
          icon: 'bolt', title: 'No processing run yet',
          desc: 'Execute the criteria module to process every uploaded file row by row and produce the passed file and exceptions report.',
          actions: [
            UI.btn('Execute Processing', 'btn-primary', function () { Screens.executeProcessing(a); }, { icon: 'bolt' }),
            UI.btn('Criteria Module', 'btn-secondary', function () { App.go('analytic/' + a.id + '/criteria'); }, { icon: 'rules' })
          ]
        })
      }));
      return Screens.workflowShell(a, 'criteria', body);
    }

    body.appendChild(Screens.card({ title: 'Batch acceptability', body: Screens.processingSummary(a, qc) }));

    /* per-file table */
    var rows = files.map(function (f) { return { file: f, run: Store.runOf(a, f.id) }; });
    var table = UI.dataTable({
      title: 'Processed files', rows: rows, unit: 'files', pageSize: 25, compact: true, searchable: false,
      columns: [
        {
          key: 'name', label: 'File', value: function (r) { return r.file.name; },
          render: function (r) {
            return '<span class="cell-strong">' + esc(r.file.name) + '</span><div class="cell-sub">' +
              U.fmtInt(r.file.recordCount) + ' rows · ' + U.fmtBytes(r.file.size) + '</div>';
          }
        },
        {
          key: 'status', label: 'Status', value: function (r) { return r.run ? r.run.status : 'pending'; },
          render: function (r) {
            if (!r.run) return '<span class="badge badge-neutral">Uploaded</span>';
            if (r.run.status === 'stale') return '<span class="badge badge-warn">Re-process required</span>';
            return '<span class="badge badge-success">Completed</span>';
          }
        },
        { key: 'crit', label: 'Criteria', render: function (r) { return r.run ? 'v' + esc(r.run.criteriaVersion) : '—'; } },
        { key: 'total', label: 'Rows', align: 'right', value: function (r) { return r.run ? r.run.total : 0; }, render: function (r) { return r.run ? U.fmtInt(r.run.total) : '—'; } },
        { key: 'passed', label: 'Passed', align: 'right', value: function (r) { return r.run ? r.run.passed : -1; }, render: function (r) { return r.run ? '<span style="color:var(--green-700);font-weight:650">' + U.fmtInt(r.run.passed) + '</span>' : '—'; } },
        { key: 'failed', label: 'Failed', align: 'right', value: function (r) { return r.run ? r.run.failed : -1; }, render: function (r) { return r.run ? '<span style="color:var(--red-700);font-weight:650">' + U.fmtInt(r.run.failed) + '</span>' : '—'; } },
        { key: 'warn', label: 'Warnings', align: 'right', value: function (r) { return r.run ? r.run.warnings : -1; }, render: function (r) { return r.run ? U.fmtInt(r.run.warnings) : '—'; } },
        { key: 'zeroed', label: 'Zeroed', align: 'right', value: function (r) { return r.run ? r.run.transformed : -1; }, render: function (r) { return r.run ? U.fmtInt(r.run.transformed) : '—'; } },
        {
          key: 'actions', label: '', sortable: false, render: function (r) {
            var box = el('div', { class: 'tbl-actions' });
            box.appendChild(UI.btn('Details', 'btn-secondary btn-xs', function () { Screens.fileDetails(a, r.file.id); }));
            return box;
          }
        }
      ],
      onRow: function (r) { Screens.fileDetails(a, r.file.id); },
      toolbar: [UI.btn('Re-process all', 'btn-secondary btn-sm', function () { Screens.executeProcessing(a); }, { icon: 'refresh', iconSize: 14 })]
    });
    var tc = Screens.card({ flush: true, body: table });
    tc.classList.add('mt4');
    body.appendChild(tc);

    /* all exception rows across files */
    var exRows = [];
    files.forEach(function (f) {
      var run = Store.runOf(a, f.id);
      if (!run) return;
      var recs = Store.recordsOf(a);
      (run.rows || []).forEach(function (r) {
        var issues = (r.failures || []).concat(r.warnings || []);
        if (!issues.length) return;
        var rec = recs[r.i] || {};
        issues.forEach(function (issue) {
          exRows.push({
            file: f.name, record: rec, status: r.status, stream: issue.stream,
            criterion: issue.name, column: issue.column, reason: issue.reason,
            severity: (r.failures || []).indexOf(issue) > -1 ? 'fail' : 'warning', i: r.i
          });
        });
      });
    });

    if (exRows.length) {
      var idField = Store.columnMapOf(a).sampleId || Screens.pickIdField(a);
      var exTable = UI.dataTable({
        title: 'Exceptions', rows: exRows, unit: 'exceptions', pageSize: 15, compact: true,
        searchPlaceholder: 'Search sample, criterion or reason…',
        searchText: function (r) { return [r.record[idField], r.criterion, r.reason, r.file, r.stream].join(' '); },
        filters: [
          { key: 'all', label: 'All', count: exRows.length },
          { key: 'fail', label: 'Failures', count: exRows.filter(function (r) { return r.severity === 'fail'; }).length, test: function (r) { return r.severity === 'fail'; } },
          { key: 'warn', label: 'Warnings', count: exRows.filter(function (r) { return r.severity === 'warning'; }).length, test: function (r) { return r.severity === 'warning'; } },
          { key: 'cal', label: 'Calibrators', count: exRows.filter(function (r) { return r.stream === 'calibrator'; }).length, test: function (r) { return r.stream === 'calibrator'; } },
          { key: 'ctl', label: 'Controls', count: exRows.filter(function (r) { return r.stream === 'control'; }).length, test: function (r) { return r.stream === 'control'; } },
          { key: 'pat', label: 'Patients', count: exRows.filter(function (r) { return r.stream === 'patient'; }).length, test: function (r) { return r.stream === 'patient'; } }
        ],
        rowClass: function (r) { return r.severity === 'fail' ? 'row-fail' : 'row-warn'; },
        columns: [
          { key: 'sample', label: idField || 'Sample', value: function (r) { return r.record[idField]; }, render: function (r) { return '<span class="cell-strong">' + esc(r.record[idField] || '—') + '</span>'; } },
          { key: 'stream', label: 'Stream', value: function (r) { return r.stream; }, render: function (r) { return UI.scopeBadges([r.stream === 'calibrator' ? 'calibration' : r.stream]); } },
          { key: 'criterion', label: 'Criterion', value: function (r) { return r.criterion; } },
          { key: 'column', label: 'Column', value: function (r) { return r.column; } },
          { key: 'reason', label: 'Reason', render: function (r) { return '<span class="cell-sub">' + esc(r.reason) + '</span>'; }, value: function (r) { return r.reason; } },
          { key: 'file', label: 'Source File', render: function (r) { return '<span class="cell-sub">' + esc(r.file) + '</span>'; }, value: function (r) { return r.file; } }
        ]
      });
      var ec = Screens.card({ flush: true, body: exTable });
      ec.classList.add('mt4');
      body.appendChild(ec);
    }

    return Screens.workflowShell(a, 'criteria', body);
  };

  /* ============================================================
     FILE DETAILS DRAWER
     ============================================================ */
  Screens.fileDetails = function (a, fileId) {
    var f = Store.filesOf(a).filter(function (x) { return x.id === fileId; })[0];
    if (!f) return;
    var run = Store.runOf(a, fileId);
    var assay = Store.assayOf(a);
    var ctx = Store.criteriaContext(a, fileId);
    var body = el('div', {});

    /* metadata */
    var kv = el('dl', { class: 'kv' });
    var meta = [
      ['File Name', f.name],
      ['File ID', f.id],
      ['Analyte', assay.analyteName || a.name],
      ['Assay', assay.assayName || a.name],
      ['Upload Date/Time', U.fmtDateTime(f.uploadedAt)],
      ['Uploaded By', (Store.S.user && Store.S.user.name) || 'Admin User'],
      ['File Size', U.fmtBytes(f.size)],
      ['Number of Rows', U.fmtInt(f.recordCount)],
      ['Number of Columns', U.fmtInt(f.columnCount)],
      ['Processing Status', run ? (run.status === 'stale' ? 'Re-process required' : U.titleCase(run.status)) : 'Uploaded — not processed'],
      ['Validation Status', run
        ? (run.failed ? run.failed + ' row(s) failed' : 'All rows acceptable')
        : 'Pending'],
      ['Criteria Version', 'v' + (run ? run.criteriaVersion : assay.criteriaVersion)],
      ['Processing Start Time', run ? U.fmtDateTime(run.startedAt) : '—'],
      ['Processing Completion Time', run ? U.fmtDateTime(run.completedAt) : '—'],
      ['Processed By', run ? run.processedBy : '—']
    ];
    kv.innerHTML = meta.map(function (m) {
      return '<dt>' + esc(m[0]) + '</dt><dd>' + esc(String(m[1])) + '</dd>';
    }).join('');
    body.appendChild(kv);

    /* sample classification for this file */
    var cls = el('div', { class: 'mt5' });
    cls.appendChild(el('p', { class: 'eyebrow mb3', text: 'Sample classification' }));
    var s = ctx.streams;
    var clsTiles = el('div', { class: 'grid g2' });
    clsTiles.innerHTML =
      UI.metric('Calibrators', U.fmtInt(s.calibrator.length)) +
      UI.metric('Controls', U.fmtInt(s.control.length)) +
      UI.metric('Patient Samples', U.fmtInt(s.patient.length)) +
      UI.metric('Total', U.fmtInt(f.recordCount), 'blue');
    cls.appendChild(clsTiles);
    if (s.unmatched.length) {
      cls.appendChild(el('p', { class: 'hint mt2', text: U.fmtInt(s.unmatched.length) + ' row(s) did not match any sample-stream pattern.' }));
    }
    body.appendChild(cls);

    /* results */
    if (run) {
      var res = el('div', { class: 'mt5' });
      res.appendChild(el('p', { class: 'eyebrow mb3', text: 'Results' }));
      var pct = function (n) { return run.total ? ' (' + U.fmtPct(n / run.total * 100) + ')' : ''; };
      var rt = el('div', { class: 'table-scroll' });
      rt.innerHTML = '<table class="tbl compact" style="min-width:0"><tbody>' +
        '<tr><td>Total Rows</td><td class="num cell-strong">' + U.fmtInt(run.total) + '</td></tr>' +
        '<tr><td>Passed</td><td class="num" style="color:var(--green-700);font-weight:650">' + U.fmtInt(run.passed) + pct(run.passed) + '</td></tr>' +
        '<tr><td>Failed</td><td class="num" style="color:var(--red-700);font-weight:650">' + U.fmtInt(run.failed) + pct(run.failed) + '</td></tr>' +
        '<tr><td>Warnings</td><td class="num" style="color:var(--amber-700);font-weight:650">' + U.fmtInt(run.warnings) + '</td></tr>' +
        '<tr><td>Concentrations zeroed (below cut-off / ion ratio)</td><td class="num">' + U.fmtInt(run.transformed) + '</td></tr>' +
        '</tbody></table>';
      res.appendChild(rt);
      body.appendChild(res);

      /* derived values used for this file */
      var dv = el('div', { class: 'mt5' });
      dv.appendChild(el('p', { class: 'eyebrow mb3', text: 'Values derived for this run' }));
      dv.innerHTML += '<dl class="kv">' +
        '<dt>Cut-off</dt><dd>' + (run.derived.cutoff === null || isNaN(run.derived.cutoff) ? '—' : U.fmtNum(run.derived.cutoff, 4) + ' ng/mL') + '</dd>' +
        '<dt>Ion-ratio range</dt><dd>' + (run.derived.ionRatioRange ? U.fmtNum(run.derived.ionRatioRange[0], 2) + ' – ' + U.fmtNum(run.derived.ionRatioRange[1], 2) : '—') + '</dd>' +
        '<dt>RT window</dt><dd>' + (run.derived.rtWindow ? U.fmtNum(run.derived.rtWindow[0], 3) + ' – ' + U.fmtNum(run.derived.rtWindow[1], 3) : '—') + '</dd>' +
        '<dt>Calibrated range</dt><dd>' + (run.derived.calibrationRange ? U.fmtNum(run.derived.calibrationRange[0], 4) + ' – ' + U.fmtNum(run.derived.calibrationRange[1], 4) + ' ng/mL' : '—') + '</dd>' +
        '</dl>';
      body.appendChild(dv);

      /* per-criterion breakdown */
      var cb = el('div', { class: 'mt5' });
      cb.appendChild(el('p', { class: 'eyebrow mb3', text: 'Criteria outcome' }));
      var ct = el('div', { class: 'table-scroll' });
      ct.innerHTML = '<table class="tbl compact"><thead><tr><th>Criterion</th><th class="num">Evaluated</th>' +
        '<th class="num">Failed</th><th class="num">Warning</th><th class="num">Zeroed</th></tr></thead><tbody>' +
        Object.keys(run.byCriterion).map(function (k) {
          var d = Criteria.def(k), x = run.byCriterion[k];
          return '<tr><td>' + esc(d ? d.name : k) + '</td><td class="num">' + U.fmtInt(x.evaluated) + '</td>' +
            '<td class="num">' + U.fmtInt(x.failed) + '</td><td class="num">' + U.fmtInt(x.warnings) + '</td>' +
            '<td class="num">' + U.fmtInt(x.transformed) + '</td></tr>';
        }).join('') + '</tbody></table>';
      cb.appendChild(ct);
      body.appendChild(cb);

      if (run.status === 'stale') {
        body.appendChild(el('div', {
          class: 'alert alert-warn mt5',
          html: U.icon('warning', 16) + '<div><div class="alert-t">Outputs are out of date</div>' +
            '<p>' + esc(run.staleReason || 'Configuration changed after processing') +
            '. Re-process this file to regenerate the outputs on criteria v' + esc(assay.criteriaVersion) + '.</p></div>'
        }));
      }
    } else {
      body.appendChild(el('div', {
        class: 'alert alert-info mt5',
        html: U.icon('info', 16) + '<div><div class="alert-t">Not processed yet</div>' +
          '<p>Run the criteria module to produce results and outputs for this file.</p></div>'
      }));
    }

    /* outputs */
    var outs = el('div', { class: 'mt5' });
    outs.appendChild(el('p', { class: 'eyebrow mb3', text: 'Output' }));
    var qc = Store.criteriaQCStatus(a);
    var btnRow = el('div', { class: 'row' });
    var passedBtn = UI.btn('Download Passed File', 'btn-primary', function () {
      var out = Store.passedOutput(a, fileId);
      if (!out || !out.rows.length) { UI.toast({ kind: 'info', title: 'Nothing to export', text: 'No passing rows in this file.' }); return; }
      var name = outName(a, f, 'Passed');
      U.downloadText(name, U.toCSV(out.columns, out.rows));
      Store.audit(a, { action: 'Passed file downloaded', detail: name + ' — ' + U.fmtInt(out.rows.length) + ' rows', kind: 'info' });
      UI.toast({ kind: 'success', title: 'Passed file exported', text: name + ' · ' + U.fmtInt(out.rows.length) + ' rows' });
    }, { icon: 'download', disabled: !run || !qc.passed });
    var exBtn = UI.btn('Download Exceptions Report', 'btn-secondary', function () {
      var out = Store.exceptionsOutput(a, fileId);
      if (!out || !out.rows.length) { UI.toast({ kind: 'info', title: 'No exceptions', text: 'Every row in this file passed.' }); return; }
      var name = outName(a, f, 'Exceptions');
      U.downloadText(name, U.toCSV(out.columns, out.rows));
      Store.audit(a, { action: 'Exceptions report downloaded', detail: name + ' — ' + U.fmtInt(out.rows.length) + ' exception row(s)', kind: 'info' });
      UI.toast({ kind: 'success', title: 'Exceptions report exported', text: name + ' · ' + U.fmtInt(out.rows.length) + ' row(s)' });
    }, { icon: 'download', disabled: !run });
    btnRow.appendChild(passedBtn);
    btnRow.appendChild(exBtn);
    outs.appendChild(btnRow);
    if (run && !qc.passed) {
      outs.appendChild(el('p', {
        class: 'hint mt2',
        text: 'The passed file is held until calibrator and control criteria pass on every processed file — the exceptions report is always available.'
      }));
    }
    body.appendChild(outs);

    var d = UI.drawer({
      eyebrow: 'File Details', title: f.name, wide: true, body: body,
      footer: [
        el('div', { class: 'left' }, [
          UI.btn('Close', 'btn-ghost', function () { d.close(); }),
          UI.btn('Preview rows', 'btn-secondary', function () {
            d.close(); App.go('analytic/' + a.id + '/preview?file=' + encodeURIComponent(f.id));
          }, { icon: 'table' })
        ]),
        UI.btn(run ? 'Re-process File' : 'Process File', 'btn-primary', function () {
          d.close();
          var runner = UI.progressRunner({ title: 'Processing ' + f.name });
          var m = UI.modal({ title: 'Processing file', size: 'narrow', body: runner.body, autofocus: false });
          UI.simulate({
            total: f.recordCount, duration: 1400,
            onTick: function (done, t, frac) {
              runner.set(frac, '<p class="muted" style="font-size:12.5px">Row ' + U.fmtInt(done) + ' of ' + U.fmtInt(t) + '…</p>');
            },
            onDone: function () {
              var r = Store.processFile(a, fileId);
              UI.closeModal();
              UI.toast({
                kind: r.failed ? 'warn' : 'success', title: 'Processed ' + f.name,
                text: U.fmtInt(r.passed) + ' passed · ' + U.fmtInt(r.failed) + ' failed · ' + U.fmtInt(r.warnings) + ' warning(s)'
              });
              App.render();
              Screens.fileDetails(a, fileId);
            }
          });
        }, { icon: 'bolt' })
      ]
    });
  };

  function outName(a, f, kind) {
    var assay = Store.assayOf(a);
    var base = (assay.analyteCode || a.code || a.name).replace(/[^A-Za-z0-9]+/g, '_');
    var file = f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_');
    return base + '_' + file + '_' + kind + '.csv';
  }
}(typeof window !== 'undefined' ? window : this));
