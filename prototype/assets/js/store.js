/* ============================================================
   store.js — application state and persistence.

   The model is deliberately small:

       Analytic  →  Upload[]  →  Upload.report

   An analytic is a folder. An upload is one Excel/CSV file, processed
   once, the moment it arrives. Its report belongs to that upload and is
   never touched again, so a new upload can never disturb an older one.

   Every mutation goes through this module, so each one maps onto a REST
   call later without touching screen code.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'lisa.state.v2';

  var DEMO_USER = { name: 'Admin User', email: 'admin@analytics.com', role: 'Administrator', initials: 'AU' };
  var CREDENTIALS = { email: 'admin@analytics.com', password: 'Admin@123' };

  var STATUS_META = {
    draft: { label: 'No uploads', badge: 'badge-neutral', cls: 's-draft' },
    active: { label: 'Active', badge: 'badge-success', cls: 's-active' }
  };

  /* Upload lifecycle — three states, nothing to approve or unlock. */
  var UPLOAD_STATUS = {
    completed: { label: 'Completed', long: 'Completed', badge: 'badge-success' },
    exceptions: { label: 'Exceptions', long: 'Completed with exceptions', badge: 'badge-warn' },
    failed: { label: 'Failed', long: 'Failed — could not be processed', badge: 'badge-danger' }
  };

  var S = {
    user: null,
    loggedIn: false,
    analytics: [],
    notifications: [],
    ui: { sidebarCollapsed: false, lastRoute: 'dashboard' },
    settings: {
      pageSize: 25,
      missingTokens: U.MISSING_TOKENS.join(', ')
    },
    storageDegraded: false
  };

  /* ------------------------------------------------------------
     Persistence
     ------------------------------------------------------------ */
  /** Demo rows regenerate deterministically; uploaded rows do not. */
  function isSeedUpload(u) { return String(u.id).indexOf('seedup_') === 0; }

  function persistable(includeRecords) {
    return {
      user: S.user, loggedIn: S.loggedIn,
      notifications: S.notifications.slice(0, 30),
      ui: S.ui, settings: S.settings,
      analytics: S.analytics.map(function (a) {
        var b = Object.assign({}, a);
        b.uploads = (a.uploads || []).map(function (u) {
          var c = Object.assign({}, u);
          if (!includeRecords || isSeedUpload(u)) delete c.records;
          return c;
        });
        return b;
      })
    };
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(persistable(true)));
      S.storageDegraded = false;
      return true;
    } catch (e) {
      // Over quota with the rows included — keep everything else rather than
      // losing the session, and say so instead of failing quietly.
      try {
        localStorage.setItem(KEY, JSON.stringify(persistable(false)));
        S.storageDegraded = true;
      } catch (e2) { /* keep working from memory */ }
      return false;
    }
  }

  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return false;
    try {
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.analytics)) return false;
      S.user = data.user || null;
      S.loggedIn = !!data.loggedIn;
      S.notifications = data.notifications || [];
      S.ui = Object.assign(S.ui, data.ui || {});
      S.settings = Object.assign(S.settings, data.settings || {});
      S.analytics = data.analytics.map(function (a) {
        return Object.assign(blankAnalytic(), a, { uploads: a.uploads || [] });
      });
      S.analytics.forEach(function (a) {
        (a.uploads || []).forEach(function (u) {
          if (!u.records && isSeedUpload(u)) rehydrateSeedUpload(a, u);
        });
      });
      if (S.settings.missingTokens) {
        U.setMissingTokens(String(S.settings.missingTokens).split(',').map(function (t) { return t.trim(); }));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    S.analytics = [];
    S.notifications = [];
    bootstrap();
  }

  /* ------------------------------------------------------------
     Model
     ------------------------------------------------------------ */
  function blankAnalytic(o) {
    var now = new Date().toISOString();
    return Object.assign({
      id: U.uid('AN').toUpperCase(),
      name: 'Untitled Analytic',
      code: '',
      description: '',
      color: '#1A6BC4',
      createdAt: now,
      updatedAt: now,
      seed: null,
      uploads: []          // newest last; every upload keeps its own report
    }, o || {});
  }

  var PALETTE = ['#1A6BC4', '#0E8F86', '#6B4FD0', '#B3261E', '#E08A0B', '#137A45', '#14549B'];
  function pickColor(i) { return PALETTE[i % PALETTE.length]; }

  function all() { return S.analytics; }
  function get(id) { return S.analytics.filter(function (a) { return a.id === id; })[0] || null; }

  function create(data) {
    var a = blankAnalytic(Object.assign({ color: pickColor(S.analytics.length) }, data));
    S.analytics.unshift(a);
    save();
    return a;
  }

  function update(a, patch) {
    Object.assign(a, patch);
    touch(a);
    return a;
  }

  function remove(id) {
    S.analytics = S.analytics.filter(function (a) { return a.id !== id; });
    save();
  }

  function touch(a) { a.updatedAt = new Date().toISOString(); save(); }

  function statusOf(a) { return (a.uploads && a.uploads.length) ? 'active' : 'draft'; }

  /* ------------------------------------------------------------
     Uploads
     ------------------------------------------------------------ */
  function uploadsOf(a) { return a.uploads || []; }

  /** Newest first — the order the history is always shown in. */
  function uploadsNewestFirst(a) {
    return uploadsOf(a).slice().sort(function (x, y) {
      return new Date(y.uploadedAt) - new Date(x.uploadedAt);
    });
  }

  function uploadOf(a, uploadId) {
    return uploadsOf(a).filter(function (u) { return u.id === uploadId; })[0] || null;
  }

  function latestUpload(a) { return uploadsNewestFirst(a)[0] || null; }

  /**
   * A row carrying nothing in ANY column is a spacer, not a record — trailing
   * rows, separator lines, rows of "----". They are dropped on the way in and
   * the number dropped is reported, never silently discarded.
   */
  function splitBlankRows(rows, columns) {
    var kept = [], skipped = 0;
    var cols = columns && columns.length ? columns : null;
    (rows || []).forEach(function (r) {
      var keys = cols || Object.keys(r);
      if (keys.some(function (c) { return !U.isBlank(r[c]); })) kept.push(r);
      else skipped++;
    });
    return { rows: kept, skipped: skipped };
  }

  /**
   * THE core operation: take one uploaded file, keep it as its own upload,
   * process it and store the analytics it produced.
   *
   * `file` = { meta:{name,size,type,simulated}, columns:[], rows:[] }
   */
  function addUpload(a, file) {
    var clean = splitBlankRows(file.rows, file.columns);
    var upload = {
      id: U.uid('up'),
      no: nextUploadNo(a),
      fileName: file.meta.name,
      size: file.meta.size || 0,
      type: file.meta.type || '',
      uploadedAt: file.meta.uploadedAt || new Date().toISOString(),
      uploadedBy: file.meta.uploadedBy || currentUserName(),
      status: 'completed',
      statusNote: '',
      simulated: !!file.meta.simulated,
      columns: file.columns || [],
      records: clean.rows,
      rowCount: clean.rows.length,
      columnCount: (file.columns || []).length,
      blankRowsSkipped: clean.skipped,
      rawRowCount: (file.rows || []).length,
      seedPart: file.meta.seedPart || null,
      report: null
    };

    try {
      upload.report = Analyze.run({
        name: upload.fileName, columns: upload.columns, rows: upload.records,
        analyte: a.name
      });
      var rep = upload.report;
      upload.status = (rep.failed || rep.warnings) ? 'exceptions' : 'completed';
      upload.statusNote = rep.notEvaluated === rep.total
        ? U.fmtInt(rep.total) + ' rows profiled — no criterion applied to this file'
        : U.fmtInt(rep.passed) + ' of ' + U.fmtInt(rep.total) + ' rows passed';
    } catch (err) {
      upload.status = 'failed';
      upload.statusNote = 'Could not be processed — ' + err.message;
    }

    a.uploads.push(upload);
    touch(a);
    return upload;
  }

  function nextUploadNo(a) {
    return uploadsOf(a).reduce(function (m, u) { return Math.max(m, u.no || 0); }, 0) + 1;
  }

  function currentUserName() { return (S.user && S.user.name) || DEMO_USER.name; }

  function deleteUpload(a, uploadId) {
    a.uploads = uploadsOf(a).filter(function (u) { return u.id !== uploadId; });
    touch(a);
  }

  /** Every upload across every analytic, newest first. */
  function recentUploads(limit) {
    var out = [];
    S.analytics.forEach(function (a) {
      uploadsOf(a).forEach(function (u) { out.push({ analytic: a, upload: u }); });
    });
    out.sort(function (x, y) { return new Date(y.upload.uploadedAt) - new Date(x.upload.uploadedAt); });
    return limit ? out.slice(0, limit) : out;
  }

  /* ------------------------------------------------------------
     Outputs — built from ONE upload, in that file's own columns
     ------------------------------------------------------------ */
  /** The rows that passed, exactly as they were uploaded. */
  function passedOutput(a, upload) {
    if (!upload || !upload.report || !upload.records) return null;
    var exceptions = exceptionIndex(upload.report);
    var cols = upload.columns.slice();
    var rows = [];
    upload.records.forEach(function (rec, i) {
      if (exceptions[i]) return;
      var out = {};
      cols.forEach(function (c) { out[c] = rec[c] === undefined ? '' : rec[c]; });
      rows.push(out);
    });
    return { columns: cols, rows: rows };
  }

  var EXCEPTION_META = ['Analytic', 'Sample Stream', 'Source File', 'Sample ID', 'Criterion',
    'Failed Column', 'Actual Value', 'Minimum', 'Maximum', 'Reason', 'Severity', 'Processed At'];

  /** One row per finding, carrying the original record alongside it. */
  function exceptionsOutput(a, upload) {
    if (!upload || !upload.report || !upload.records) return null;
    var cols = upload.columns.slice();
    var rows = [];
    (upload.report.exceptions || []).forEach(function (ex) {
      var rec = upload.records[ex.i] || {};
      ex.issues.forEach(function (f) {
        var line = {};
        cols.forEach(function (c) { line[c] = rec[c] === undefined ? '' : rec[c]; });
        line['Analytic'] = a.name;
        line['Sample Stream'] = Analyze.streamLabel(ex.stream);
        line['Source File'] = upload.fileName;
        line['Sample ID'] = ex.id;
        line['Criterion'] = f.name;
        line['Failed Column'] = f.column || '';
        line['Actual Value'] = f.actual === undefined || f.actual === null ? '' : f.actual;
        line['Minimum'] = f.min === undefined || f.min === null ? '' : f.min;
        line['Maximum'] = f.max === undefined || f.max === null ? '' : f.max;
        line['Reason'] = f.reason;
        line['Severity'] = f.severity;
        line['Processed At'] = U.fmtDateTime(upload.report.generatedAt);
        rows.push(line);
      });
    });
    return { columns: cols.concat(EXCEPTION_META), rows: rows };
  }

  /** rowIndex → exception entry, for the report tables and the passed file. */
  function exceptionIndex(report) {
    var idx = {};
    (report.exceptions || []).forEach(function (ex) { idx[ex.i] = ex; });
    return idx;
  }

  function outputName(a, upload, kind) {
    var base = (a.code || a.name).replace(/[^A-Za-z0-9]+/g, '_');
    var file = upload.fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_');
    return base + '_' + file + '_' + kind + '.csv';
  }

  /* ------------------------------------------------------------
     Notifications
     ------------------------------------------------------------ */
  function notify(n) {
    S.notifications.unshift(Object.assign({
      id: U.uid('n'), ts: new Date().toISOString(), read: false, kind: 'info'
    }, n));
    if (S.notifications.length > 30) S.notifications.length = 30;
    save();
  }
  function unreadCount() { return S.notifications.filter(function (n) { return !n.read; }).length; }
  function markAllRead() { S.notifications.forEach(function (n) { n.read = true; }); save(); }

  /* ------------------------------------------------------------
     Aggregates
     ------------------------------------------------------------ */
  function overview() {
    var o = {
      analytics: S.analytics.length, uploads: 0, rows: 0,
      passed: 0, failed: 0, warnings: 0, failedUploads: 0, lastUploadAt: null
    };
    S.analytics.forEach(function (a) {
      uploadsOf(a).forEach(function (u) {
        o.uploads++;
        o.rows += u.rowCount || 0;
        if (u.status === 'failed') o.failedUploads++;
        if (u.report) {
          o.passed += u.report.passed; o.failed += u.report.failed; o.warnings += u.report.warnings;
        }
        if (!o.lastUploadAt || new Date(u.uploadedAt) > new Date(o.lastUploadAt)) o.lastUploadAt = u.uploadedAt;
      });
    });
    var judged = o.passed + o.failed + o.warnings;
    o.passRate = judged ? (o.passed / judged) * 100 : null;
    return o;
  }

  /* ------------------------------------------------------------
     Auth
     ------------------------------------------------------------ */
  function login(email, password) {
    if (String(email).trim().toLowerCase() !== CREDENTIALS.email) {
      return { ok: false, error: 'No account found for this email address.' };
    }
    if (password !== CREDENTIALS.password) {
      return { ok: false, error: 'Incorrect password. Use Admin@123 for this prototype.' };
    }
    S.user = Object.assign({}, DEMO_USER);
    S.loggedIn = true;
    save();
    return { ok: true, user: S.user };
  }
  function logout() { S.loggedIn = false; save(); }

  /* ------------------------------------------------------------
     Demo data
     ------------------------------------------------------------ */
  function daysAgo(n, h, m) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    if (h !== undefined) d.setHours(h, m || 0, 0, 0);
    return d.toISOString();
  }

  function bootstrap() {
    S.analytics = Seed.CATALOG.map(function (spec, i) {
      var a = blankAnalytic({
        id: spec.id, name: spec.name, code: spec.code, description: spec.description,
        color: spec.color, seed: { catalogId: spec.id },
        createdAt: daysAgo(60 - i * 5, 9, 15), updatedAt: daysAgo(3, 11, 20)
      });
      seedUploads(a, spec);
      return a;
    });
    seedNotifications();
    save();
  }

  /** Build an analytic's demo upload history, each one processed on arrival. */
  function seedUploads(a, spec) {
    if (spec.stage === 'empty') return;                 // deliberately left with no uploads
    fileSpecs(spec).forEach(function (fs, i) {
      var ds = generateFor(spec, fs, i);
      var u = addUpload(a, {
        meta: {
          name: fs.name,
          size: ds.rows.length * ds.columns.length * 9 + 500,
          type: 'text/csv',
          uploadedAt: fs.uploadedAt,
          uploadedBy: fs.uploadedBy,
          seedPart: fs.part || null
        },
        columns: ds.columns, rows: ds.rows
      });
      u.id = 'seedup_' + a.id + '_' + i;
    });
    a.updatedAt = latestUpload(a) ? latestUpload(a).uploadedAt : a.updatedAt;
  }

  /** The demo files an analytic has "received", oldest first. */
  function fileSpecs(spec) {
    if (spec.lisa) {
      return spec.lisa.files.map(function (f, i) {
        return {
          name: f.name, lisa: f, index: i,
          uploadedAt: daysAgo(spec.lisa.files.length - i, 8, 30 + i * 14),
          uploadedBy: i % 2 ? 'M. Kulkarni' : DEMO_USER.name
        };
      });
    }
    var parts = spec.gen.parts || [null];
    return parts.map(function (part, i) {
      return {
        name: parts.length > 1
          ? spec.gen.file.replace(/(\.[^.]+)$/, '_run' + (i + 1) + '$1')
          : spec.gen.file,
        part: part, index: i,
        uploadedAt: daysAgo(12 - i * 4, 9, 40 + i * 20),
        uploadedBy: i % 2 ? 'A. Deshmukh' : DEMO_USER.name
      };
    });
  }

  function generateFor(spec, fs, i) {
    return spec.lisa
      ? Seed.generateLisaFile(spec.lisa, spec.seedNo + i * 23, fs.lisa)
      : Seed.generateDataset(spec.gen, spec.seedNo + i * 17, fs.part);
  }

  /** Demo rows are not persisted — rebuild them from the catalogue on load. */
  function rehydrateSeedUpload(a, u) {
    var spec = Seed.CATALOG.filter(function (c) { return c.id === (a.seed && a.seed.catalogId); })[0];
    if (!spec) return;
    var i = parseInt(String(u.id).split('_').pop(), 10) || 0;
    var fs = fileSpecs(spec)[i];
    if (!fs) return;
    var ds = generateFor(spec, fs, i);
    var clean = splitBlankRows(ds.rows, ds.columns);
    u.records = clean.rows;
    u.columns = ds.columns;
  }

  function seedNotifications() {
    if (S.notifications.length) return;
    recentUploads(3).forEach(function (r, i) {
      var rep = r.upload.report;
      notify({
        kind: rep && rep.failed ? 'warn' : 'success',
        title: r.analytic.name + ' — ' + r.upload.fileName,
        text: rep
          ? U.fmtInt(rep.passed) + ' passed · ' + U.fmtInt(rep.failed) + ' failed · ' +
            U.fmtInt(rep.warnings) + ' warning(s)'
          : 'Upload could not be processed.',
        analyticId: r.analytic.id, uploadId: r.upload.id, read: i > 0
      });
    });
  }

  function init() {
    if (!load()) bootstrap();
    if (!S.user) S.user = Object.assign({}, DEMO_USER);
    return S;
  }

  global.Store = {
    S: S, CREDENTIALS: CREDENTIALS, STATUS_META: STATUS_META, UPLOAD_STATUS: UPLOAD_STATUS,
    init: init, save: save, reset: reset, bootstrap: bootstrap,
    login: login, logout: logout,
    all: all, get: get, create: create, update: update, remove: remove, statusOf: statusOf,
    blankAnalytic: blankAnalytic,
    uploadsOf: uploadsOf, uploadsNewestFirst: uploadsNewestFirst, uploadOf: uploadOf,
    latestUpload: latestUpload, addUpload: addUpload, deleteUpload: deleteUpload,
    recentUploads: recentUploads, splitBlankRows: splitBlankRows,
    passedOutput: passedOutput, exceptionsOutput: exceptionsOutput,
    exceptionIndex: exceptionIndex, outputName: outputName,
    notify: notify, unreadCount: unreadCount, markAllRead: markAllRead,
    overview: overview
  };
}(typeof window !== 'undefined' ? window : this));
