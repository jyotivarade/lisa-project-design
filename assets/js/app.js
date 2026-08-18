/* ============================================================
   app.js — bootstrap, authentication, hash router, sidebar,
   top header chrome and screen dispatch.
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;

  var App = global.App = {};
  var current = { route: 'dashboard', params: {} };

  /* ============================================================
     NAVIGATION MODEL
     ============================================================ */
  var NAV = [
    { route: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    {
      route: 'analytics', label: 'Analytics', icon: 'beaker', children: [
        { route: 'analytics', label: 'All Analytics', match: function (r, p) { return r === 'analytics' && !p.filter; } },
        { route: 'analytics?filter=active', label: 'Active', match: function (r, p) { return r === 'analytics' && p.filter === 'active'; } },
        { route: 'analytics?filter=draft', label: 'Drafts', match: function (r, p) { return r === 'analytics' && p.filter === 'draft'; } }
      ]
    },
    {
      route: 'validation', label: 'Validation', icon: 'shield', children: [
        { route: 'validation', label: 'Control & Calibration' },
        { route: 'patient-testing', label: 'Patient Testing' },
        { route: 'history', label: 'Validation History' }
      ]
    },
    { route: 'rules', label: 'Rules Engine', icon: 'rules' },
    { route: 'reports', label: 'Reports', icon: 'report' },
    { route: 'audit', label: 'Audit Logs', icon: 'audit' },
    { route: 'settings', label: 'Settings', icon: 'settings' }
  ];

  /* ============================================================
     ROUTER
     ============================================================ */
  function parseHash() {
    var raw = (location.hash || '').replace(/^#\/?/, '');
    var hashPart = '';
    var hashIdx = raw.indexOf('#');
    if (hashIdx > -1) { hashPart = raw.slice(hashIdx + 1); raw = raw.slice(0, hashIdx); }
    var qIdx = raw.indexOf('?');
    var params = { hash: hashPart };
    if (qIdx > -1) {
      raw.slice(qIdx + 1).split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      raw = raw.slice(0, qIdx);
    }
    var segs = raw.split('/').filter(Boolean).map(decodeURIComponent);
    return { segs: segs, params: params };
  }

  App.go = function (route) {
    var target = '#/' + String(route).replace(/^#?\/?/, '');
    if (location.hash === target) { App.render(); return; }
    location.hash = target;
  };

  App.render = function () {
    var parsed = parseHash();
    var segs = parsed.segs;
    var params = parsed.params;
    var view = U.$('#view');

    if (!Store.S.loggedIn) { showAuth(); return; }
    showApp();

    var route = segs[0] || 'dashboard';
    current = { route: route, params: params, segs: segs };
    Store.S.ui.lastRoute = location.hash.replace(/^#\/?/, '') || 'dashboard';

    var node = null, crumbs = [];

    try {
      if (route === 'dashboard') { node = Screens.dashboard(); crumbs = [['Dashboard']]; }
      else if (route === 'analytics') {
        node = Screens.analytics(params);
        crumbs = [['Analytics', 'analytics'], [params.filter ? U.titleCase(params.filter) : 'All Analytics']];
      } else if (route === 'analytic') {
        var a = Store.get(segs[1]);
        if (!a) { node = notFound('Analytic not found', 'It may have been deleted in this session.'); crumbs = [['Analytics', 'analytics'], ['Not found']]; }
        else {
          var step = segs[2] || 'overview';
          node = renderStep(a, step);
          crumbs = [['Analytics', 'analytics'], [a.name, 'analytic/' + a.id], [stepLabel(step)]];
        }
      } else if (route === 'validation') { node = Screens.validationIndex(); crumbs = [['Validation'], ['Control & Calibration']]; }
      else if (route === 'patient-testing') { node = Screens.patientIndex(); crumbs = [['Validation'], ['Patient Testing']]; }
      else if (route === 'history') { node = Screens.history(); crumbs = [['Validation'], ['Validation History']]; }
      else if (route === 'rules') { node = Screens.rulesEngine(); crumbs = [['Rules Engine']]; }
      else if (route === 'reports') { node = Screens.reports(); crumbs = [['Reports']]; }
      else if (route === 'audit') { node = Screens.audit(params); crumbs = [['Audit Logs']]; }
      else if (route === 'settings') { node = Screens.settings(params); crumbs = [['Settings']]; }
      else { node = notFound('Page not found', 'The route "' + route + '" does not exist.'); crumbs = [['Not found']]; }
    } catch (err) {
      console.error(err);
      node = notFound('Something went wrong rendering this screen', err.message);
      crumbs = [['Error']];
    }

    view.innerHTML = '';
    view.appendChild(node);
    paintCrumbs(crumbs);
    paintNav();
    App.paintChrome();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    Store.save();
  };

  function renderStep(a, step) {
    switch (step) {
      case 'overview': return Screens.analyticOverview(a);
      case 'upload': return Screens.upload(a);
      case 'files': return Screens.files(a);
      case 'preview': return Screens.preview(a, current.params);
      case 'analytics': return Screens.analyticsStep(a);
      case 'mapping': return Screens.mapping(a);
      case 'samples': return Screens.samples(a);
      case 'fields': return Screens.fields(a);
      case 'criteria': return Screens.criteria(a);
      case 'config': return Screens.analyteConfig(a);
      case 'processing': return Screens.processing(a, current.params);
      case 'rules': return Screens.rules(a);
      case 'validation': return Screens.validation(a);
      case 'approval': return Screens.approval(a);
      case 'patient': return Screens.patient(a);
      case 'results': return Screens.results(a);
      case 'history': return Screens.analyticHistory(a);
      default: return Screens.analyticOverview(a);
    }
  }
  function stepLabel(step) {
    var map = {
      overview: 'Overview', upload: 'Upload Files', files: 'Files', preview: 'File Preview',
      analytics: 'Analytics', mapping: 'Sample Types', samples: 'Sample Selection', fields: 'Fields',
      criteria: 'Criteria Module', config: 'Analyte Configuration', processing: 'Processing',
      rules: 'Rules', validation: 'QC Validation', approval: 'Approval',
      patient: 'Patient Testing', results: 'Results', history: 'Validation History'
    };
    return map[step] || U.titleCase(step);
  }

  function notFound(title, desc) {
    return Screens.card({
      body: UI.emptyState({
        icon: 'warning', title: title, desc: desc,
        actions: [UI.btn('Back to dashboard', 'btn-primary', function () { App.go('dashboard'); }, { icon: 'dashboard' })]
      })
    });
  }

  /* ============================================================
     CHROME
     ============================================================ */
  function paintCrumbs(crumbs) {
    var box = U.$('#crumbs');
    box.innerHTML = '';
    crumbs.forEach(function (c, i) {
      if (i) box.appendChild(el('span', { class: 'sep', html: U.icon('chevronRight', 13) }));
      if (c[1]) {
        var b = el('button', { type: 'button', text: c[0] });
        b.addEventListener('click', function () { App.go(c[1]); });
        box.appendChild(b);
      } else {
        box.appendChild(el('span', { class: 'current', text: c[0] }));
      }
    });
  }

  function paintNav() {
    var nav = U.$('#sidebar-nav');
    nav.innerHTML = '';
    var route = current.route, params = current.params || {};

    NAV.forEach(function (item) {
      var group = el('div', { class: 'nav-group' + (item.children ? ' has-sub' : '') });
      var isActive = route === item.route && !item.children;
      var parentActive = item.children
        ? item.children.some(function (c) { return matches(c, route, params); }) ||
          (item.route === 'analytics' && route === 'analytic') ||
          (item.route === 'validation' && ['validation', 'patient-testing', 'history'].indexOf(route) > -1)
        : false;

      var b = el('button', { class: 'nav-item' + (isActive || (parentActive && !item.children) ? ' active' : ''), type: 'button' });
      b.innerHTML = U.icon(item.icon, 17) + '<span>' + esc(item.label) + '</span>';
      if (item.route === 'analytics') {
        b.innerHTML += '<span class="nav-count">' + Store.all().length + '</span>';
      }
      b.addEventListener('click', function () { App.go(item.route); closeMobile(); });
      group.appendChild(b);

      if (item.children) {
        var sub = el('div', { class: 'nav-sub' });
        item.children.forEach(function (c) {
          var cb = el('button', { class: 'nav-item' + (matches(c, route, params) ? ' active' : ''), type: 'button' });
          var badge = '';
          if (c.route === 'patient-testing') {
            var locked = Store.all().filter(function (a) { return !Store.patientUnlocked(a); }).length;
            if (locked) badge = '<span class="nav-lock">' + U.icon('lock', 12) + '</span>';
          }
          cb.innerHTML = '<span>' + esc(c.label) + '</span>' + badge;
          cb.addEventListener('click', function () { App.go(c.route); closeMobile(); });
          sub.appendChild(cb);
        });
        group.appendChild(sub);
      }
      nav.appendChild(group);
    });
  }
  function matches(child, route, params) {
    if (child.match) return child.match(route, params);
    var base = child.route.split('?')[0];
    return base === route && !params.filter;
  }

  App.paintChrome = function () {
    var u = Store.S.user || {};
    var ini = u.initials || U.initials(u.name || 'Admin User');
    U.$('#sb-avatar').textContent = ini;
    U.$('#sb-user-name').textContent = u.name || 'Admin User';
    U.$('#sb-user-role').textContent = u.role || 'Administrator';
    U.$$('.user-btn .avatar').forEach(function (n) { n.textContent = ini; });
    U.$('.user-btn-name').textContent = u.name || 'Admin User';
    var pu = U.$('#user-pop .pop-user');
    if (pu) {
      pu.innerHTML = '<span class="avatar">' + esc(ini) + '</span><span><strong>' + esc(u.name || '') + '</strong><em>' + esc(u.email || '') + '</em></span>';
    }
    paintNotifications();
  };

  function paintNotifications() {
    var list = U.$('#notif-list');
    var unread = Store.unreadCount();
    U.$('#notif-dot').hidden = !unread;
    list.innerHTML = '';
    if (!Store.S.notifications.length) {
      list.innerHTML = '<p class="muted" style="padding:14px;font-size:12.5px;text-align:center">No notifications yet.</p>';
      return;
    }
    Store.S.notifications.slice(0, 12).forEach(function (n) {
      var tone = { success: 'green', error: 'red', warn: 'amber', info: 'blue' }[n.kind] || 'blue';
      var ico = { success: 'check', error: 'x', warn: 'warning', info: 'info' }[n.kind] || 'info';
      var item = el('div', { class: 'notif' + (n.read ? '' : ' unread') });
      item.innerHTML = '<span class="ni stat-ico ' + tone + '">' + U.icon(ico, 14) + '</span>' +
        '<div><p><strong>' + esc(n.title) + '</strong></p><p>' + esc(n.text) + '</p>' +
        '<time>' + esc(U.relTime(n.ts)) + '</time></div>';
      if (n.analyticId) {
        item.style.cursor = 'pointer';
        item.addEventListener('click', function () {
          n.read = true; Store.save();
          U.$('#notif-pop').hidden = true;
          App.go('analytic/' + n.analyticId);
        });
      }
      list.appendChild(item);
    });
  }

  App.applySidebar = function () {
    var shell = U.$('#app-shell');
    shell.classList.toggle('collapsed', !!Store.S.ui.sidebarCollapsed);
  };

  function closeMobile() {
    U.$('#app-shell').classList.remove('mobile-open');
  }

  /* ============================================================
     AUTH SCREENS
     ============================================================ */
  function showAuth() {
    U.$('#auth-screen').hidden = false;
    U.$('#app-shell').hidden = true;
    document.title = 'Sign in · LISA';
  }
  function showApp() {
    U.$('#auth-screen').hidden = true;
    U.$('#app-shell').hidden = false;
    document.title = 'LISA — Laboratory Information System Analysis';
  }

  function initLogin() {
    var form = U.$('#login-form');
    var emailWrap = U.$('#login-email').closest('.field');
    var passWrap = U.$('#login-password').closest('.field');
    var remembered = null;
    try { remembered = localStorage.getItem('analytix.remember'); } catch (e) {}
    if (remembered) {
      U.$('#login-email').value = remembered;
      U.$('#remember-me').checked = true;
    }

    U.$('#toggle-password').addEventListener('click', function () {
      var inp = U.$('#login-password');
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      this.innerHTML = show
        ? '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 4l16 16M10.5 10.7a2.6 2.6 0 0 0 3.5 3.6"/><path d="M6.7 7.3C4 9 2 12 2 12s3.6 6.5 10 6.5c1.7 0 3.2-.4 4.5-1M19.3 15.3C21 13.7 22 12 22 12s-3.6-6.5-10-6.5c-.7 0-1.4.1-2 .2"/></svg>'
        : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
    });

    U.$('#fill-demo').addEventListener('click', function () {
      U.$('#login-email').value = Store.CREDENTIALS.email;
      U.$('#login-password').value = Store.CREDENTIALS.password;
      clearErrors();
    });

    U.$('#forgot-link').addEventListener('click', function () {
      var email = UI.fieldGroup({ label: 'Work email', type: 'email', value: U.$('#login-email').value, placeholder: 'you@laboratory.com' });
      var body = el('div', {});
      body.innerHTML = '<p style="font-size:13px;color:var(--ink-2);line-height:1.6">Enter your work email and the laboratory administrator ' +
        'will be asked to issue a password reset link. In this prototype no email is actually sent.</p>';
      body.appendChild(el('div', { class: 'mt4' }, email));
      var m = UI.modal({
        title: 'Reset your password', size: 'narrow', body: body,
        footer: [
          UI.btn('Cancel', 'btn-secondary', function () { m.close(); }),
          UI.btn('Send reset link', 'btn-primary', function () {
            var v = email.input.value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { email.setError('Enter a valid email address'); return; }
            m.close();
            UI.toast({ kind: 'success', title: 'Reset link sent', text: 'If ' + v + ' is registered, a reset link is on its way.' });
          }, { icon: 'check' })
        ]
      });
    });

    function clearErrors() {
      emailWrap.classList.remove('invalid');
      passWrap.classList.remove('invalid');
    }
    U.$('#login-email').addEventListener('input', clearErrors);
    U.$('#login-password').addEventListener('input', clearErrors);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = U.$('#login-email').value.trim();
      var pass = U.$('#login-password').value;
      var ok = true;
      clearErrors();
      if (!email) { setErr(emailWrap, 'err-email', 'Email is required'); ok = false; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setErr(emailWrap, 'err-email', 'Enter a valid email address'); ok = false; }
      if (!pass) { setErr(passWrap, 'err-password', 'Password is required'); ok = false; }
      if (!ok) return;

      var btn = U.$('#login-btn');
      UI.loading(btn, true);
      setTimeout(function () {
        var res = Store.login(email, pass);
        UI.loading(btn, false);
        if (!res.ok) {
          setErr(passWrap, 'err-password', res.error);
          UI.toast({ kind: 'error', title: 'Sign in failed', text: res.error });
          return;
        }
        try {
          if (U.$('#remember-me').checked) localStorage.setItem('analytix.remember', email);
          else localStorage.removeItem('analytix.remember');
        } catch (err) {}
        UI.toast({ kind: 'success', title: 'Welcome back, ' + res.user.name.split(' ')[0], text: 'Signed in as ' + res.user.role + '.' });
        U.$('#login-password').value = '';
        App.go(Store.S.ui.lastRoute || 'dashboard');
        App.render();
      }, 750);
    });
  }
  function setErr(wrap, errId, msg) {
    wrap.classList.add('invalid');
    U.$('#' + errId).textContent = msg;
  }

  function doLogout() {
    UI.confirm({ title: 'Sign out?', message: 'Your prototype data stays saved in this browser.', confirmLabel: 'Sign out' })
      .then(function (ok) {
        if (!ok) return;
        Store.logout();
        showAuth();
        UI.toast({ kind: 'info', title: 'Signed out' });
      });
  }

  /* ============================================================
     GLOBAL WIRING
     ============================================================ */
  function initChrome() {
    U.$('#sidebar-toggle').addEventListener('click', function () {
      var shell = U.$('#app-shell');
      if (window.innerWidth <= 1024) shell.classList.toggle('mobile-open');
      else {
        Store.S.ui.sidebarCollapsed = !Store.S.ui.sidebarCollapsed;
        Store.save();
        App.applySidebar();
      }
    });
    U.$('#sidebar-scrim').addEventListener('click', closeMobile);
    U.$('#sb-logout').addEventListener('click', doLogout);
    U.$('#user-logout').addEventListener('click', function () { U.$('#user-pop').hidden = true; doLogout(); });

    /* popovers */
    function togglePop(id, other) {
      var p = U.$(id);
      var o = U.$(other);
      if (o) o.hidden = true;
      p.hidden = !p.hidden;
      if (id === '#notif-pop' && !p.hidden) paintNotifications();
    }
    U.$('#notif-btn').addEventListener('click', function (e) { e.stopPropagation(); togglePop('#notif-pop', '#user-pop'); });
    U.$('#user-btn').addEventListener('click', function (e) { e.stopPropagation(); togglePop('#user-pop', '#notif-pop'); });
    U.$('#notif-clear').addEventListener('click', function (e) {
      e.stopPropagation();
      Store.markAllRead(); paintNotifications(); App.paintChrome();
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.pop-wrap')) {
        U.$('#notif-pop').hidden = true;
        U.$('#user-pop').hidden = true;
      }
    });
    U.on(document, 'click', '[data-nav]', function () {
      var target = this.dataset.nav;
      U.$('#notif-pop').hidden = true;
      U.$('#user-pop').hidden = true;
      App.go(target);
    });

    /* overlays */
    U.$$('[data-close-modal]').forEach(function (n) { n.addEventListener('click', UI.closeModal); });
    U.$$('[data-close-drawer]').forEach(function (n) { n.addEventListener('click', UI.closeDrawer); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!U.$('#drawer-root').hidden) UI.closeDrawer();
      else if (!U.$('#modal-root').hidden) UI.closeModal();
      else closeMobile();
    });

    window.addEventListener('hashchange', App.render);
    window.addEventListener('resize', U.debounce(function () {
      if (window.innerWidth > 1024) closeMobile();
    }, 200));
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    Store.init();
    initLogin();
    initChrome();
    App.applySidebar();
    if (!location.hash) location.hash = '#/dashboard';
    App.render();
    if (Store.S.loggedIn) App.paintChrome();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}(typeof window !== 'undefined' ? window : this));
