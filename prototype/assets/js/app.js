/* ============================================================
   app.js — bootstrap, authentication, hash router, sidebar and the
   top header chrome.

   Four routes, and that is the whole application:

       #/dashboard
       #/analytics
       #/analytic/{id}                     upload + history
       #/analytic/{id}/upload/{uploadId}   the analytics for one upload
       #/settings
   ============================================================ */
(function (global) {
  'use strict';
  var el = U.el, esc = U.esc;

  var App = global.App = {};
  var current = { route: 'dashboard', params: {} };

  var NAV = [
    { route: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { route: 'analytics', label: 'Analytics', icon: 'beaker' },
    { route: 'settings', label: 'Settings', icon: 'settings' }
  ];

  /* ============================================================
     ROUTER
     ============================================================ */
  function parseHash() {
    var raw = (location.hash || '').replace(/^#\/?/, '');
    var qIdx = raw.indexOf('?');
    var params = {};
    if (qIdx > -1) {
      raw.slice(qIdx + 1).split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      raw = raw.slice(0, qIdx);
    }
    return { segs: raw.split('/').filter(Boolean).map(decodeURIComponent), params: params };
  }

  App.go = function (route) {
    var target = '#/' + String(route).replace(/^#?\/?/, '');
    if (location.hash === target) { App.render(); return; }
    location.hash = target;
  };

  App.render = function () {
    if (!Store.S.loggedIn) { showAuth(); return; }
    showApp();

    var parsed = parseHash();
    var segs = parsed.segs;
    var route = segs[0] || 'dashboard';
    current = { route: route, params: parsed.params, segs: segs };
    Store.S.ui.lastRoute = location.hash.replace(/^#\/?/, '') || 'dashboard';

    var node = null, crumbs = [];
    try {
      if (route === 'dashboard') { node = Screens.dashboard(); crumbs = [['Dashboard']]; }
      else if (route === 'analytics') { node = Screens.analytics(); crumbs = [['Analytics']]; }
      else if (route === 'analytic') {
        var a = Store.get(segs[1]);
        if (!a) {
          node = notFound('Analytic not found', 'It may have been deleted.');
          crumbs = [['Analytics', 'analytics'], ['Not found']];
        } else if (segs[2] === 'upload' && segs[3]) {
          var u = Store.uploadOf(a, segs[3]);
          if (!u) {
            node = notFound('Upload not found', 'This upload may have been deleted from ' + a.name + '.');
            crumbs = [['Analytics', 'analytics'], [a.name, 'analytic/' + a.id], ['Not found']];
          } else {
            node = Screens.uploadReport(a, u);
            crumbs = [['Analytics', 'analytics'], [a.name, 'analytic/' + a.id], ['Upload #' + u.no]];
          }
        } else {
          node = Screens.analytic(a);
          crumbs = [['Analytics', 'analytics'], [a.name]];
        }
      }
      else if (route === 'settings') { node = Screens.settings(); crumbs = [['Settings']]; }
      else { node = notFound('Page not found', 'The route "' + route + '" does not exist.'); crumbs = [['Not found']]; }
    } catch (err) {
      console.error(err);
      node = notFound('Something went wrong rendering this screen', err.message);
      crumbs = [['Error']];
    }

    var view = U.$('#view');
    view.innerHTML = '';
    view.appendChild(node);
    paintCrumbs(crumbs);
    paintNav();
    App.paintChrome();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    Store.save();
  };

  function notFound(title, desc) {
    return Screens.card({
      body: UI.emptyState({
        icon: 'warning', title: title, desc: desc,
        actions: [UI.btn('Back to analytics', 'btn-primary', function () { App.go('analytics'); }, { icon: 'beaker' })]
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
    NAV.forEach(function (item) {
      var active = current.route === item.route ||
        (item.route === 'analytics' && current.route === 'analytic');
      var b = el('button', { class: 'nav-item' + (active ? ' active' : ''), type: 'button' });
      b.innerHTML = U.icon(item.icon, 17) + '<span>' + esc(item.label) + '</span>' +
        (item.route === 'analytics' ? '<span class="nav-count">' + Store.all().length + '</span>' : '');
      b.addEventListener('click', function () { App.go(item.route); closeMobile(); });
      nav.appendChild(el('div', { class: 'nav-group' }, [b]));
    });
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
      pu.innerHTML = '<span class="avatar">' + esc(ini) + '</span><span><strong>' + esc(u.name || '') +
        '</strong><em>' + esc(u.email || '') + '</em></span>';
    }
    paintNotifications();
  };

  function paintNotifications() {
    var list = U.$('#notif-list');
    U.$('#notif-dot').hidden = !Store.unreadCount();
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
          App.go('analytic/' + n.analyticId + (n.uploadId ? '/upload/' + n.uploadId : ''));
        });
      }
      list.appendChild(item);
    });
  }

  App.applySidebar = function () {
    U.$('#app-shell').classList.toggle('collapsed', !!Store.S.ui.sidebarCollapsed);
  };

  function closeMobile() { U.$('#app-shell').classList.remove('mobile-open'); }

  /* ============================================================
     AUTH
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
    try { remembered = localStorage.getItem('lisa.remember'); } catch (e) {}
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
          if (U.$('#remember-me').checked) localStorage.setItem('lisa.remember', email);
          else localStorage.removeItem('lisa.remember');
        } catch (err) {}
        UI.toast({ kind: 'success', title: 'Welcome back, ' + res.user.name.split(' ')[0], text: 'Signed in as ' + res.user.role + '.' });
        U.$('#login-password').value = '';
        App.go(Store.S.ui.lastRoute || 'dashboard');
        App.render();
      }, 700);
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

    function togglePop(id, other) {
      var p = U.$(id), o = U.$(other);
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
      U.$('#notif-pop').hidden = true;
      U.$('#user-pop').hidden = true;
      App.go(this.dataset.nav);
    });

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
