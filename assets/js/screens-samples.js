/* ============================================================
   screens-samples.js — record-level sample selection.

   Detection proposes which rows are calibrators and controls; this
   screen is where the user confirms or overrides that, row by row.
   Nothing here assumes Cal_1…Cal_7 or WCS1…WCS3 — those are only ever
   what the detector happened to find in THIS file.

   Patient records are never picked by hand: whatever is left after
   calibration, control and excluded rows IS the patient set.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;
  var Screens = global.Screens = global.Screens || {};

  var STREAMS = {
    calibration: {
      key: 'calibration', label: 'Calibration', plural: 'Calibration records',
      tone: 'violet', icon: 'beaker',
      hint: 'Standards used to establish the ion-ratio range, retention-time window and calibrated measuring range.'
    },
    control: {
      key: 'control', label: 'Control', plural: 'Control records',
      tone: 'info', icon: 'shield',
      hint: 'QC material used to verify accuracy before patient results are released.'
    }
  };

  /* ============================================================
     STEP SCREEN — Sample Configuration
     ============================================================ */
  Screens.samples = function (a) {
    if (!Store.hasData(a)) return Screens.needFile(a);
    var body = el('div', {});
    var sum = Store.sampleSelectionSummary(a);

    if (!a.classification.applied) {
      body.appendChild(Screens.card({
        title: 'Sample Configuration',
        body: UI.emptyState({
          icon: 'warning', title: 'Classify the samples first',
          desc: 'Detection needs a Sample ID or Sample Type column before individual records can be selected.',
          actions: [UI.btn('Go to Sample Types', 'btn-primary', function () {
            App.go('analytic/' + a.id + '/mapping');
          }, { icon: 'arrowRight' })]
        })
      }));
      return Screens.workflowShell(a, 'mapping', body);
    }

    body.appendChild(el('div', {
      class: 'alert alert-info',
      html: U.icon('info', 17) + '<div><div class="alert-t">Detected automatically, owned by you</div>' +
        '<p>The rows below were proposed from the Sample ID pattern and Sample Type value found in the uploaded files. ' +
        'Any row can be added to or removed from either stream — <strong>everything that is not calibration, control or ' +
        'excluded becomes a patient record</strong>. Changing a selection creates a new criteria version and re-locks patient testing.</p></div>'
    }));

    var grid = el('div', { class: 'grid g3 mt4' });
    grid.appendChild(streamCard(a, STREAMS.calibration, sum.calibration, sum.idColumn));
    grid.appendChild(streamCard(a, STREAMS.control, sum.control, sum.idColumn));
    grid.appendChild(patientCard(a, sum));
    body.appendChild(grid);

    if (sum.unmatched.count) {
      body.appendChild(Screens.card({
        title: 'Excluded rows',
        badge: '<span class="badge badge-neutral">' + U.fmtInt(sum.unmatched.count) + '</span>',
        body: el('div', {}, [
          el('p', {
            class: 'muted', style: 'font-size:12.5px',
            text: 'Blanks, double blanks and solvent injections match no stream and take part in no criterion. ' +
              'They can still be pulled into calibration or control if the run needs them.'
          }),
          el('div', { class: 'row mt3' }, [
            UI.btn('Review excluded rows', 'btn-secondary btn-sm', function () {
              Screens.sampleSelection(a, 'calibration', { filter: 'unmatched' });
            }, { icon: 'eye', iconSize: 14 })
          ])
        ])
      }));
    }

    if (sum.manual) {
      body.appendChild(el('div', {
        class: 'alert alert-warn mt4',
        html: U.icon('warning', 16) + '<div><div class="alert-t">' + U.fmtInt(sum.manual) +
          ' record(s) manually assigned</div><p>These rows override what detection proposed. ' +
          'Clearing the manual selection returns every row to the detected stream.</p></div>'
      }));
      var resetRow = el('div', { class: 'row mt3' });
      resetRow.appendChild(UI.btn('Clear manual selection', 'btn-ghost btn-sm', function () {
        UI.confirm({
          title: 'Clear manual selection?',
          message: 'All ' + sum.manual + ' manually assigned record(s) return to the detected stream. ' +
            'This creates a new criteria version and re-locks patient testing.',
          confirmLabel: 'Clear selection', danger: true
        }).then(function (ok) {
          if (!ok) return;
          Store.resetSampleSelection(a, 'Manual selection cleared from the Sample Configuration screen');
          UI.toast({ kind: 'success', title: 'Selection cleared' });
          App.render();
        });
      }, { icon: 'refresh', iconSize: 14 }));
      body.appendChild(resetRow);
    }

    /* min/max rule configuration, per stream */
    var ruleGrid = el('div', { class: 'grid g2 mt4' });
    ruleGrid.appendChild(streamRulesCard(a, STREAMS.calibration));
    ruleGrid.appendChild(streamRulesCard(a, STREAMS.control));
    body.appendChild(ruleGrid);

    /* QC preview — Test Calibration / Test Controls */
    body.appendChild(qcTestCard(a));

    /* patient-testing gate */
    body.appendChild(gatePanel(a));

    return Screens.workflowShell(a, 'samples', body);
  };

  /**
   * Patient validation is locked until calibration AND control pass on the
   * current criteria version (§15), and says plainly why (§16).
   */
  function gatePanel(a) {
    var gate = Store.streamGate(a);
    var wrap = el('div', { class: 'mt4' });

    if (gate.unlocked) {
      var ok = el('div', { class: 'lock-panel', style: 'border-color:#C3E9D3;background:var(--green-100)' });
      ok.innerHTML =
        '<p class="lock-t">✓ Calibration Passed &nbsp; ✓ Control Passed</p>' +
        '<p class="lock-d">Patient Validation <strong>🔓 READY</strong> — ' +
        U.fmtInt(gate.patientCount) + ' patient record(s) are eligible on criteria v' +
        esc(Store.assayOf(a).criteriaVersion) + '.</p>';
      var okRow = el('div', { class: 'row', style: 'justify-content:center' });
      okRow.appendChild(UI.btn('Start Patient Validation', 'btn-primary', function () {
        App.go('analytic/' + a.id + '/patient');
      }, { icon: 'arrowRight' }));
      ok.appendChild(okRow);
      wrap.appendChild(ok);
      return wrap;
    }

    var node = el('div', { class: 'lock-panel' });
    node.innerHTML =
      '<div class="lock-ico">' + U.icon('lock', 26) + '</div>' +
      '<p class="lock-t">🔒 Patient Validation Locked</p>' +
      '<p class="lock-d">' + esc(gate.blockers[0] || 'Calibration and control validation must pass first.') +
      ' Patient validation cannot begin until calibration and control validation are corrected and passed.</p>' +
      '<div class="lock-stats">' +
      '<div class="lock-stat' + (gate.calibration.state === 'failed' ? ' bad' : '') + '">' +
      '<div class="lk">Calibration</div><div class="lv">' + esc(gate.calibration.label) + '</div></div>' +
      '<div class="lock-stat' + (gate.control.state === 'failed' ? ' bad' : '') + '">' +
      '<div class="lk">Control</div><div class="lv">' + esc(gate.control.label) + '</div></div>' +
      '<div class="lock-stat"><div class="lk">Patient records</div><div class="lv">' + U.fmtInt(gate.patientCount) + '</div></div>' +
      '<div class="lock-stat"><div class="lk">Approval</div><div class="lv">' +
      (a.validation.approved ? 'Approved' : 'Pending') + '</div></div>' +
      '</div>';

    if (gate.blockers.length > 1) {
      var ul = el('ul', { style: 'margin:0 auto 14px;max-width:520px;text-align:left;font-size:12.5px;color:var(--ink-2);line-height:1.7' });
      gate.blockers.forEach(function (b) { ul.appendChild(el('li', { text: b })); });
      node.appendChild(ul);
    }

    var row = el('div', { class: 'row', style: 'justify-content:center' });
    if (gate.calibration.state !== 'passed') {
      row.appendChild(UI.btn('Go to Calibration', 'btn-primary', function () {
        Screens.streamTest(a, 'calibration');
      }, { icon: 'bolt' }));
    }
    if (gate.control.state !== 'passed') {
      row.appendChild(UI.btn('Go to Controls', 'btn-secondary', function () {
        Screens.streamTest(a, 'control');
      }, { icon: 'bolt' }));
    }
    if (gate.calibration.state === 'failed' || gate.control.state === 'failed') {
      row.appendChild(UI.btn('Edit Criteria', 'btn-secondary', function () {
        App.go('analytic/' + a.id + '/criteria');
      }, { icon: 'rules' }));
    }
    node.appendChild(row);
    wrap.appendChild(node);
    return wrap;
  }

  /** One summary card per selectable stream (§6). */
  function streamCard(a, def, info, idColumn) {
    var preview = info.ids.slice(0, 12);
    var listHtml = preview.length
      ? preview.map(function (v) { return '<span class="badge badge-neutral">' + esc(v) + '</span>'; }).join(' ') +
        (info.count > preview.length
          ? ' <span class="muted" style="font-size:12px">+' + U.fmtInt(info.count - preview.length) + ' more</span>' : '')
      : '<span class="muted">No records selected</span>';

    return Screens.card({
      title: def.label.toUpperCase(),
      badge: '<span class="badge badge-' + def.tone + '">' + U.fmtInt(info.count) + ' selected</span>',
      body: el('div', {}, [
        el('p', { class: 'muted', style: 'font-size:12.5px;line-height:1.55', text: def.hint }),
        el('div', {
          class: 'row mt3', style: 'gap:6px;flex-wrap:wrap',
          html: listHtml
        }),
        info.added
          ? el('p', {
            class: 'mt3', style: 'font-size:12px;color:var(--amber-700)',
            text: info.added + ' record(s) added manually'
          })
          : null,
        !info.count
          ? el('div', {
            class: 'alert alert-warn mt3',
            html: U.icon('warning', 15) + '<div><p>No ' + esc(def.label.toLowerCase()) +
              ' records — criteria that depend on this stream will be skipped.</p></div>'
          })
          : null
      ]),
      foot: [
        UI.btn('Edit Selection', 'btn-primary btn-sm', function () {
          Screens.sampleSelection(a, def.key);
        }, { icon: 'edit', iconSize: 14 }),
        idColumn
          ? null
          : el('span', { class: 'muted', style: 'font-size:11.5px', text: 'No Sample ID column mapped' })
      ]
    });
  }

  /** Patient records are the remainder — shown, never picked. */
  function patientCard(a, sum) {
    return Screens.card({
      title: 'PATIENT',
      badge: '<span class="badge badge-success">' + U.fmtInt(sum.patient.count) + ' records</span>',
      body: el('div', {}, [
        el('p', {
          class: 'muted', style: 'font-size:12.5px;line-height:1.55',
          text: 'Everything that is not a calibrator, a control or an excluded row. Patient records are never ' +
            'selected by hand — they follow automatically from the two selections beside this card.'
        }),
        el('div', { class: 'grid g2 mt3' }, [
          el('div', { html: UI.metric('In this analyte', U.fmtInt(sum.patient.count), 'blue') }),
          el('div', { html: UI.metric('Excluded', U.fmtInt(sum.unmatched.count)) })
        ])
      ]),
      foot: [
        UI.btn('View Patient Records', 'btn-secondary btn-sm', function () {
          Screens.patientRecordsDrawer(a);
        }, { icon: 'eye', iconSize: 14 })
      ]
    });
  }

  /** Test Calibration / Test Controls preview card (§12). */
  function qcTestCard(a) {
    var gate = Store.streamGate(a);
    var wrap = el('div', {});

    var tiles = el('div', { class: 'grid g2' });
    tiles.appendChild(gateTile(a, 'calibration', gate.calibration));
    tiles.appendChild(gateTile(a, 'control', gate.control));
    wrap.appendChild(tiles);

    var actions = el('div', { class: 'row mt4' });
    actions.appendChild(UI.btn('Test Calibration', 'btn-primary', function () {
      Screens.streamTest(a, 'calibration');
    }, { icon: 'bolt' }));
    actions.appendChild(UI.btn('Test Controls', 'btn-primary', function () {
      Screens.streamTest(a, 'control');
    }, { icon: 'bolt' }));
    if (gate.calibration.state === 'passed' && gate.control.state === 'passed') {
      actions.appendChild(UI.btn('Continue to Criteria', 'btn-secondary', function () {
        App.go('analytic/' + a.id + '/criteria');
      }, { icon: 'arrowRight' }));
    }
    wrap.appendChild(actions);

    return Screens.card({
      title: 'Validation Preview',
      badge: '<span class="badge badge-info">criteria v' + esc(Store.assayOf(a).criteriaVersion) + '</span>',
      body: wrap
    });
  }

  function gateTile(a, stream, st) {
    var tone = { passed: 'green', failed: 'red', stale: 'amber', untested: '', none: '' }[st.state] || '';
    var box = el('div', { class: 'card', style: 'margin:0' });
    var b = el('div', { class: 'card-body tight' });
    b.innerHTML =
      '<div class="row" style="justify-content:space-between">' +
      '<span class="eyebrow">' + esc(Store.streamLabel(stream)) + '</span>' +
      '<span class="badge ' + statusBadgeCls(st.state) + '">' + esc(st.label) + '</span></div>' +
      '<div class="mt3">' + UI.metric('Records', U.fmtInt(st.total), tone) + '</div>' +
      (st.state === 'failed'
        ? '<p class="mt3" style="font-size:12.5px;color:var(--red-700);font-weight:650">' +
          U.fmtInt(st.failed) + ' record(s) failed</p>'
        : st.state === 'passed'
          ? '<p class="mt3 muted" style="font-size:12px">Tested ' + esc(U.relTime(st.ranAt)) + '</p>'
          : '');
    box.appendChild(b);
    if (st.state === 'failed') {
      var f = el('div', { class: 'card-foot' });
      f.appendChild(UI.btn('View Failed Records', 'btn-secondary btn-sm', function () {
        Screens.streamFailures(a, stream);
      }, { icon: 'eye', iconSize: 14 }));
      box.appendChild(f);
    }
    return box;
  }
  function statusBadgeCls(state) {
    return {
      passed: 'badge-success', failed: 'badge-danger',
      stale: 'badge-warn', untested: 'badge-neutral', none: 'badge-neutral'
    }[state] || 'badge-neutral';
  }


  /* ============================================================
     STREAM RULE CONFIGURATION (STEP 5 / STEP 6)
     ============================================================ */
  /** Min/max rules for one stream, listed with add / edit / delete. */
  function streamRulesCard(a, def) {
    var rules = Store.streamRulesOf(a, def.key);
    var wrap = el('div', {});

    if (!rules.length) {
      wrap.appendChild(el('p', {
        class: 'muted', style: 'font-size:12.5px;line-height:1.6',
        text: 'No ' + def.label.toLowerCase() + ' rule configured yet. A rule picks one column and gives it a ' +
          'minimum and/or a maximum — every ' + def.label.toLowerCase() + ' record is then checked against it.'
      }));
    } else {
      var t = el('div', { class: 'table-scroll' });
      t.innerHTML = '<table class="tbl compact"><thead><tr><th>Field</th><th class="num">Minimum</th>' +
        '<th class="num">Maximum</th><th>Status</th><th></th></tr></thead><tbody>' +
        rules.map(function (r) {
          return '<tr data-rule="' + esc(r.id) + '">' +
            '<td class="cell-strong">' + esc(r.field || '— no column —') + '</td>' +
            '<td class="num mono">' + (r.min === null || r.min === '' ? '<span class="muted">—</span>' : esc(String(r.min))) + '</td>' +
            '<td class="num mono">' + (r.max === null || r.max === '' ? '<span class="muted">—</span>' : esc(String(r.max))) + '</td>' +
            '<td><span class="badge ' + (r.enabled === false ? 'badge-neutral' : 'badge-success') + '">' +
            (r.enabled === false ? 'OFF' : 'ON') + '</span></td>' +
            '<td class="act"></td></tr>';
        }).join('') + '</tbody></table>';
      U.$$('tr[data-rule]', t).forEach(function (tr) {
        var id = tr.dataset.rule;
        var cell = U.$('.act', tr);
        cell.appendChild(UI.iconBtn('edit', 'Edit rule', function () {
          Screens.streamRuleBuilder(a, def.key, id);
        }));
        cell.appendChild(UI.iconBtn('trash', 'Delete rule', function () {
          UI.confirm({
            title: 'Delete this rule?', danger: true, confirmLabel: 'Delete',
            message: 'The ' + def.label.toLowerCase() + ' records will no longer be checked against it.'
          }).then(function (ok) {
            if (!ok) return;
            Store.deleteStreamRule(a, def.key, id, '');
            UI.toast({ kind: 'info', title: 'Rule deleted' });
            App.render();
          });
        }));
      });
      wrap.appendChild(t);
    }

    var row = el('div', { class: 'row mt3' });
    row.appendChild(UI.btn('Add ' + def.label + ' Rule', 'btn-secondary btn-sm', function () {
      Screens.streamRuleBuilder(a, def.key, null);
    }, { icon: 'plus', iconSize: 14 }));
    row.appendChild(UI.btn('Test ' + def.label, 'btn-primary btn-sm', function () {
      Screens.streamTest(a, def.key);
    }, { icon: 'bolt', iconSize: 14 }));
    wrap.appendChild(row);

    return Screens.card({
      title: def.label + ' Rules',
      badge: '<span class="badge badge-' + def.tone + '">' + rules.length + ' rule' + (rules.length === 1 ? '' : 's') + '</span>',
      body: wrap
    });
  }

  /** Field + Minimum + Maximum. Limits are always editable, never hardcoded. */
  Screens.streamRuleBuilder = function (a, stream, ruleId) {
    var def = STREAMS[stream];
    var list = Store.streamRulesOf(a, stream);
    var existing = ruleId ? list.filter(function (r) { return r.id === ruleId; })[0] : null;
    var draft = existing ? U.clone(existing) : Store.suggestStreamRule(a, stream);

    var numericFields = (a.fields || []).filter(function (f) { return f.type === 'number'; });
    var fieldOptions = (numericFields.length ? numericFields : (a.fields || [])).map(function (f) {
      return { value: f.name, label: f.name };
    });

    var body = el('div', {});
    body.innerHTML = UI.alertBox('info', def.label + ' rule',
      'The record’s value in the chosen column must sit between the minimum and the maximum. ' +
      'Leave one blank to bound only the other side. Both limits are editable at any time.');

    var fieldSel = UI.fieldGroup({
      label: 'Field', type: 'select', value: draft.field || '',
      options: [{ value: '', label: '— select a column —' }].concat(fieldOptions),
      hint: 'Columns are read from the uploaded files, so this list follows whatever you uploaded.',
      onChange: function () { draft.field = fieldSel.input.value; refreshStats(); }
    });
    var minIn = UI.fieldGroup({
      label: 'Minimum Value', type: 'number', value: draft.min === null || draft.min === undefined ? '' : draft.min,
      placeholder: 'e.g. 32.66',
      onInput: function () { draft.min = minIn.input.value === '' ? null : parseFloat(minIn.input.value); refreshStats(); }
    });
    var maxIn = UI.fieldGroup({
      label: 'Maximum Value', type: 'number', value: draft.max === null || draft.max === undefined ? '' : draft.max,
      placeholder: 'e.g. 49.96',
      onInput: function () { draft.max = maxIn.input.value === '' ? null : parseFloat(maxIn.input.value); refreshStats(); }
    });

    body.appendChild(el('div', { class: 'form-grid mt4' }, [fieldSel]));
    body.appendChild(el('div', { class: 'form-grid two mt3' }, [minIn, maxIn]));

    var stats = el('div', { class: 'mt4' });
    body.appendChild(stats);

    function refreshStats() {
      var g = Store.groups(a);
      var list2 = stream === 'calibration' ? g.calibration : g.control;
      if (!draft.field || !list2.length) { stats.innerHTML = ''; return; }
      var vals = list2.map(function (r) { return U.toNumber(r[draft.field]); })
        .filter(function (v) { return !isNaN(v); });
      if (!vals.length) { stats.innerHTML = ''; return; }
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      var wouldFail = list2.filter(function (r) {
        return Store.checkStreamRule(r, draft).status === 'fail';
      }).length;
      stats.innerHTML =
        '<p class="eyebrow mb3">Against the ' + U.fmtInt(list2.length) + ' ' + esc(stream) + ' record(s) currently selected</p>' +
        '<div class="grid g3">' +
        UI.metric('Lowest value', U.fmtNum(lo, 3)) +
        UI.metric('Highest value', U.fmtNum(hi, 3)) +
        UI.metric('Would fail', U.fmtInt(wouldFail), wouldFail ? 'red' : 'green') +
        '</div>';
    }
    refreshStats();

    var m = UI.modal({
      title: (existing ? 'Edit' : 'Add') + ' ' + def.label.toLowerCase() + ' rule', size: 'wide', body: body,
      footer: [
        el('div', { class: 'left' }, [
          UI.btn('Use the values in this data', 'btn-ghost btn-sm', function () {
            var sug = Store.suggestStreamRule(a, stream);
            draft.field = sug.field; draft.min = sug.min; draft.max = sug.max;
            fieldSel.input.value = sug.field || '';
            minIn.input.value = sug.min === null ? '' : sug.min;
            maxIn.input.value = sug.max === null ? '' : sug.max;
            refreshStats();
          }, { icon: 'bolt', iconSize: 13 })
        ]),
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        UI.btn('Save ' + def.label + ' Rule', 'btn-primary', function () {
          if (!draft.field) { UI.toast({ kind: 'error', title: 'Select a field first' }); return; }
          var hasMin = draft.min !== null && draft.min !== '' && !isNaN(draft.min);
          var hasMax = draft.max !== null && draft.max !== '' && !isNaN(draft.max);
          if (!hasMin && !hasMax) {
            UI.toast({ kind: 'error', title: 'Set a limit', text: 'Enter a minimum, a maximum, or both.' });
            return;
          }
          if (hasMin && hasMax && parseFloat(draft.min) > parseFloat(draft.max)) {
            UI.toast({ kind: 'error', title: 'Minimum is above the maximum' });
            return;
          }
          if (draft.enabled === undefined) draft.enabled = true;
          Store.saveStreamRule(a, stream, draft, '');
          m.close();
          UI.toast({
            kind: 'success', title: def.label + ' rule saved',
            text: Store.describeStreamRule(draft) + ' · criteria v' + Store.assayOf(a).criteriaVersion
          });
          App.render();
        }, { icon: 'check' })
      ]
    });
  };

  /* ============================================================
     SELECTION TABLE (§4 / §5)
     ============================================================ */
  /**
   * Pick the records that make up one stream. Every in-scope row is listed —
   * the checkbox says "this row belongs to <stream>", regardless of what the
   * Sample ID looks like.
   */
  Screens.sampleSelection = function (a, stream, opts) {
    opts = opts || {};
    var def = STREAMS[stream];
    if (!def) return;

    var recs = Store.scopedRecords(a);
    if (!recs.length) {
      UI.toast({ kind: 'error', title: 'No records', text: 'Nothing is in scope for this analyte yet.' });
      return;
    }

    var map = Store.columnMapOf(a);
    var idCol = map.sampleId, typeCol = map.sampleType;
    var base = Store.baseStreamOf(a);
    var current = Store.groups(a);

    /* working copy of the selection — committed only on Save */
    var selected = {};
    current[stream].forEach(function (r) { selected[Store.rowKey(r)] = true; });

    /* which stream each row sits in right now, for the "currently" column */
    var nowIn = {};
    Store.STREAM_KEYS.forEach(function (k) {
      current[k].forEach(function (r) { nowIn[Store.rowKey(r)] = k; });
    });

    var body = el('div', {});
    body.innerHTML = UI.alertBox('info', 'Select ' + def.plural.toLowerCase(),
      def.hint + ' Tick any row to include it — the Sample ID naming is only a hint, not a rule.');

    var countBar = el('div', { class: 'row mt4', style: 'justify-content:space-between;align-items:center' });
    var countLabel = el('span', { class: 'badge badge-' + def.tone });
    countBar.appendChild(countLabel);

    var bulk = el('div', { class: 'row', style: 'gap:6px' });
    bulk.appendChild(UI.btn('Select all shown', 'btn-secondary btn-sm', function () {
      visible().forEach(function (r) { selected[Store.rowKey(r)] = true; });
      table.refresh(); paintCount();
    }, { icon: 'check', iconSize: 13 }));
    bulk.appendChild(UI.btn('Clear all shown', 'btn-ghost btn-sm', function () {
      visible().forEach(function (r) { delete selected[Store.rowKey(r)]; });
      table.refresh(); paintCount();
    }, { icon: 'x', iconSize: 13 }));
    bulk.appendChild(UI.btn('Restore detected', 'btn-ghost btn-sm', function () {
      selected = {};
      recs.forEach(function (r) { if (base(r) === stream) selected[Store.rowKey(r)] = true; });
      table.refresh(); paintCount();
    }, { icon: 'refresh', iconSize: 13 }));
    countBar.appendChild(bulk);
    body.appendChild(countBar);

    function paintCount() {
      var n = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
      countLabel.textContent = 'Selected ' + def.plural + ': ' + U.fmtInt(n);
    }

    /* whatever the table is showing right now, after search + filter */
    function visible() { return table && table.visibleRows ? table.visibleRows() : recs; }

    var columns = [
      {
        key: '__sel', label: '', width: '44px', sortable: false, align: 'center', lockVisible: true,
        render: function (r) {
          var k = Store.rowKey(r);
          var cb = el('input', { type: 'checkbox', checked: !!selected[k] });
          cb.addEventListener('change', function () {
            if (cb.checked) selected[k] = true; else delete selected[k];
            paintCount();
          });
          return cb;
        }
      },
      {
        key: '__id', label: idCol || 'Row',
        value: function (r) { return idCol ? r[idCol] : 'Row ' + (r.__row + 1); },
        render: function (r) {
          return '<span class="cell-strong">' + esc(idCol ? String(r[idCol]) : 'Row ' + (r.__row + 1)) + '</span>';
        }
      }
    ];
    if (typeCol) {
      columns.push({
        key: '__type', label: typeCol,
        value: function (r) { return r[typeCol]; },
        render: function (r) { return '<span class="badge badge-neutral">' + esc(String(r[typeCol] || '—')) + '</span>'; }
      });
    }
    columns.push({
      key: '__now', label: 'Currently',
      value: function (r) { return nowIn[Store.rowKey(r)] || 'unmatched'; },
      render: function (r) {
        var s = nowIn[Store.rowKey(r)] || 'unmatched';
        var cls = { calibration: 'badge-violet', control: 'badge-info', patient: 'badge-success' }[s] || 'badge-neutral';
        return '<span class="badge ' + cls + '">' + esc(Store.streamLabel(s)) + '</span>';
      }
    });
    columns.push({
      key: '__detected', label: 'Detected as',
      value: function (r) { return base(r); },
      render: function (r) { return '<span class="muted">' + esc(Store.streamLabel(base(r))) + '</span>'; }
    });
    columns.push({
      key: '__src', label: 'Source file',
      value: function (r) { return r.__src; },
      render: function (r) { return '<span class="mono" style="font-size:11.5px">' + esc(r.__src || '') + '</span>'; }
    });

    /* a couple of informative numeric columns, if the file has them */
    [['percentDiff', '% Diff'], ['concentration', 'Conc.']].forEach(function (pair) {
      var col = map[pair[0]];
      if (!col) return;
      columns.push({
        key: col, label: col, align: 'right',
        value: function (r) { return r[col]; }
      });
    });

    var table = UI.dataTable({
      rows: recs, columns: columns, unit: 'rows', pageSize: 25, columnToggle: true,
      searchPlaceholder: 'Search sample ID, type or file…',
      searchText: function (r) {
        return [idCol ? r[idCol] : '', typeCol ? r[typeCol] : '', r.__src].join(' ');
      },
      defaultFilter: opts.filter || 'all',
      filters: [
        { key: 'all', label: 'All rows' },
        { key: 'selected', label: 'Selected', test: function (r) { return !!selected[Store.rowKey(r)]; } },
        { key: 'detected', label: 'Detected ' + def.label.toLowerCase(), test: function (r) { return base(r) === stream; } },
        { key: 'patient', label: 'Patient', test: function (r) { return (nowIn[Store.rowKey(r)] || '') === 'patient'; } },
        { key: 'unmatched', label: 'Excluded', test: function (r) { return (nowIn[Store.rowKey(r)] || 'unmatched') === 'unmatched'; } }
      ],
      empty: { icon: 'search', title: 'No matching rows', desc: 'Adjust the search or filter.' }
    });

    body.appendChild(table);
    paintCount();

    var m = UI.modal({
      title: 'Select ' + def.plural, size: 'wide', body: body, autofocus: false,
      footer: [
        el('div', { class: 'left' }, [
          el('span', {
            class: 'muted', style: 'font-size:12px',
            text: 'Unticking every row leaves this stream empty — its criteria are then skipped.'
          })
        ]),
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        UI.btn('Save ' + def.label + ' Selection', 'btn-primary', function () {
          commit();
        }, { icon: 'check' })
      ]
    });

    function commit() {
      var wanted = recs.filter(function (r) { return !!selected[Store.rowKey(r)]; });
      var dropped = recs.filter(function (r) {
        return !selected[Store.rowKey(r)] && (nowIn[Store.rowKey(r)] === stream);
      });
      if (!wanted.length && !dropped.length) { m.close(); return; }

      var apply = function (reason) {
        /* rows leaving this stream fall back to what detection says they are,
           unless detection also says "this stream" — then they become patient */
        var changed = 0;
        changed += Store.setSampleStream(a, wanted, stream, reason);
        var toPatient = dropped.filter(function (r) { return base(r) === stream; });
        var toDetected = dropped.filter(function (r) { return base(r) !== stream; });
        changed += Store.setSampleStream(a, toPatient, 'patient', reason);
        toDetected.forEach(function (r) {
          changed += Store.setSampleStream(a, [r], base(r), reason);
        });
        m.close();
        UI.toast({
          kind: 'success', title: def.label + ' selection saved',
          text: U.fmtInt(wanted.length) + ' record(s) now make up the ' + def.label.toLowerCase() +
            ' set. Criteria v' + Store.assayOf(a).criteriaVersion + '.'
        });
        App.render();
      };

      if (Store.S.settings.requireReasonOnRuleChange && (a.validation.approved || a.streamTests)) {
        UI.reasonPrompt({
          title: 'Reason for changing the ' + def.label.toLowerCase() + ' selection',
          message: 'Sample selection is part of the validated configuration. This change creates a new criteria ' +
            'version and requires calibration and controls to be re-tested.'
        }).then(function (reason) {
          if (reason === null) return;
          apply(reason);
        });
      } else {
        apply('');
      }
    }
  };

  /* ============================================================
     PATIENT RECORDS
     ============================================================ */
  Screens.patientRecordsDrawer = function (a) {
    var g = Store.groups(a);
    var map = Store.columnMapOf(a);
    var idCol = map.sampleId;
    var cols = Store.columnsOf(a).slice(0, 8);

    var body = el('div', {});
    body.innerHTML = UI.alertBox('info', U.fmtInt(g.patient.length) + ' patient record(s)',
      'Everything left after the calibration, control and excluded rows. These are the records patient validation will run against.');

    var columns = [{
      key: '__id', label: idCol || 'Row',
      value: function (r) { return idCol ? r[idCol] : r.__row + 1; },
      render: function (r) { return '<span class="cell-strong">' + esc(idCol ? String(r[idCol]) : 'Row ' + (r.__row + 1)) + '</span>'; }
    }, {
      key: '__src', label: 'Source file', value: function (r) { return r.__src; }
    }];
    cols.forEach(function (c) {
      if (c === idCol) return;
      columns.push({ key: c, label: c, value: function (r) { return r[c]; } });
    });

    body.appendChild(UI.dataTable({
      rows: g.patient, columns: columns, unit: 'patient records', pageSize: 25, columnToggle: true,
      searchPlaceholder: 'Search patient records…',
      searchText: function (r) { return [idCol ? r[idCol] : '', r.__src].join(' '); },
      exportName: (a.code || a.name).replace(/[^A-Za-z0-9]+/g, '_') + '_Patient_Records'
    }));

    UI.drawer({
      eyebrow: a.name, title: 'Patient Records', wide: true, body: body,
      footer: [UI.btn('Close', 'btn-secondary', function () { UI.closeDrawer(); })]
    });
  };

  /* ============================================================
     TEST CALIBRATION / TEST CONTROLS (§12 – §14)
     ============================================================ */
  Screens.streamTest = function (a, stream) {
    var g = Store.groups(a);
    var list = stream === 'calibration' ? g.calibration : g.control;
    if (!list.length) {
      UI.toast({
        kind: 'error', title: 'Nothing to test',
        text: 'No ' + stream + ' records are selected. Use Edit Selection to choose them.'
      });
      return;
    }
    if (!Store.criteriaOf(a).filter(function (c) { return c.enabled; }).length) {
      UI.toast({ kind: 'error', title: 'No criteria enabled', text: 'Enable at least one criterion first.' });
      return;
    }

    var runner = UI.progressRunner({ title: 'Testing ' + list.length + ' ' + stream + ' record(s)' });
    var m = UI.modal({ title: 'Test ' + Store.streamLabel(stream), size: 'narrow', body: runner.body, autofocus: false });
    UI.simulate({
      total: list.length, duration: 900,
      onTick: function (done, t, frac) {
        runner.set(frac, '<p class="muted" style="font-size:12.5px">Record ' + U.fmtInt(done) +
          ' of ' + U.fmtInt(list.length) + '…</p>');
      },
      onDone: function () {
        var res = Store.testStream(a, stream);
        UI.closeModal();
        showStreamResult(a, stream, res);
      }
    });
  };

  function showStreamResult(a, stream, res) {
    var label = Store.streamLabel(stream);
    var body = el('div', {});

    var tiles = el('div', { class: 'result-tiles' });
    tiles.innerHTML =
      '<div class="rt total"><div class="rtk">Total</div><div class="rtv">' + U.fmtInt(res.total) + '</div></div>' +
      '<div class="rt pass"><div class="rtk">✓ Passed</div><div class="rtv">' + U.fmtInt(res.passed) + '</div></div>' +
      '<div class="rt fail"><div class="rtk">✕ Failed</div><div class="rtv">' + U.fmtInt(res.failed) + '</div></div>';
    body.appendChild(tiles);

    if (res.failed) {
      body.appendChild(el('div', {
        class: 'alert alert-danger mt4',
        html: U.icon('warning', 17) + '<div><div class="alert-t">' + label + ' validation failed</div>' +
          '<p>' + U.fmtInt(res.failed) + ' ' + esc(stream) + ' record(s) fall outside the configured limits. ' +
          'Patient testing stays locked until this passes — correct the rule, correct the data, then re-test.</p></div>'
      }));
      body.appendChild(el('div', { class: 'mt4' }, recordsTable(a, stream, res)));
      body.appendChild(failureTable(a, res));
    } else {
      body.appendChild(el('div', {
        class: 'alert alert-success mt4',
        html: U.icon('check', 17) + '<div><div class="alert-t">' + label + ' passed</div>' +
          '<p>All ' + U.fmtInt(res.total) + ' ' + esc(stream) + ' record(s) are within the configured limits ' +
          'on criteria v' + esc(res.criteriaVersion) + '.</p></div>'
      }));
      body.appendChild(el('div', { class: 'mt4' }, recordsTable(a, stream, res)));
    }

    body.appendChild(derivedPanel(res.derived));

    var footer = [UI.btn('Close', 'btn-secondary', function () { m.close(); App.render(); })];
    if (res.failed) {
      footer.push(UI.btn('Edit Rule', 'btn-secondary', function () {
        m.close(); App.go('analytic/' + a.id + '/criteria');
      }, { icon: 'rules' }));
      footer.push(UI.btn('Re-test', 'btn-primary', function () {
        m.close(); Screens.streamTest(a, stream);
      }, { icon: 'refresh' }));
    } else {
      footer.push(UI.btn('Continue', 'btn-primary', function () {
        m.close(); App.go('analytic/' + a.id + '/criteria');
      }, { icon: 'arrowRight' }));
    }

    var m = UI.modal({
      title: 'Test ' + label + ' — results', size: 'wide', body: body, autofocus: false, footer: footer
    });
  }

  /**
   * Every record in the stream with its PASS / FAIL verdict (STEP 7 / STEP 9).
   * Columns follow the configured rules, so the table shows the field, its
   * minimum and its maximum next to the record's own value.
   */
  function recordsTable(a, stream, res) {
    var rules = res.rules || [];
    var columns = [{
      key: 'sampleId', label: 'Sample ID',
      render: function (r) { return '<span class="cell-strong">' + esc(r.sampleId) + '</span>'; }
    }];

    rules.forEach(function (rule, i) {
      columns.push({
        key: 'v' + i, label: rule.field, align: 'right',
        value: function (r) { return (r.checks[i] || {}).actual; },
        render: function (r) {
          var c = r.checks[i] || {};
          var v = c.actual === undefined || c.actual === '' ? '—' : String(c.actual);
          return c.status === 'fail'
            ? '<span style="color:var(--red-700);font-weight:700">' + esc(v) + '</span>'
            : esc(v);
        }
      });
      columns.push({
        key: 'min' + i, label: 'Min', align: 'right', sortable: false,
        render: function (r) {
          var c = r.checks[i] || {};
          return c.min === null || c.min === undefined || c.min === '' ? '<span class="muted">—</span>' : esc(String(c.min));
        }
      });
      columns.push({
        key: 'max' + i, label: 'Max', align: 'right', sortable: false,
        render: function (r) {
          var c = r.checks[i] || {};
          return c.max === null || c.max === undefined || c.max === '' ? '<span class="muted">—</span>' : esc(String(c.max));
        }
      });
    });

    columns.push({
      key: 'status', label: 'Status', align: 'center',
      render: function (r) {
        var cls = r.status === 'fail' ? 'badge-danger' : r.status === 'warning' ? 'badge-warn' : 'badge-success';
        var txt = r.status === 'fail' ? 'FAIL' : r.status === 'warning' ? 'WARNING' : 'PASS';
        return '<span class="badge ' + cls + '">' + txt + '</span>';
      }
    });
    columns.push({ key: 'src', label: 'Source file', value: function (r) { return r.src; } });
    columns.push({
      key: 'actions', label: '', sortable: false,
      render: function (r) {
        var failing = r.checks.filter(function (c) { return c.status === 'fail'; })[0];
        var field = failing ? failing.field : (rules[0] && rules[0].field);
        if (!field) return '';
        return UI.btn('Edit', r.status === 'fail' ? 'btn-secondary btn-sm' : 'btn-ghost btn-sm', function () {
          Screens.editStreamValue(a, stream, r, field);
        }, { icon: 'edit', iconSize: 13 });
      }
    });

    return UI.dataTable({
      title: Store.streamLabel(stream) + ' validation',
      rows: res.records || [], columns: columns, unit: 'records', pageSize: 10, columnToggle: true,
      searchPlaceholder: 'Search sample ID…',
      searchText: function (r) { return r.sampleId + ' ' + r.src; },
      rowClass: function (r) { return r.status === 'fail' ? 'row-fail' : ''; },
      defaultFilter: 'all',
      filters: [
        { key: 'all', label: 'All', count: (res.records || []).length },
        { key: 'fail', label: 'Failed', count: res.failed, test: function (r) { return r.status === 'fail'; } },
        { key: 'pass', label: 'Passed', count: res.passed, test: function (r) { return r.status === 'pass'; } }
      ],
      exportName: (a.code || a.name).replace(/[^A-Za-z0-9]+/g, '_') + '_' + stream + '_validation'
    });
  }

  /**
   * Correct one value and re-test immediately (STEP 8 / STEP 10).
   * This is the ONLY place a value is ever changed, it is always the user
   * doing it deliberately, and the before/after pair goes to the audit trail.
   */
  Screens.editStreamValue = function (a, stream, rec, field) {
    var record = Store.recordsOf(a)[rec.i];
    if (!record) return;
    var check = rec.checks.filter(function (c) { return c.field === field; })[0] || {};
    var current = record[field];

    var body = el('div', {});
    body.innerHTML =
      '<div class="grid g2">' +
      UI.metric('Sample', esc(rec.sampleId)) +
      UI.metric('Field', esc(field)) +
      '</div>' +
      '<div class="grid g3 mt3">' +
      UI.metric('Current value', esc(current === undefined || current === '' ? '—' : String(current)),
        rec.status === 'fail' ? 'red' : '') +
      UI.metric('Allowed minimum', check.min === null || check.min === undefined ? '—' : esc(String(check.min))) +
      UI.metric('Allowed maximum', check.max === null || check.max === undefined ? '—' : esc(String(check.max))) +
      '</div>' +
      (check.reason ? '<div class="alert alert-danger mt3">' + U.icon('warning', 16) +
        '<div><div class="alert-t">Why it failed</div><p>' + esc(check.reason) + '</p></div></div>' : '');

    var valIn = UI.fieldGroup({
      label: 'New Value', value: current === undefined ? '' : String(current),
      hint: 'Only this one cell changes. Every other field in the file is left exactly as uploaded.'
    });
    var reasonIn = UI.fieldGroup({
      label: 'Reason for the correction', type: 'textarea', rows: 2,
      placeholder: 'e.g. Transcription error confirmed against the instrument printout'
    });
    body.appendChild(el('div', { class: 'mt4' }, [valIn]));
    body.appendChild(el('div', { class: 'mt3' }, [reasonIn]));
    body.appendChild(el('p', {
      class: 'muted mt3', style: 'font-size:12px',
      text: 'Source file: ' + (rec.src || '—') + ' · row ' + (rec.row + 1) +
        '. The original value stays in the audit trail.'
    }));

    var m = UI.modal({
      title: 'Edit ' + rec.sampleId + ' — ' + field, size: 'narrow', body: body,
      footer: [
        UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
        UI.btn('Save & Re-test', 'btn-primary', function () {
          var v = valIn.input.value.trim();
          if (v === '') { valIn.setError('Enter a value'); return; }
          var reason = reasonIn.input.value.trim();
          if (reason.length < 4) { reasonIn.setError('Give a short reason — it is stored in the audit trail'); return; }
          Store.correctData(a, record, field, v, reason);
          m.close();
          var res = Store.testStream(a, stream);
          UI.toast({
            kind: res.failed ? 'warn' : 'success',
            title: rec.sampleId + ' updated',
            text: res.failed
              ? U.fmtInt(res.failed) + ' ' + stream + ' record(s) still failing.'
              : 'All ' + stream + ' records now pass.'
          });
          showStreamResult(a, stream, res);
        }, { icon: 'check' })
      ]
    });
  };

  /** Sample ID · Field · Actual · Min · Max · Rule · Reason (§18). */
  function failureTable(a, res) {
    var wrap = el('div', { class: 'mt4' });
    wrap.appendChild(UI.dataTable({
      title: 'Failed records',
      rows: res.failures, unit: 'findings', pageSize: 10,
      searchPlaceholder: 'Search sample, field or rule…',
      searchText: function (r) { return [r.sampleId, r.field, r.rule, r.reason].join(' '); },
      columns: [
        { key: 'sampleId', label: 'Sample ID', render: function (r) { return '<span class="cell-strong">' + esc(r.sampleId) + '</span>'; } },
        { key: 'field', label: 'Field' },
        {
          key: 'actual', label: 'Actual', align: 'right',
          render: function (r) {
            return '<span style="color:var(--red-700);font-weight:650">' + esc(fmtVal(r.actual)) + '</span>';
          }
        },
        { key: 'min', label: 'Minimum', align: 'right', render: function (r) { return esc(fmtVal(r.min)); } },
        { key: 'max', label: 'Maximum', align: 'right', render: function (r) { return esc(fmtVal(r.max)); } },
        { key: 'rule', label: 'Failed rule' },
        { key: 'reason', label: 'Reason', render: function (r) { return '<span class="muted">' + esc(r.reason) + '</span>'; } },
        {
          key: 'actions', label: '', sortable: false,
          render: function (r) {
            return UI.btn('Correct', 'btn-ghost btn-sm', function () {
              var rec = Store.recordsOf(a)[r.i];
              if (!rec) return;
              /* the correction drawer works on a rule-run row, so present the
                 criterion finding in the same shape */
              Screens.correctionDrawer(a, {
                record: rec, index: r.i, kind: res.stream,
                failures: r.severity === 'fail' ? [criterionAsFailure(r)] : [],
                warnings: r.severity === 'fail' ? [] : [criterionAsFailure(r)]
              });
            }, { icon: 'edit', iconSize: 13 });
          }
        }
      ],
      exportName: (a.code || a.name).replace(/[^A-Za-z0-9]+/g, '_') + '_' + res.stream + '_Failed'
    }));
    return wrap;
  }

  /** A criterion finding rendered the way the rule-based correction drawer expects. */
  function criterionAsFailure(r) {
    return {
      rule: r.rule, field: r.field, message: r.reason,
      severity: r.severity === 'fail' ? 'error' : 'warning',
      ruleId: null, description: r.expected ? 'Expected ' + r.expected : ''
    };
  }

  function fmtVal(v) {
    if (v === undefined || v === null || v === '') return '—';
    if (typeof v === 'number') return U.fmtNum(v, Math.abs(v) < 10 ? 3 : 2);
    return String(v);
  }

  /** The numbers the calibrators produced — ion-ratio range, RT window (§22). */
  function derivedPanel(d) {
    if (!d) return el('div', {});
    var rows = [];
    if (d.ionRatioRange) {
      rows.push(['Ion-ratio range', U.fmtNum(d.ionRatioRange[0], 3) + ' – ' + U.fmtNum(d.ionRatioRange[1], 3), d.ionRatioBasis || '']);
    }
    if (d.rtWindow) {
      rows.push(['Retention-time window', U.fmtNum(d.rtWindow[0], 3) + ' – ' + U.fmtNum(d.rtWindow[1], 3),
        'calibrator average ' + U.fmtNum(d.rtAverage, 3) + ' ± ' + d.rtWindowPct + '%']);
    }
    if (d.calibrationRange) {
      rows.push(['Calibrated range', U.fmtNum(d.calibrationRange[0], 3) + ' – ' + U.fmtNum(d.calibrationRange[1], 3) + ' ng/mL', 'lowest to highest calibrator standard']);
    }
    if (d.cutoff !== null && d.cutoff !== undefined && !isNaN(d.cutoff)) {
      rows.push(['Cut-off', U.fmtNum(d.cutoff, 4) + ' ng/mL', d.cutoffSource || '']);
    }
    if (!rows.length) return el('div', {});

    var t = el('div', { class: 'table-scroll mt4' });
    t.innerHTML = '<table class="tbl compact"><thead><tr><th>Derived from this run</th><th>Value</th><th>Basis</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="cell-strong">' + esc(r[0]) + '</td><td class="mono">' + esc(r[1]) +
          '</td><td class="muted">' + esc(r[2]) + '</td></tr>';
      }).join('') + '</tbody></table>';
    return t;
  }

  /** Standalone failed-record view for a stream already tested. */
  Screens.streamFailures = function (a, stream) {
    var res = (a.streamTests || {})[stream];
    if (!res) { Screens.streamTest(a, stream); return; }
    var body = el('div', {});
    body.innerHTML = UI.alertBox('danger', U.fmtInt(res.failed) + ' ' + stream + ' record(s) failed',
      'Tested on criteria v' + res.criteriaVersion + ' · ' + U.fmtDateTime(res.ranAt));
    body.appendChild(failureTable(a, res));
    UI.drawer({
      eyebrow: a.name, title: Store.streamLabel(stream) + ' failures', wide: true, body: body,
      footer: [
        UI.btn('Close', 'btn-secondary', function () { UI.closeDrawer(); }),
        UI.btn('Re-test', 'btn-primary', function () { UI.closeDrawer(); Screens.streamTest(a, stream); }, { icon: 'refresh' })
      ]
    });
  };
}(typeof window !== 'undefined' ? window : this));
