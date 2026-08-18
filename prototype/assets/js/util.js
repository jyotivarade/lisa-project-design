/* ============================================================
   util.js — DOM helpers, formatters, icons, CSV parsing, type inference
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- DOM ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    (Array.isArray(children) ? children : children === undefined ? [] : [children])
      .forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    return node;
  }

  /** Escape for safe interpolation into innerHTML strings. */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Delegated listener: on(root,'click','[data-x]',handler) */
  function on(root, type, selector, handler) {
    root.addEventListener(type, function (e) {
      var t = e.target.closest ? e.target.closest(selector) : null;
      if (t && root.contains(t)) handler.call(t, e, t);
    });
  }

  /* ---------- ids / misc ---------- */
  var seq = 0;
  function uid(prefix) { seq += 1; return (prefix || 'id') + '_' + seq.toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function debounce(fn, ms) {
    var t; return function () {
      var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms || 220);
    };
  }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function sum(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }

  /** Deterministic PRNG so demo datasets are reproducible across reloads. */
  function seededRandom(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ---------- formatting ---------- */
  function fmtInt(n) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US');
  }
  function fmtNum(n, dp) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
    return Number(n).toFixed(dp === undefined ? 2 : dp);
  }
  function fmtPct(n, dp) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(dp === undefined ? 1 : dp) + '%';
  }
  function fmtBytes(b) {
    if (!b && b !== 0) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) {
    var dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return pad(dt.getDate()) + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
  }
  function fmtDateTime(d) {
    var dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return fmtDate(dt) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) {
    var dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }
  function relTime(ts) {
    var diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return fmtDate(ts);
  }
  function initials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase();
  }
  function titleCase(s) {
    return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /* ---------- icons (inline svg strings) ---------- */
  var ICON_PATHS = {
    dashboard: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/>',
    analytics: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    beaker: '<path d="M8 3h8M10 3v7.2L5.6 18A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.7-3L14 10.2V3M7.6 16h8.8"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="M9 12.2l2.1 2.1L15 10.5"/>',
    flask: '<path d="M6 4h12M9 4v5L4.5 19A1.8 1.8 0 0 0 6.2 21.5h11.6A1.8 1.8 0 0 0 19.5 19L15 9V4"/>',
    rules: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="18" r="2"/>',
    report: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/><path d="M10 13h7M10 17h5"/>',
    audit: '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="8.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 0 1-3.8 0v-.2a1.6 1.6 0 0 0-2.7-1.2l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1A1.6 1.6 0 0 0 4 15a1.9 1.9 0 0 1 0-3.8h.3A1.6 1.6 0 0 0 5.4 8.5l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1A1.6 1.6 0 0 0 11 4.6a1.9 1.9 0 0 1 3.8 0v.3a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7 1.9 1.9 0 0 1 0 3.8h-.2z"/>',
    upload: '<path d="M12 16V4M7.5 8.5L12 4l4.5 4.5M4 16v3h16v-3"/>',
    file: '<path d="M13 3H7v18h11V8zM13 3v5h5"/>',
    lock: '<path d="M6 11h12v9H6zM9.2 11V8a2.8 2.8 0 0 1 5.6 0v3"/>',
    unlock: '<path d="M6 11h12v9H6zM9.2 11V8a2.8 2.8 0 0 1 5.5-.7"/>',
    check: '<path d="M5 12.6l4.6 4.6L19 7.8"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    warning: '<path d="M12 4.5L21 20H3zM12 10v4M12 16.6v.6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 8v.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    filter: '<path d="M4 6h16l-6 7v6l-4-2v-4z"/>',
    download: '<path d="M12 4v12M7.5 11.5L12 16l4.5-4.5M4 20h16"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
    trash: '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>',
    copy: '<path d="M9 9h11v11H9zM15 9V4H4v11h5"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 6v5h-5"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4M16.5 5.2a3.2 3.2 0 0 1 0 6M18 14.8c2 .6 3.5 2.4 3.5 5.2"/>',
    version: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="12" r="2.4"/><path d="M6 8.4v7.2M8.4 6H13a3 3 0 0 1 3 3v.6M8.4 18H13a3 3 0 0 0 3-3v-.6"/>',
    flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
    table: '<path d="M4 5h16v14H4zM4 10h16M10 10v9"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/>',
    bolt: '<path d="M13 3L5 14h5l-1 7 8-11h-5z"/>',
    clipboard: '<path d="M9 4h6v2H9zM7 6h10v15H7z"/><path d="M10 11h5M10 15h4"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
    external: '<path d="M14 4h6v6M20 4l-8 8M18 14v6H4V6h6"/>'
  };

  /** icon('check', 16) → svg markup string */
  function icon(name, size, cls) {
    var p = ICON_PATHS[name] || ICON_PATHS.info;
    var s = size || 16;
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      p + '</svg>';
  }

  /* ---------- CSV ---------- */
  /** RFC-4180-ish CSV parser → {columns:[], rows:[{col:val}]} */
  function parseCSV(text) {
    var rows = [], row = [], cell = '', inQ = false, i = 0;
    text = String(text).replace(/^﻿/, '');
    while (i < text.length) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (!rows.length) return { columns: [], rows: [] };
    var columns = rows[0].map(function (c, idx) { return String(c).trim() || 'Column ' + (idx + 1); });
    var out = rows.slice(1).map(function (r) {
      var o = {};
      columns.forEach(function (c, idx) { o[c] = (r[idx] === undefined ? '' : String(r[idx]).trim()); });
      return o;
    });
    return { columns: columns, rows: out };
  }

  /** CSV → array of raw cell arrays (no header handling). */
  function parseCSVRows(text) {
    var rows = [], row = [], cell = '', inQ = false, i = 0;
    text = String(text).replace(/^﻿/, '');
    while (i < text.length) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === ',' || ch === '\t' || ch === ';') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return String(c).trim(); }); });
  }

  /**
   * Parse a tabular file that may hold SEVERAL blocks in one sheet — the shape
   * instrument software exports when a run covers multiple analytes:
   *
   *     Name , Mitragynine
   *     Flags, Data Filename, Sample ID, ...      <- header repeats per block
   *     ...rows...
   *     Name , Temazepam
   *     Flags, Data Filename, Sample ID, ...
   *     ...rows...
   *
   * When repeated headers are found, each block's label is promoted to a real
   * column so downstream screens see one flat table with a section field.
   * Falls back to a plain single-header parse.
   * → { columns, rows, sections:[{label,count}], sectionField }
   */
  function parseTable(text) {
    var raw = parseCSVRows(text).filter(function (r) {
      return r.some(function (c) { return c !== ''; });
    });
    if (!raw.length) return { columns: [], rows: [], sections: [], sectionField: null };

    function nonEmpty(r) { return r.filter(function (c) { return c !== ''; }).length; }
    function sig(r) { return r.join('').toLowerCase(); }

    /* a header row is one that repeats verbatim and is the widest kind of row */
    var counts = {};
    raw.forEach(function (r) { if (nonEmpty(r) >= 3) counts[sig(r)] = (counts[sig(r)] || 0) + 1; });
    var headerSig = null, headerWidth = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] < 2) return;
      var w = k.split('').filter(Boolean).length;
      if (w > headerWidth) { headerWidth = w; headerSig = k; }
    });

    if (!headerSig) {
      var flat = fromHeader(raw[0], raw.slice(1));
      return { columns: flat.columns, rows: flat.rows, sections: [], sectionField: null };
    }

    /* split into blocks at each header occurrence, labelling from the row above */
    var headerIdx = [];
    raw.forEach(function (r, i) { if (sig(r) === headerSig) headerIdx.push(i); });
    var headerCells = raw[headerIdx[0]];
    var labelKey = null, sections = [], out = [];

    headerIdx.forEach(function (start, n) {
      var end = n + 1 < headerIdx.length ? headerIdx[n + 1] : raw.length;
      /* label = closest preceding row carrying just a caption + value */
      var label = '', key = '';
      for (var j = start - 1; j >= 0 && j > start - 4; j--) {
        var cells = raw[j].filter(function (c) { return c !== ''; });
        if (cells.length === 1) { label = cells[0]; break; }
        if (cells.length === 2) { key = cells[0]; label = cells[1]; break; }
      }
      if (!labelKey && key) labelKey = key;
      var body = [];
      for (var k = start + 1; k < end; k++) {
        var r = raw[k];
        if (nonEmpty(r) < 2) continue;                       // spacer / note row
        if (r.filter(function (c) { return c !== ''; }).length <= 2 && k > start + 1) continue;
        body.push(r);
      }
      if (!body.length) return;
      sections.push({ label: label || 'Section ' + (n + 1), count: body.length });
      out.push({ label: label || 'Section ' + (n + 1), body: body });
    });

    var sectionField = labelKey ? labelKey : 'Section';
    if (/^name$/i.test(sectionField)) sectionField = 'Analyte Name';
    var base = fromHeader(headerCells, []);
    var columns = [sectionField].concat(base.columns);
    var rows = [];
    out.forEach(function (blk) {
      fromHeader(headerCells, blk.body).rows.forEach(function (o) {
        var rec = {};
        rec[sectionField] = blk.label;
        base.columns.forEach(function (c) { rec[c] = o[c]; });
        rows.push(rec);
      });
    });
    return { columns: columns, rows: rows, sections: sections, sectionField: sectionField };
  }

  /** Build objects from a header row + body rows, naming blank/duplicate columns. */
  function fromHeader(headerCells, body) {
    var seen = {};
    var columns = headerCells.map(function (c, idx) {
      var name = String(c).trim() || 'Column ' + (idx + 1);
      if (seen[name]) { seen[name]++; name = name + ' (' + seen[name] + ')'; }
      else seen[name] = 1;
      return name;
    });
    var rows = body.map(function (r) {
      var o = {};
      columns.forEach(function (c, idx) { o[c] = r[idx] === undefined ? '' : String(r[idx]).trim(); });
      return o;
    });
    return { columns: columns, rows: rows };
  }

  function toCSV(columns, rows) {
    function q(v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return [columns.map(q).join(',')]
      .concat(rows.map(function (r) { return columns.map(function (c) { return q(r[c]); }).join(','); }))
      .join('\n');
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  /* ---------- value / type inference ---------- */
  var DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{4}|\d{1,2}-[A-Za-z]{3}-\d{4})([ T]\d{1,2}:\d{2}(:\d{2})?)?(\s?[AaPp]\.?[Mm]\.?)?$/;
  var NUM_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
  var BOOL_VALUES = ['true', 'false', 'yes', 'no', 'y', 'n'];

  /**
   * Instrument exports write "no result" in many dialects (LC-MS/MS files use
   * "----", "N.I.(High)" and similar). These are treated as missing everywhere
   * so a numeric column is still detected as numeric. Editable in Settings.
   */
  var MISSING_TOKENS = ['----', '---', '--', '-', 'n/a', 'n.a.', 'na', 'null', 'nan', 'none',
    '#n/a', '#value!', 'n.i.', 'n.i.(high)', 'n.i.(low)', 'not detected', 'no peak'];

  /**
   * Display text for a cell: the value EXACTLY as it was uploaded.
   *
   * Deliberately not isBlank() — tokens like "----", "N.I. High" and "No Peak"
   * are real instrument output that the criteria treat as "no numeric value",
   * but they must still be shown to the user as themselves. Only a genuinely
   * absent cell renders as a dash.
   */
  function displayValue(v) {
    if (v === null || v === undefined) return '';
    return String(v);
  }
  function isEmptyCell(v) {
    return v === null || v === undefined || String(v) === '';
  }

  function isBlank(v) {
    if (v === null || v === undefined) return true;
    var s = String(v).trim();
    if (!s) return true;
    return MISSING_TOKENS.indexOf(s.toLowerCase()) > -1;
  }
  function setMissingTokens(list) {
    MISSING_TOKENS.length = 0;
    (list || []).forEach(function (t) {
      var s = String(t).trim().toLowerCase();
      if (s && MISSING_TOKENS.indexOf(s) === -1) MISSING_TOKENS.push(s);
    });
    return MISSING_TOKENS;
  }
  function isNumeric(v) { return !isBlank(v) && NUM_RE.test(String(v).trim()); }
  function isDateLike(v) { return !isBlank(v) && DATE_RE.test(String(v).trim()) && !isNaN(parseDate(v).getTime()); }
  function isBoolLike(v) { return !isBlank(v) && BOOL_VALUES.indexOf(String(v).trim().toLowerCase()) > -1; }
  function toNumber(v) { return isNumeric(v) ? parseFloat(String(v).trim()) : NaN; }
  function toBool(v) { return ['true', 'yes', 'y', '1'].indexOf(String(v).trim().toLowerCase()) > -1; }
  /**
   * Parse the date dialects instrument exports actually use, including
   * "6/29/2026 12:24:55 PM" and "29-Jun-2026". For ambiguous slash dates the
   * day/month order is inferred from the values themselves (a component above
   * 12 must be the day); otherwise month-first is assumed.
   */
  function parseDate(v) {
    var s = String(v).trim();
    // ISO date(-time) — parse as LOCAL so a date-only value never shifts a day
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (iso) {
      return new Date(+iso[1], +iso[2] - 1, +iso[3],
        iso[4] === undefined ? 0 : +iso[4], iso[5] === undefined ? 0 : +iso[5], iso[6] === undefined ? 0 : +iso[6]);
    }
    var slash = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
    if (slash) {
      var p1 = +slash[1], p2 = +slash[2], year = +slash[3];
      var day, month;
      if (p1 > 12) { day = p1; month = p2; }        // dd/mm/yyyy
      else if (p2 > 12) { month = p1; day = p2; }   // mm/dd/yyyy
      else { month = p1; day = p2; }                // ambiguous → month first
      var hh = slash[4] === undefined ? 0 : +slash[4];
      var mm = slash[5] === undefined ? 0 : +slash[5];
      var ss = slash[6] === undefined ? 0 : +slash[6];
      var ap = (slash[7] || '').toLowerCase();
      if (ap === 'pm' && hh < 12) hh += 12;
      if (ap === 'am' && hh === 12) hh = 0;
      return new Date(year, month - 1, day, hh, mm, ss);
    }
    var m2 = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);    // dd-Mon-yyyy
    if (m2) {
      var mi = MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m2[2].toLowerCase());
      if (mi > -1) return new Date(+m2[3], mi, +m2[1]);
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    return new Date(s.replace(' ', 'T'));
  }
  function decimalsOf(v) {
    var s = String(v).trim(); var i = s.indexOf('.');
    return i === -1 ? 0 : s.length - i - 1;
  }

  /**
   * Infer a field's data type from a sample of its values.
   * Purely data-driven — no column-name assumptions anywhere.
   */
  function inferType(values) {
    var vals = values.filter(function (v) { return !isBlank(v); }).slice(0, 400);
    if (!vals.length) return 'text';
    var n = 0, d = 0, b = 0;
    vals.forEach(function (v) {
      if (isNumeric(v)) n++;
      else if (isDateLike(v)) d++;
      else if (isBoolLike(v)) b++;
    });
    var t = vals.length;
    if (b / t >= 0.9) return 'boolean';
    if (n / t >= 0.9) return 'number';
    if (d / t >= 0.9) return 'date';
    return 'text';
  }

  /** Build field descriptors (name, type, distinct sample, stats) from parsed rows. */
  function describeFields(columns, rows) {
    return columns.map(function (c) {
      var values = rows.map(function (r) { return r[c]; });
      var type = inferType(values);
      var distinct = [];
      for (var i = 0; i < values.length && distinct.length < 60; i++) {
        var v = values[i];
        if (!isBlank(v) && distinct.indexOf(String(v)) === -1) distinct.push(String(v));
      }
      var nums = type === 'number' ? values.filter(isNumeric).map(toNumber) : [];
      return {
        name: c,
        type: type,
        distinct: distinct,
        distinctCount: distinct.length,
        blanks: values.filter(isBlank).length,
        min: nums.length ? Math.min.apply(null, nums) : null,
        max: nums.length ? Math.max.apply(null, nums) : null
      };
    });
  }

  global.U = {
    $: $, $$: $$, el: el, esc: esc, on: on,
    uid: uid, clone: clone, debounce: debounce, clamp: clamp, sum: sum, seededRandom: seededRandom,
    fmtInt: fmtInt, fmtNum: fmtNum, fmtPct: fmtPct, fmtBytes: fmtBytes,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, isoDate: isoDate, relTime: relTime,
    initials: initials, titleCase: titleCase, pad: pad, MONTHS: MONTHS,
    icon: icon, ICON_PATHS: ICON_PATHS,
    parseCSV: parseCSV, parseCSVRows: parseCSVRows, parseTable: parseTable, toCSV: toCSV, downloadText: downloadText,
    MISSING_TOKENS: MISSING_TOKENS, setMissingTokens: setMissingTokens,
    isBlank: isBlank, displayValue: displayValue, isEmptyCell: isEmptyCell, isNumeric: isNumeric, isDateLike: isDateLike, isBoolLike: isBoolLike,
    toNumber: toNumber, toBool: toBool, parseDate: parseDate, decimalsOf: decimalsOf,
    inferType: inferType, describeFields: describeFields
  };
}(typeof window !== 'undefined' ? window : this));
