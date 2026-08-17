/* ============================================================
   ui.js — reusable UI primitives: toasts, modals, drawers,
   confirm dialogs, status badges, stepper and a data table with
   search / filter / sort / pagination / export.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;

  /* ---------------------------- toast ---------------------------- */
  var GLYPH = { success: '✓', error: '✕', warn: '!', info: 'i' };
  function toast(o) {
    o = o || {};
    var kind = o.kind || 'info';
    var stack = U.$('#toast-stack');
    var node = el('div', { class: 'toast ' + kind, role: 'status' }, [
      el('span', { class: 'ti', text: GLYPH[kind] || 'i' }),
      el('div', {}, [
        el('p', { class: 'toast-t', text: o.title || '' }),
        o.text ? el('p', { class: 'toast-d', text: o.text }) : null
      ]),
      el('button', { class: 'tx', 'aria-label': 'Dismiss', html: U.icon('x', 14), onclick: close })
    ]);
    stack.appendChild(node);
    var timer = setTimeout(close, o.duration || 4200);
    function close() {
      clearTimeout(timer);
      node.classList.add('out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 200);
    }
    return { close: close };
  }

  /* ---------------------------- modal ---------------------------- */
  var modalState = { open: false, onClose: null };
  function modal(o) {
    o = o || {};
    var root = U.$('#modal-root'), box = U.$('#modal');
    box.className = 'modal' + (o.size ? ' ' + o.size : '');
    U.$('#modal-title').textContent = o.title || '';
    var body = U.$('#modal-body'); body.innerHTML = '';
    if (typeof o.body === 'string') body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);
    var foot = U.$('#modal-foot'); foot.innerHTML = '';
    (o.footer || []).forEach(function (b) { foot.appendChild(b); });
    foot.hidden = !(o.footer || []).length;
    root.hidden = false;
    modalState.open = true;
    modalState.onClose = o.onClose || null;
    document.body.style.overflow = 'hidden';
    var first = body.querySelector('input,select,textarea,button');
    if (first && o.autofocus !== false) setTimeout(function () { first.focus(); }, 60);
    return { close: closeModal, body: body, foot: foot };
  }
  function closeModal() {
    var root = U.$('#modal-root');
    if (root.hidden) return;
    root.hidden = true;
    modalState.open = false;
    document.body.style.overflow = '';
    if (modalState.onClose) { var f = modalState.onClose; modalState.onClose = null; f(); }
  }

  function confirm(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (settled) return; settled = true; m.close(); resolve(v); }
      var cancel = btn(o.cancelLabel || 'Cancel', 'btn-secondary', function () { done(false); });
      var okBtn = btn(o.confirmLabel || 'Confirm', o.danger ? 'btn-danger' : 'btn-primary', function () { done(true); });
      var m = modal({
        title: o.title || 'Are you sure?',
        size: 'narrow',
        body: '<p style="font-size:13.5px;line-height:1.6;color:var(--ink-2)">' + (o.message || '') + '</p>' +
          (o.detail ? '<div class="alert alert-neutral mt4" style="font-size:12.5px">' + o.detail + '</div>' : ''),
        footer: [cancel, okBtn],
        onClose: function () { if (!settled) { settled = true; resolve(false); } }
      });
      setTimeout(function () { okBtn.focus(); }, 60);
    });
  }

  /** Prompt for a change reason (audit trail requirement). */
  function reasonPrompt(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var settled = false;
      var ta = el('textarea', { class: 'inp', id: 'reason-input', placeholder: o.placeholder || 'e.g. Analytical range extended after method verification', rows: 3 });
      var err = el('p', { class: 'err', style: 'display:none;color:var(--red-700);font-size:11.5px;margin-top:6px' });
      var body = el('div', {}, [
        el('p', { style: 'font-size:13px;color:var(--ink-2);line-height:1.6;margin-bottom:12px', text: o.message || 'Describe why this configuration is changing. The reason is stored in the audit log.' }),
        el('div', { class: 'fg' }, [el('label', { for: 'reason-input', text: 'Reason for change' }), ta, err])
      ]);
      function done(v) { if (settled) return; settled = true; m.close(); resolve(v); }
      var m = modal({
        title: o.title || 'Reason for change',
        size: 'narrow',
        body: body,
        footer: [
          btn('Cancel', 'btn-secondary', function () { done(null); }),
          btn(o.confirmLabel || 'Save change', 'btn-primary', function () {
            var v = ta.value.trim();
            if (o.required !== false && v.length < 4) {
              err.textContent = 'Please enter a short reason (at least 4 characters).';
              err.style.display = 'block'; ta.focus(); return;
            }
            done(v);
          })
        ],
        onClose: function () { if (!settled) { settled = true; resolve(null); } }
      });
    });
  }

  /* ---------------------------- drawer ---------------------------- */
  function drawer(o) {
    o = o || {};
    var root = U.$('#drawer-root'), box = U.$('#drawer');
    box.className = 'drawer' + (o.wide ? ' wide' : '');
    U.$('#drawer-eyebrow').textContent = o.eyebrow || '';
    U.$('#drawer-title').textContent = o.title || '';
    var body = U.$('#drawer-body'); body.innerHTML = '';
    if (typeof o.body === 'string') body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);
    var foot = U.$('#drawer-foot'); foot.innerHTML = '';
    (o.footer || []).forEach(function (b) { foot.appendChild(b); });
    foot.hidden = !(o.footer || []).length;
    root.hidden = false;
    drawerState.onClose = o.onClose || null;
    return { close: closeDrawer, body: body, foot: foot };
  }
  var drawerState = { onClose: null };
  function closeDrawer() {
    var root = U.$('#drawer-root');
    if (root.hidden) return;
    root.hidden = true;
    if (drawerState.onClose) { var f = drawerState.onClose; drawerState.onClose = null; f(); }
  }

  /* ---------------------------- buttons ---------------------------- */
  function btn(label, cls, onClick, opts) {
    opts = opts || {};
    var b = el('button', {
      class: 'btn ' + (cls || 'btn-secondary') + (opts.size ? ' ' + opts.size : ''),
      type: 'button', title: opts.title || '', disabled: opts.disabled || false
    });
    if (opts.icon) b.innerHTML = U.icon(opts.icon, opts.iconSize || 15);
    b.appendChild(el('span', { class: 'btn-label', text: label }));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function iconBtn(iconName, title, onClick, cls) {
    var b = el('button', { class: 'icon-btn ' + (cls || ''), type: 'button', title: title, 'aria-label': title, html: U.icon(iconName, 15) });
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function loading(button, on) {
    if (!button) return;
    button.classList.toggle('loading', !!on);
    button.disabled = !!on;
  }

  /* ---------------------------- badges ---------------------------- */
  function statusBadge(status) {
    var m = Store.STATUS_META[status] || Store.STATUS_META.draft;
    return '<span class="badge ' + m.badge + '"><span class="bdot"></span>' + m.label + '</span>';
  }
  function resultBadge(status) {
    if (status === 'pass') return '<span class="badge badge-success">✓ PASS</span>';
    if (status === 'fail') return '<span class="badge badge-danger">✕ FAIL</span>';
    return '<span class="badge badge-warn">⚠ WARNING</span>';
  }
  function typeBadge(t) { return '<span class="type-badge type-' + t + '">' + t + '</span>'; }
  function severityBadge(s) {
    return s === 'warning'
      ? '<span class="badge badge-warn">Warning</span>'
      : '<span class="badge badge-danger">Error</span>';
  }
  function scopeBadges(scope) {
    return '<span class="scope-badges">' + (scope || []).map(function (s) {
      return '<span class="scope-b scope-' + s + '">' + s.slice(0, 3) + '</span>';
    }).join('') + '</span>';
  }
  function versionChip(v) { return '<span class="badge badge-info">' + U.icon('version', 11) + ' v' + esc(v) + '</span>'; }

  /* ---------------------------- misc blocks ---------------------------- */
  function alertBox(kind, title, text, actionsHTML) {
    var ico = { info: 'info', success: 'check', danger: 'x', warn: 'warning', neutral: 'info' }[kind] || 'info';
    return '<div class="alert alert-' + kind + '">' + U.icon(ico, 17) +
      '<div><div class="alert-t">' + title + '</div>' + (text ? '<p>' + text + '</p>' : '') + '</div>' +
      (actionsHTML ? '<div class="grow">' + actionsHTML + '</div>' : '') + '</div>';
  }
  function emptyState(o) {
    var wrap = el('div', { class: 'empty' });
    wrap.innerHTML = '<div class="empty-ico">' + U.icon(o.icon || 'file', 26) + '</div>' +
      '<p class="empty-t">' + esc(o.title || '') + '</p>' +
      '<p class="empty-d">' + esc(o.desc || '') + '</p>';
    if (o.actions && o.actions.length) {
      var a = el('div', { class: 'empty-actions' });
      o.actions.forEach(function (x) { a.appendChild(x); });
      wrap.appendChild(a);
    }
    return wrap;
  }
  function metric(k, v, tone) {
    return '<div class="metric ' + (tone || '') + '"><div class="mk">' + esc(k) + '</div><div class="mv">' + v + '</div></div>';
  }
  function stat(o) {
    return '<div class="stat"><div class="stat-ico ' + (o.tone || 'blue') + '">' + U.icon(o.icon || 'analytics', 18) + '</div>' +
      '<div><div class="stat-k">' + esc(o.label) + '</div><div class="stat-v">' + o.value + '</div>' +
      (o.note ? '<div class="stat-note ' + (o.noteTone || '') + '">' + o.note + '</div>' : '') + '</div></div>';
  }
  function skeletonTable(rows, cols) {
    var out = '';
    for (var i = 0; i < (rows || 6); i++) {
      out += '<div class="skel-row">';
      for (var j = 0; j < (cols || 5); j++) out += '<div class="skel"></div>';
      out += '</div>';
    }
    return out;
  }

  /* ---------------------------- stepper ---------------------------- */
  var STEP_ICON = { done: '✓', failed: '✕' };
  function stepper(a, onNavigate) {
    var states = Store.stepStates(a);
    var wrap = el('div', { class: 'stepper', role: 'tablist', 'aria-label': 'Analytic workflow' });
    Store.STEPS.forEach(function (s, i) {
      var st = states[s.key] || 'pending';
      var isLocked = st === 'locked';
      var b = el('button', {
        class: 'step ' + (st === 'done' ? 'done' : st === 'current' ? 'current' : st === 'failed' ? 'failed' : st === 'locked' ? 'locked' : ''),
        type: 'button', 'data-step': s.key, disabled: isLocked, title: isLocked ? 'Locked until Control & Calibration validation is approved' : s.hint
      });
      var mark = st === 'locked' ? U.icon('lock', 12) : (STEP_ICON[st] || (i + 1));
      b.innerHTML = '<span class="step-top"><span class="step-num">' + mark + '</span>' +
        '<span class="step-t">' + esc(s.label) + '</span></span>' +
        '<span class="step-s">' + esc(st === 'locked' ? 'Locked' : st === 'failed' ? 'Failed — correction required' : st === 'done' ? 'Completed' : st === 'current' ? 'In progress' : s.hint) + '</span>';
      if (!isLocked && onNavigate) b.addEventListener('click', function () { onNavigate(s.key); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* ---------------------------- data table ---------------------------- */
  /**
   * dataTable({columns, rows, ...}) → HTMLElement with its own state.
   * columns: [{key,label,align,sortable,render(row),sortValue(row),width}]
   */
  function dataTable(opts) {
    var state = {
      q: '', filter: opts.defaultFilter || (opts.filters && opts.filters[0] ? opts.filters[0].key : null),
      sort: opts.defaultSort || null, dir: opts.defaultDir || 'asc',
      page: 1, pageSize: opts.pageSize || Store.S.settings.pageSize || 25
    };
    var wrap = el('div', { class: 'dt' });
    var toolbar = el('div', { class: 'card-head' });
    var scroll = el('div', { class: 'table-scroll' });
    var pagerEl = el('div', { class: 'pager' });

    /* toolbar */
    if (opts.title) toolbar.appendChild(el('h3', { class: 'section-title', text: opts.title }));
    var countLabel = el('span', { class: 'badge badge-neutral' });
    if (opts.showCount !== false) toolbar.appendChild(countLabel);

    var right = el('div', { class: 'grow' });
    if (opts.searchable !== false) {
      var si = el('div', { class: 'search-inp' });
      si.innerHTML = U.icon('search', 15);
      var input = el('input', {
        class: 'inp', type: 'search', placeholder: opts.searchPlaceholder || 'Search…',
        oninput: U.debounce(function () { state.q = input.value.trim().toLowerCase(); state.page = 1; render(); }, 180)
      });
      si.appendChild(input);
      right.appendChild(si);
    }
    if (opts.filters && opts.filters.length) {
      var pills = el('div', { class: 'pills' });
      opts.filters.forEach(function (f) {
        var p = el('button', { class: 'pill' + (state.filter === f.key ? ' on' : ''), type: 'button', 'data-filter': f.key });
        p.innerHTML = esc(f.label) + (f.count !== undefined ? ' <span class="c">' + U.fmtInt(f.count) + '</span>' : '');
        p.addEventListener('click', function () {
          state.filter = f.key; state.page = 1;
          U.$$('.pill', pills).forEach(function (x) { x.classList.toggle('on', x.dataset.filter === f.key); });
          render();
        });
        pills.appendChild(p);
      });
      right.appendChild(pills);
    }
    (opts.toolbar || []).forEach(function (n) { right.appendChild(n); });
    if (opts.exportName) {
      right.appendChild(btn('Export', 'btn-secondary btn-sm', function () { doExport(); }, { icon: 'download', iconSize: 14 }));
    }
    toolbar.appendChild(right);
    if (opts.hideToolbar !== true) wrap.appendChild(toolbar);
    wrap.appendChild(scroll);
    wrap.appendChild(pagerEl);

    function visibleRows() {
      var rows = opts.rows || [];
      var f = (opts.filters || []).filter(function (x) { return x.key === state.filter; })[0];
      if (f && f.test) rows = rows.filter(f.test);
      if (state.q) {
        rows = rows.filter(function (r) {
          var hay = opts.searchText ? opts.searchText(r) : JSON.stringify(r);
          return String(hay).toLowerCase().indexOf(state.q) > -1;
        });
      }
      if (state.sort) {
        var col = opts.columns.filter(function (c) { return c.key === state.sort; })[0];
        if (col) {
          var dir = state.dir === 'desc' ? -1 : 1;
          rows = rows.slice().sort(function (x, y) {
            var xv = col.sortValue ? col.sortValue(x) : rawValue(col, x);
            var yv = col.sortValue ? col.sortValue(y) : rawValue(col, y);
            if (xv === null || xv === undefined) xv = '';
            if (yv === null || yv === undefined) yv = '';
            var nx = parseFloat(xv), ny = parseFloat(yv);
            if (!isNaN(nx) && !isNaN(ny) && String(xv).trim() !== '' && String(yv).trim() !== '') return (nx - ny) * dir;
            return String(xv).localeCompare(String(yv), undefined, { numeric: true }) * dir;
          });
        }
      }
      return rows;
    }
    function rawValue(col, row) {
      if (col.value) return col.value(row);
      return row && row[col.key];
    }

    function render() {
      var rows = visibleRows();
      var totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
      state.page = U.clamp(state.page, 1, totalPages);
      var start = (state.page - 1) * state.pageSize;
      var pageRows = rows.slice(start, start + state.pageSize);
      countLabel.textContent = U.fmtInt(rows.length) + (opts.unit ? ' ' + opts.unit : ' records');

      scroll.innerHTML = '';
      if (!rows.length) {
        scroll.appendChild(emptyState(opts.empty || { icon: 'search', title: 'No matching records', desc: 'Adjust your search or filters to see results.' }));
        pagerEl.hidden = true;
        return;
      }
      pagerEl.hidden = false;

      var table = el('table', { class: 'tbl' + (opts.compact ? ' compact' : '') });
      var thead = el('thead'), tr = el('tr');
      opts.columns.forEach(function (c) {
        var th = el('th', {
          class: (c.align === 'right' ? 'num ' : '') + (c.sortable === false ? '' : 'sortable ') + (state.sort === c.key ? 'sorted' : ''),
          style: c.width ? 'width:' + c.width : null
        });
        th.innerHTML = esc(c.label) + (c.sortable === false ? '' : '<span class="sarrow">' +
          (state.sort === c.key ? (state.dir === 'asc' ? '▲' : '▼') : '⇅') + '</span>');
        if (c.sortable !== false) {
          th.addEventListener('click', function () {
            if (state.sort === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            else { state.sort = c.key; state.dir = 'asc'; }
            render();
          });
        }
        tr.appendChild(th);
      });
      thead.appendChild(tr); table.appendChild(thead);

      var tbody = el('tbody');
      pageRows.forEach(function (row) {
        var rowCls = opts.rowClass ? opts.rowClass(row) : '';
        var trr = el('tr', { class: (rowCls || '') + (opts.onRow ? ' clickable' : '') });
        opts.columns.forEach(function (c) {
          var td = el('td', { class: c.align === 'right' ? 'num' : (c.align === 'center' ? 'tc' : '') });
          var v = c.render ? c.render(row) : rawValue(c, row);
          if (v instanceof Node) td.appendChild(v);
          else td.innerHTML = (v === undefined || v === null || v === '') ? '<span class="muted">—</span>' : v;
          trr.appendChild(td);
        });
        if (opts.onRow) {
          trr.addEventListener('click', function (e) {
            if (e.target.closest('button,a,input,select')) return;
            opts.onRow(row);
          });
        }
        tbody.appendChild(trr);
      });
      table.appendChild(tbody);
      scroll.appendChild(table);

      /* pager */
      pagerEl.innerHTML = '';
      pagerEl.appendChild(el('span', {
        class: 'pinfo',
        text: 'Showing ' + U.fmtInt(start + 1) + '–' + U.fmtInt(Math.min(start + state.pageSize, rows.length)) +
          ' of ' + U.fmtInt(rows.length)
      }));
      var sizeSel = el('select', {
        'aria-label': 'Rows per page',
        onchange: function () { state.pageSize = parseInt(this.value, 10); state.page = 1; render(); }
      });
      [10, 25, 50, 100].forEach(function (n) {
        sizeSel.appendChild(el('option', { value: n, text: n + ' / page', selected: n === state.pageSize }));
      });
      pagerEl.appendChild(sizeSel);

      var nav = el('div', { class: 'pnav' });
      nav.appendChild(pBtn('‹ Prev', state.page <= 1, function () { state.page--; render(); }));
      pageWindow(state.page, totalPages).forEach(function (p) {
        if (p === '…') { nav.appendChild(el('span', { class: 'pinfo', text: '…' })); return; }
        nav.appendChild(pBtn(String(p), false, function () { state.page = p; render(); }, p === state.page));
      });
      nav.appendChild(pBtn('Next ›', state.page >= totalPages, function () { state.page++; render(); }));
      pagerEl.appendChild(nav);
    }

    function pBtn(label, disabled, onClick, on) {
      var b = el('button', { class: 'pbtn' + (on ? ' on' : ''), type: 'button', text: label, disabled: disabled });
      b.addEventListener('click', onClick);
      return b;
    }
    function pageWindow(page, total) {
      if (total <= 7) { var a = []; for (var i = 1; i <= total; i++) a.push(i); return a; }
      var out = [1];
      var from = Math.max(2, page - 1), to = Math.min(total - 1, page + 1);
      if (from > 2) out.push('…');
      for (var j = from; j <= to; j++) out.push(j);
      if (to < total - 1) out.push('…');
      out.push(total);
      return out;
    }

    function doExport() {
      var rows = visibleRows();
      var cols = opts.exportColumns || opts.columns.filter(function (c) { return c.key !== 'actions'; });
      var headers = cols.map(function (c) { return c.label; });
      var data = rows.map(function (r) {
        var o = {};
        cols.forEach(function (c) {
          var v = c.exportValue ? c.exportValue(r) : (c.value ? c.value(r) : r[c.key]);
          if (v === undefined && c.render) v = String(c.render(r)).replace(/<[^>]*>/g, '').trim();
          o[c.label] = v === undefined || v === null ? '' : v;
        });
        return o;
      });
      U.downloadText(opts.exportName + '.csv', U.toCSV(headers, data));
      toast({ kind: 'success', title: 'Export ready', text: U.fmtInt(rows.length) + ' rows written to ' + opts.exportName + '.csv' });
    }

    wrap.refresh = function (newRows) { if (newRows) opts.rows = newRows; render(); };
    render();
    return wrap;
  }

  /* ---------------------------- form helpers ---------------------------- */
  function fieldGroup(o) {
    var id = o.id || U.uid('f');
    var g = el('div', { class: 'fg' + (o.wide ? ' wide' : '') });
    if (o.label) {
      g.appendChild(el('label', { for: id, html: esc(o.label) + (o.required ? ' <span class="req">*</span>' : '') }));
    }
    var input;
    if (o.type === 'select') {
      input = el('select', { id: id, name: o.name || id, disabled: o.disabled || false });
      (o.options || []).forEach(function (op) {
        input.appendChild(el('option', {
          value: op.value, text: op.label,
          selected: String(op.value) === String(o.value)
        }));
      });
    } else if (o.type === 'textarea') {
      input = el('textarea', { id: id, class: 'inp' + (o.mono ? ' mono' : ''), name: o.name || id, placeholder: o.placeholder || '', rows: o.rows || 3 });
      input.value = o.value === undefined || o.value === null ? '' : o.value;
    } else {
      input = el('input', {
        id: id, class: 'inp' + (o.mono ? ' mono' : ''), type: o.type || 'text',
        name: o.name || id, placeholder: o.placeholder || '', step: o.step || null,
        disabled: o.disabled || false
      });
      input.value = o.value === undefined || o.value === null ? '' : o.value;
    }
    if (o.onInput) input.addEventListener('input', o.onInput);
    if (o.onChange) input.addEventListener('change', o.onChange);
    if (o.suffix) {
      var ig = el('div', { class: 'inp-group' }, [input, el('span', { class: 'addon', text: o.suffix })]);
      g.appendChild(ig);
    } else {
      g.appendChild(input);
    }
    if (o.hint) g.appendChild(el('p', { class: 'hint', text: o.hint }));
    g.appendChild(el('p', { class: 'err' }));
    g.input = input;
    g.setError = function (msg) {
      g.classList.toggle('invalid', !!msg);
      U.$('.err', g).textContent = msg || '';
    };
    return g;
  }

  function switchToggle(label, checked, onChange, small) {
    var wrap = el('label', { class: 'switch' + (small ? ' sm' : '') });
    var input = el('input', { type: 'checkbox', checked: !!checked });
    input.addEventListener('change', function () { onChange(input.checked); });
    wrap.appendChild(input);
    wrap.appendChild(el('span', { class: 'track' }));
    if (label) wrap.appendChild(el('span', { text: label }));
    wrap.input = input;
    return wrap;
  }

  function checkbox(label, checked, onChange) {
    var wrap = el('label', { class: 'check' });
    var input = el('input', { type: 'checkbox', checked: !!checked });
    input.addEventListener('change', function () { onChange(input.checked); });
    wrap.appendChild(input);
    wrap.appendChild(el('span', { class: 'box' }));
    wrap.appendChild(el('span', { text: label }));
    wrap.input = input;
    return wrap;
  }

  function segmented(options, value, onChange) {
    var wrap = el('div', { class: 'seg' });
    options.forEach(function (o) {
      var b = el('button', { type: 'button', class: value === o.value ? 'on' : '', text: o.label });
      b.addEventListener('click', function () {
        U.$$('button', wrap).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        onChange(o.value);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* progress runner used by validation / patient testing */
  function progressRunner(o) {
    var bar = el('i', { class: 'p', style: 'width:0%' });
    var track = el('div', { class: 'progress lg' }, [el('div', { class: 'bar', style: 'width:0%' })]);
    var lines = el('div', { class: 'mt4' });
    var pct = el('span', { class: 'mono', text: '0%' });
    var head = el('div', { class: 'row between' }, [
      el('span', { class: 'section-title', text: o.title || 'Validating…' }), pct
    ]);
    var body = el('div', {}, [head, el('div', { class: 'mt3' }, track), lines]);
    return {
      body: body,
      set: function (fraction, html) {
        var p = Math.round(U.clamp(fraction, 0, 1) * 100);
        U.$('.bar', track).style.width = p + '%';
        pct.textContent = p + '%';
        if (html !== undefined) lines.innerHTML = html;
      },
      tone: function (t) { U.$('.bar', track).className = 'bar ' + (t || ''); }
    };
  }

  /**
   * Animate a counter/progress simulation. onTick(done,total,fraction) → void
   * Timer driven (not requestAnimationFrame) so a run still completes when the
   * tab is in the background and the frame loop is suspended.
   */
  function simulate(o) {
    var total = o.total || 100;
    var duration = o.duration || 2600;
    var startedAt = Date.now();
    var stopped = false, finished = false;
    var timer = null;

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      o.onTick(total, total, 1);
      if (o.onDone) o.onDone();
    }
    function step() {
      if (stopped || finished) return;
      var frac = U.clamp((Date.now() - startedAt) / duration, 0, 1);
      // ease-out so the tail feels like real batch processing
      var eased = 1 - Math.pow(1 - frac, 1.7);
      o.onTick(Math.round(eased * total), total, frac);
      if (frac >= 1) { finish(); return; }
      timer = setTimeout(step, 30);
    }
    timer = setTimeout(step, 30);
    // safety net: never leave a progress modal spinning forever
    setTimeout(finish, duration + 1500);
    return { stop: function () { stopped = true; clearTimeout(timer); } };
  }

  global.UI = {
    toast: toast, modal: modal, closeModal: closeModal, confirm: confirm, reasonPrompt: reasonPrompt,
    drawer: drawer, closeDrawer: closeDrawer,
    btn: btn, iconBtn: iconBtn, loading: loading,
    statusBadge: statusBadge, resultBadge: resultBadge, typeBadge: typeBadge,
    severityBadge: severityBadge, scopeBadges: scopeBadges, versionChip: versionChip,
    alertBox: alertBox, emptyState: emptyState, metric: metric, stat: stat, skeletonTable: skeletonTable,
    stepper: stepper, dataTable: dataTable,
    fieldGroup: fieldGroup, switchToggle: switchToggle, checkbox: checkbox, segmented: segmented,
    progressRunner: progressRunner, simulate: simulate
  };
}(typeof window !== 'undefined' ? window : this));
