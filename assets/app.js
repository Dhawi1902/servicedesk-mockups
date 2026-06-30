/* =========================================================================
   app.js — interactive demo engine for ServiceDesk.
   Simulated, CLIENT-SIDE only. Session + data live in localStorage.
   NOT real authentication. Demonstrates role-based access, tenant
   isolation, and the ticket lifecycle. Real version is built in APEX.
   ========================================================================= */
(function () {
  'use strict';
  var LS_DATA = 'sd_demo_data_v3', LS_SESSION = 'sd_demo_session_v3';

  /* ---------- store ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadData() {
    var raw = localStorage.getItem(LS_DATA);
    if (raw) { try { return JSON.parse(raw); } catch (e) {} }
    var seed = clone(window.DEMO_SEED);
    localStorage.setItem(LS_DATA, JSON.stringify(seed));
    return seed;
  }
  function save() { localStorage.setItem(LS_DATA, JSON.stringify(DB)); }
  var DB = loadData();

  /* ---------- session ---------- */
  function getSession() { var r = localStorage.getItem(LS_SESSION); return r ? JSON.parse(r) : null; }
  function currentUser() { var s = getSession(); return s ? DB.users.find(function (u) { return u.id === s.userId; }) : null; }

  /* ---------- lookups + utils ---------- */
  function company(id) { return DB.companies.find(function (c) { return c.id === id; }) || {}; }
  function user(id) { return DB.users.find(function (u) { return u.id === id; }) || null; }
  function category(id) { return DB.categories.find(function (c) { return c.id === id; }) || {}; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function initials(name) { return (name || '?').split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function qs(k) { return new URLSearchParams(location.search).get(k); }
  function NOW() { return Date.now(); }
  function timeAgo(iso) {
    var d = (NOW() - new Date(iso).getTime()) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    var days = Math.floor(d / 86400);
    return days === 1 ? 'yesterday' : days + 'd ago';
  }
  var STATUS_CLS = { 'New': 'st-new', 'Assigned': 'st-assigned', 'In Progress': 'st-progress', 'On Hold': 'st-hold', 'Resolved': 'st-resolved', 'Closed': 'st-closed' };
  var PRIO_CLS = { 'Low': 'pr-low', 'Medium': 'pr-medium', 'High': 'pr-high', 'Critical': 'pr-critical' };
  function statusBadge(s) { return '<span class="badge ' + (STATUS_CLS[s] || '') + '"><span class="dot"></span>' + esc(s) + '</span>'; }
  function prioBadge(p) { return '<span class="badge ' + (PRIO_CLS[p] || '') + '">' + esc(p) + '</span>'; }

  /* ---------- authorization / tenant isolation ---------- */
  function isAdmin(u) { return u.role === 'System Admin'; }
  function isAgent(u) { return u.role === 'Support Agent'; }
  function isClientAdmin(u) { return u.role === 'Client Admin'; }
  function isClient(u) { return u.role === 'Client User' || u.role === 'Client Admin'; }

  // Support Agents are scoped to the CLIENT companies (projects) they cover,
  // so they never see tickets from clients they're not assigned to.
  function agentCompanyIds(u) {
    return (DB.agentCompanies || [])
      .filter(function (m) { return m.userId === u.id; })
      .map(function (m) { return m.companyId; });
  }
  function agentCovers(userId, companyId) {
    return (DB.agentCompanies || []).some(function (m) { return m.userId === userId && m.companyId === companyId; });
  }

  // The heart of the demo: who can see which tickets.
  function visibleTickets(u) {
    return DB.tickets.filter(function (t) {
      if (isAdmin(u)) return true;                                   // everything, all companies
      if (isAgent(u)) return agentCompanyIds(u).indexOf(t.companyId) >= 0; // only their assigned projects
      if (isClientAdmin(u)) return t.companyId === u.companyId;      // whole company
      return t.companyId === u.companyId && t.createdBy === u.id;    // client user: own tickets only
    });
  }
  function canSee(u, t) { return visibleTickets(u).some(function (x) { return x.id === t.id; }); }
  function canCreate(u) { return isClient(u); }
  function canAssign(u) { return isAdmin(u); } // decision A: admin assigns
  function canInternalNote(u) { return isAdmin(u) || isAgent(u); }

  // allowed status transitions for this ticket + user
  function transitions(t, u) {
    var out = [];
    var agentOrAdmin = isAdmin(u) || (isAgent(u) && (t.assignedTo === u.id || t.assignedTo == null));
    var clientSide = isAdmin(u) || (isClient(u) && t.companyId === u.companyId);
    switch (t.status) {
      case 'Assigned':
        if (agentOrAdmin) out.push({ label: 'Start Work', to: 'In Progress', cls: 'btn-primary', icon: '▶' });
        break;
      case 'In Progress':
        if (agentOrAdmin) { out.push({ label: 'Put On Hold', to: 'On Hold', cls: '', icon: '⏸' }); out.push({ label: 'Resolve', to: 'Resolved', cls: 'btn-hot', icon: '✓' }); }
        break;
      case 'On Hold':
        if (agentOrAdmin) out.push({ label: 'Resume', to: 'In Progress', cls: 'btn-primary', icon: '▶' });
        break;
      case 'Resolved':
        if (clientSide) { out.push({ label: 'Close', to: 'Closed', cls: 'btn-primary', icon: '✓' }); out.push({ label: 'Reopen', to: 'In Progress', cls: '', icon: '↺' }); }
        break;
    }
    return out;
  }

  /* ---------- toast ---------- */
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }

  /* ---------- chrome (header + nav + shell) ---------- */
  function navModel(u) {
    var queueLabel = isClient(u) ? 'My Tickets' : 'Ticket Queue';
    var items = [
      { key: 'home', label: 'Home', icon: '🏠', href: '02-home.html', section: 'Overview' },
      { key: 'dashboard', label: 'Dashboard', icon: '📊', href: '03-dashboard.html', section: 'Overview' },
      { key: 'queue', label: queueLabel, icon: '🎫', href: '04-ticket-list.html', section: 'Tickets' }
    ];
    if (canCreate(u)) items.push({ key: 'create', label: 'Raise a Ticket', icon: '➕', href: '06-create-ticket.html', section: 'Tickets' });
    if (isAdmin(u)) {
      items.push({ key: 'companies', label: 'Companies', icon: '🏢', href: '09-companies.html', section: 'Administration' });
      items.push({ key: 'users', label: 'Users', icon: '👥', href: '10-users.html', section: 'Administration' });
      items.push({ key: 'categories', label: 'Categories', icon: '🏷️', href: '11-categories.html', section: 'Administration' });
    }
    items.push({ key: 'profile', label: 'My Profile', icon: '👤', href: '12-profile.html', section: 'Account' });
    return items;
  }
  function renderShell(u, activeKey, mainHtml, bannerHtml) {
    var items = navModel(u), sections = [], bySec = {};
    items.forEach(function (it) { (bySec[it.section] = bySec[it.section] || []).push(it); if (sections.indexOf(it.section) < 0) sections.push(it.section); });
    var nav = sections.map(function (sec) {
      return '<div class="nav-section">' + sec + '</div>' + bySec[sec].map(function (it) {
        return '<a class="nav-item' + (it.key === activeKey ? ' active' : '') + '" href="' + it.href + '"><span class="ic">' + it.icon + '</span> ' + esc(it.label) + '</a>';
      }).join('');
    }).join('');
    var header =
      '<div class="brand"><div class="logo">🎫</div> ServiceDesk</div>' +
      '<div class="spacer"></div>' +
      '<div class="hdr-item" title="Reset demo data" onclick="sd.reset()">↺ Reset demo</div>' +
      '<div class="hdr-item"><span class="role-pill">' + esc(u.role) + '</span></div>' +
      '<div class="hdr-item"><span class="avatar">' + initials(u.name) + '</span> ' + esc(u.name) +
      ' &nbsp;<a href="#" onclick="sd.logout();return false;" style="font-size:12px;">Sign out</a></div>';
    document.body.className = '';
    document.body.innerHTML =
      '<div class="app-shell">' +
        '<header class="top-header">' + header + '</header>' +
        '<aside class="sidebar">' + nav + '</aside>' +
        '<main class="main">' + (bannerHtml || '') + mainHtml + '</main>' +
      '</div>' + demoFoot();
  }
  function demoFoot() {
    return '<div class="demo-foot">🧪 <b>Interactive demo</b> — simulated client-side login (no real auth). ' +
           'Data persists in your browser. Real auth &amp; tenant isolation are built in Oracle APEX. ' +
           '<a href="#" onclick="sd.reset();return false;">Reset</a></div>';
  }
  function tenantBanner(u) {
    if (isAdmin(u)) return '<div class="tenant-banner">🌐 <b>System Admin</b> — viewing <b>all companies</b>. Other roles are scoped to their own company.</div>';
    if (isAgent(u)) {
      var projNames = agentCompanyIds(u).map(function (id) { return company(id).name; });
      var projList = projNames.length ? projNames.join(', ') : 'no projects assigned yet';
      return '<div class="tenant-banner">🛠️ <b>Support Agent</b> — you only see tickets for <b>your assigned projects</b>: ' + esc(projList) + '. Other clients are hidden.</div>';
    }
    if (isClientAdmin(u)) return '<div class="tenant-banner">🔒 <b>' + esc(company(u.companyId).name) + '</b> only — you see <b>all tickets for your company</b> (never other companies’).</div>';
    return '<div class="tenant-banner">🔒 <b>' + esc(company(u.companyId).name) + '</b> — you see <b>only your own tickets</b>.</div>';
  }
  function pageBar(crumb, title, actions) {
    return '<div class="page-bar"><div class="titles"><div class="crumb">' + crumb + '</div><h1>' + esc(title) + '</h1></div>' +
           '<div class="actions">' + (actions || '') + '</div></div>';
  }

  /* ---------- page: LOGIN ---------- */
  function renderLogin() {
    if (currentUser()) { location.href = '03-dashboard.html'; return; }
    var personas = DB.users.map(function (u) {
      return '<button class="persona" onclick="sd.quickLogin(\'' + u.id + '\')">' +
        '<span class="avatar">' + initials(u.name) + '</span>' +
        '<span class="p-name">' + esc(u.name) + '</span>' +
        '<span class="p-role">' + esc(u.role) + ' · ' + esc(company(u.companyId).name) + '</span></button>';
    }).join('');
    document.body.className = '';
    document.body.innerHTML =
      '<div class="login-wrap"><div class="login-card" style="max-width:760px;">' +
        '<div class="brand"><div class="logo">🎫</div><div>' +
          '<div style="font-weight:700;font-size:15px;">ServiceDesk</div>' +
          '<div class="muted" style="font-size:12px;">Multi-tenant support portal · interactive demo</div></div></div>' +
        '<div class="grid cols-2" style="margin-top:14px;gap:28px;align-items:start;">' +
          '<div><h1>Sign in</h1><p class="sub">Use a demo account (password is <b>demo</b> for all).</p>' +
            '<div id="loginErr" class="login-error" style="display:none;"></div>' +
            '<div class="form-grid">' +
              '<div class="field"><label>Email</label><input id="email" type="email" value="anna@acme.example"></div>' +
              '<div class="field"><label>Password</label><input id="pwd" type="password" value="demo"></div>' +
              '<button class="btn btn-primary btn-block" onclick="sd.login()">Sign in</button>' +
            '</div></div>' +
          '<div><h1 style="font-size:16px;">Or pick a persona</h1>' +
            '<p class="sub">One click to log in and see that role’s view.</p>' +
            '<div class="persona-grid">' + personas + '</div></div>' +
        '</div>' +
        '<hr class="sep"><p class="muted mb-0" style="font-size:11.5px;">🧪 Simulated client-side login for demonstration only — not real authentication. ' +
        'Try logging in as <b>Anna (Client User)</b> then as <b>Sara (System Admin)</b> to see tenant isolation.</p>' +
      '</div></div>';
  }

  /* ---------- page: HOME ---------- */
  function renderHome(u) {
    var mine = visibleTickets(u).slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    var cards =
      (canCreate(u) ? card('06-create-ticket.html', '➕', 'Raise a Ticket', 'Report a new issue or request.') : '') +
      card('04-ticket-list.html', '🎫', isClient(u) ? 'My Tickets' : 'Ticket Queue', 'Browse and filter tickets.') +
      card('03-dashboard.html', '📊', 'Dashboard', 'A quick overview of tickets.');
    function card(href, ic, t, d) {
      return '<a class="card" href="' + href + '" style="color:inherit;"><div class="card-bd">' +
        '<div style="font-size:30px;">' + ic + '</div><div style="font-weight:600;font-size:16px;margin-top:6px;">' + t + '</div>' +
        '<div class="muted">' + d + '</div></div></a>';
    }
    var rows = mine.slice(0, 6).map(function (t) {
      return '<tr><td><a class="ref" href="05-ticket-detail.html?id=' + t.id + '">' + t.ref + '</a></td>' +
        '<td>' + esc(t.subject) + '</td><td>' + statusBadge(t.status) + '</td><td class="muted">' + timeAgo(t.updatedAt) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="muted">No tickets yet.</td></tr>';
    var html = pageBar('Home', 'Welcome back, ' + esc(u.name.split(' ')[0]) + ' 👋', '') +
      '<div class="content"><div class="grid cols-3">' + cards + '</div>' +
      '<div class="card" style="margin-top:18px;"><div class="card-hd">Recent activity</div>' +
      '<table class="t"><thead><tr><th>Ref</th><th>Subject</th><th>Status</th><th>Updated</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    renderShell(u, 'home', html, tenantBanner(u));
  }

  /* ---------- page: DASHBOARD ---------- */
  function renderDashboard(u) {
    var ts = visibleTickets(u);
    var open = ts.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
    var unassigned = ts.filter(function (t) { return t.assignedTo == null && t.status !== 'Closed'; }).length;
    var inprog = ts.filter(function (t) { return t.status === 'In Progress'; }).length;
    var resolved = ts.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length;
    var kpis = [
      { l: 'Open Tickets', v: open, c: '#0572ce' },
      { l: 'Unassigned', v: unassigned, c: '#f97316' },
      { l: 'In Progress', v: inprog, c: '#eab308' },
      { l: 'Resolved / Closed', v: resolved, c: '#22c55e' }
    ].map(function (k) {
      return '<div class="stat"><span class="label">' + k.l + '</span><span class="value">' + k.v + '</span>' +
        '<div class="bar" style="background:' + k.c + ';"></div></div>';
    }).join('');

    // status bar chart
    var scount = {}; DB.statuses.forEach(function (s) { scount[s] = 0; });
    ts.forEach(function (t) { scount[t.status]++; });
    var smax = Math.max.apply(null, DB.statuses.map(function (s) { return scount[s]; }).concat([1]));
    var scolors = { 'New': '#6366f1', 'Assigned': '#0ea5e9', 'In Progress': '#eab308', 'On Hold': '#94a3b8', 'Resolved': '#22c55e', 'Closed': '#9ca3af' };
    var bars = DB.statuses.map(function (s) {
      var h = Math.round(scount[s] / smax * 130) + (scount[s] ? 6 : 0);
      return '<div class="col"><div class="n">' + scount[s] + '</div><div class="bar" style="height:' + h + 'px;background:' + scolors[s] + ';"></div><div class="lbl">' + s.replace(' ', '&nbsp;') + '</div></div>';
    }).join('');

    // priority breakdown
    var pcount = {}; DB.priorities.forEach(function (p) { pcount[p] = 0; });
    ts.forEach(function (t) { pcount[t.priority]++; });
    var ptot = ts.length || 1;
    var pcolors = { 'Critical': '#b91c1c', 'High': '#c2410c', 'Medium': '#0369a1', 'Low': '#64748b' };
    var plegend = ['Critical', 'High', 'Medium', 'Low'].map(function (p) {
      return '<div class="li"><span class="sw" style="background:' + pcolors[p] + ';"></span> ' + p +
        ' <b style="margin-left:auto;">' + pcount[p] + ' (' + Math.round(pcount[p] / ptot * 100) + '%)</b></div>';
    }).join('');

    // company breakdown (admin only) or own-company line
    var companyCard = '';
    if (isAdmin(u)) {
      var rows = DB.companies.filter(function (c) { return c.type === 'CLIENT'; }).map(function (c) {
        var ct = ts.filter(function (t) { return t.companyId === c.id; });
        var o = ct.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
        var ip = ct.filter(function (t) { return t.status === 'In Progress'; }).length;
        var rs = ct.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length;
        return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + o + '</td><td>' + ip + '</td><td>' + rs + '</td></tr>';
      }).join('');
      companyCard = '<div class="card" style="margin-top:16px;"><div class="card-hd">Tickets by Client Company ' +
        '<span class="sub">System Admin only — cross-tenant view</span></div>' +
        '<table class="t"><thead><tr><th>Company</th><th>Open</th><th>In Progress</th><th>Resolved/Closed</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    var html = pageBar('Overview / Dashboard', 'Dashboard', '') +
      '<div class="content"><div class="grid cols-4">' + kpis + '</div>' +
      '<div class="grid cols-2" style="margin-top:16px;">' +
        '<div class="card"><div class="card-hd">Tickets by Status</div><div class="card-bd"><div class="barchart">' + bars + '</div></div></div>' +
        '<div class="card"><div class="card-hd">Tickets by Priority</div><div class="card-bd"><div class="legend" style="flex-direction:column;gap:10px;">' + plegend + '</div></div></div>' +
      '</div>' + companyCard + '</div>';
    renderShell(u, 'dashboard', html, tenantBanner(u));
  }

  /* ---------- page: QUEUE ---------- */
  function renderQueue(u) {
    var ts = visibleTickets(u).slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    var showCompany = isAdmin(u) || isAgent(u);
    var rows = ts.map(function (t) {
      var asg = t.assignedTo ? esc(user(t.assignedTo).name) : '<span class="muted">— Unassigned</span>';
      return '<tr>' +
        '<td><a class="ref" href="05-ticket-detail.html?id=' + t.id + '">' + t.ref + '</a></td>' +
        '<td>' + esc(t.subject) + '</td>' +
        (showCompany ? '<td>' + esc(company(t.companyId).name) + '</td>' : '') +
        '<td>' + prioBadge(t.priority) + '</td><td>' + statusBadge(t.status) + '</td>' +
        '<td>' + asg + '</td><td class="muted">' + timeAgo(t.updatedAt) + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="muted">No tickets visible to you.</td></tr>';
    var actions = canCreate(u) ? '<a class="btn btn-primary" href="06-create-ticket.html">➕ New Ticket</a>' : '';
    var html = pageBar('Tickets / Queue', isClient(u) ? 'My Tickets' : 'Ticket Queue', actions) +
      '<div class="content"><div class="card" style="overflow:hidden;">' +
      '<div class="toolbar"><div class="search">🔎 <input id="q" placeholder="Search reference or keyword…" oninput="sd.filterQueue()"></div>' +
      '<span class="muted" style="font-size:12.5px;margin-left:auto;" id="qcount">' + ts.length + ' results</span></div>' +
      '<table class="t" id="qtable"><thead><tr><th>Ref</th><th>Subject</th>' + (showCompany ? '<th>Company</th>' : '') +
      '<th>Priority</th><th>Status</th><th>Assignee</th><th>Updated</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    renderShell(u, 'queue', html, tenantBanner(u));
  }

  /* ---------- page: TICKET DETAIL ---------- */
  function renderDetail(u) {
    var t = DB.tickets.find(function (x) { return x.id === qs('id'); });
    if (!t) { renderShell(u, 'queue', notFound('Ticket not found.'), ''); return; }
    if (!canSee(u, t)) { renderShell(u, 'queue', notFound('🔒 You don’t have access to this ticket. (Tenant isolation in action.)'), ''); return; }

    var trs = transitions(t, u).map(function (a) {
      return '<button class="btn ' + a.cls + '" onclick="sd.changeStatus(\'' + t.id + '\',\'' + a.to + '\')">' + a.icon + ' ' + a.label + '</button>';
    }).join('');
    var assignBtn = canAssign(u) ? '<a class="btn" href="07-assign.html?id=' + t.id + '">👤 ' + (t.assignedTo ? 'Reassign' : 'Assign') + '</a>' : '';

    var comments = DB.comments.filter(function (c) { return c.ticketId === t.id; })
      .filter(function (c) { return !c.isInternal || canInternalNote(u); }) // clients never see internal notes
      .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    var cHtml = comments.map(function (c) {
      var au = user(c.userId) || { name: '?' };
      return '<div class="comment ' + (c.isInternal ? 'internal' : '') + '"><div class="av">' + initials(au.name) + '</div>' +
        '<div style="flex:1;"><div class="head"><b>' + esc(au.name) + '</b> · ' + esc(au.role || '') +
        (c.isInternal ? ' · <span class="badge st-progress">🔒 Internal note</span>' : '') + ' · ' + timeAgo(c.createdAt) + '</div>' +
        '<div class="body">' + esc(c.text) + '</div></div></div>';
    }).join('') || '<div class="muted">No comments yet.</div>';

    var hist = DB.history.filter(function (h) { return h.ticketId === t.id; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
      .map(function (h) {
        var hu = user(h.userId) || { name: '?' };
        var chg = h.oldValue ? esc(h.oldValue) + ' → ' + esc(h.newValue) : esc(h.newValue);
        return '<li><span class="pt"></span><div><span class="who">' + esc(hu.name) + '</span> ' + esc(h.action) + '</div>' +
          '<div class="meta">' + chg + ' · ' + timeAgo(h.createdAt) + '</div></li>';
      }).join('');

    var cu = user(t.createdBy) || { name: '?' };
    var actions = assignBtn + trs +
      '<a class="btn btn-primary" href="08-add-comment.html?id=' + t.id + '">💬 Comment</a>';
    var main =
      pageBar('<a href="04-ticket-list.html">Queue</a> / ' + t.ref, t.subject, actions) +
      '<div class="content" style="display:grid;grid-template-columns:1fr 300px;gap:16px;">' +
        '<div><div class="card"><div class="card-hd">' + t.ref + ' ' + statusBadge(t.status) + ' ' + prioBadge(t.priority) + '</div>' +
          '<div class="card-bd"><p style="margin-top:0;">' + esc(t.description) + '</p>' +
          '<div class="grid cols-3" style="gap:8px;margin-top:8px;">' +
            '<div><div class="muted" style="font-size:11.5px;">Category</div><div>' + esc(category(t.categoryId).name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Raised by</div><div>' + esc(cu.name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Company</div><div>' + esc(company(t.companyId).name) + '</div></div>' +
          '</div></div></div>' +
          '<div class="card" style="margin-top:16px;"><div class="card-hd">Conversation' +
            '<a class="btn btn-sm btn-primary" style="margin-left:auto;" href="08-add-comment.html?id=' + t.id + '">💬 Add Comment</a></div>' +
            '<div class="card-bd">' + cHtml + '</div></div></div>' +
        '<div><div class="card"><div class="card-hd">Properties</div><div class="card-bd form-grid">' +
            '<div class="field"><label>Status</label><input value="' + esc(t.status) + '" disabled></div>' +
            '<div class="field"><label>Assignee</label><input value="' + esc(t.assignedTo ? user(t.assignedTo).name : 'Unassigned') + '" disabled></div>' +
            '<div class="field"><label>Company</label><input value="' + esc(company(t.companyId).name) + '" disabled></div>' +
          '</div></div>' +
          '<div class="card" style="margin-top:16px;"><div class="card-hd">Activity History</div>' +
            '<div class="card-bd"><ul class="timeline">' + hist + '</ul></div></div></div>' +
      '</div>';
    renderShell(u, 'queue', main, '');
  }
  function notFound(msg) { return '<div class="content"><div class="card"><div class="card-bd"><p>' + msg + '</p><a class="btn" href="04-ticket-list.html">← Back to queue</a></div></div></div>'; }

  /* ---------- modal pages: CREATE / ASSIGN / COMMENT ---------- */
  function renderModalPage(u, activeKey, behindHtml, modalHtml) {
    renderShell(u, activeKey, '<div class="behind">' + behindHtml + '</div>', '');
    var wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = modalHtml;
    document.body.appendChild(wrap);
  }

  function renderCreate(u) {
    if (!canCreate(u)) { renderShell(u, 'queue', notFound('Only client users can raise tickets.'), ''); return; }
    var cats = DB.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    var prios = DB.priorities.map(function (p) { return '<option' + (p === 'Medium' ? ' selected' : '') + '>' + p + '</option>'; }).join('');
    var modal = '<div class="modal lg"><div class="m-hd"><h2>Raise a Ticket</h2><span class="x" onclick="location.href=\'04-ticket-list.html\'">✕</span></div>' +
      '<div class="m-bd"><div class="tenant-banner" style="border-radius:4px;margin-bottom:16px;">🔒 Filed under <b>' + esc(company(u.companyId).name) + '</b> automatically (your company).</div>' +
      '<div class="form-grid cols-2">' +
        '<div class="field full"><label>Subject <span class="req">*</span></label><input id="subject" placeholder="Short summary"></div>' +
        '<div class="field full"><label>Description <span class="req">*</span></label><textarea id="desc" placeholder="Describe the issue…"></textarea></div>' +
        '<div class="field"><label>Category</label><select id="cat">' + cats + '</select></div>' +
        '<div class="field"><label>Priority</label><select id="prio">' + prios + '</select></div>' +
      '</div></div><div class="m-ft"><a class="btn" href="04-ticket-list.html">Cancel</a>' +
      '<button class="btn btn-primary" onclick="sd.createTicket()">➕ Submit Ticket</button></div></div>';
    renderModalPage(u, 'create', queueBehind(u), modal);
  }
  function queueBehind(u) { return pageBar('Tickets / Queue', isClient(u) ? 'My Tickets' : 'Ticket Queue', '') + '<div class="content"><div class="card" style="height:300px;"></div></div>'; }

  function renderAssign(u) {
    var t = DB.tickets.find(function (x) { return x.id === qs('id'); });
    if (!t || !canAssign(u)) { renderShell(u, 'queue', notFound('Not allowed, or ticket missing.'), ''); return; }
    // Only agents who cover this client's project are offered (fall back to all if none).
    var pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && agentCovers(x.id, t.companyId); });
    if (!pool.length) pool = DB.users.filter(function (x) { return x.role === 'Support Agent'; });
    var agents = pool.map(function (a) {
      var load = DB.tickets.filter(function (x) { return x.assignedTo === a.id && x.status !== 'Closed'; }).length;
      return '<option value="' + a.id + '"' + (t.assignedTo === a.id ? ' selected' : '') + '>' + esc(a.name) + ' · ' + load + ' open</option>';
    }).join('');
    var modal = '<div class="modal"><div class="m-hd"><h2>Assign · ' + t.ref + '</h2><span class="x" onclick="location.href=\'05-ticket-detail.html?id=' + t.id + '\'">✕</span></div>' +
      '<div class="m-bd"><p class="muted mt-0">Put an agent on <b>' + esc(t.subject) + '</b> (' + esc(company(t.companyId).name) + ', ' + esc(t.priority) + ').</p>' +
      '<div class="form-grid"><div class="field"><label>Assign to agent <span class="req">*</span></label><select id="agent">' + agents + '</select></div>' +
      '<div class="field"><label class="switch on" id="emailSw" onclick="this.classList.toggle(\'on\')"><span class="track"></span> Send assignment email (simulated)</label></div>' +
      '</div></div><div class="m-ft"><a class="btn" href="05-ticket-detail.html?id=' + t.id + '">Cancel</a>' +
      '<button class="btn btn-primary" onclick="sd.assign(\'' + t.id + '\')">👤 Assign</button></div></div>';
    renderModalPage(u, 'queue', detailBehind(t), modal);
  }
  function detailBehind(t) { return pageBar('Queue / ' + t.ref, t.subject, '') + '<div class="content"><div class="card" style="height:300px;"></div></div>'; }

  function renderComment(u) {
    var t = DB.tickets.find(function (x) { return x.id === qs('id'); });
    if (!t || !canSee(u, t)) { renderShell(u, 'queue', notFound('Not allowed, or ticket missing.'), ''); return; }
    var internalToggle = canInternalNote(u) ?
      '<div class="field"><label class="switch" id="intSw" onclick="this.classList.toggle(\'on\')"><span class="track"></span> 🔒 Internal note (hidden from client)</label></div>' : '';
    var modal = '<div class="modal"><div class="m-hd"><h2>Add Comment · ' + t.ref + '</h2><span class="x" onclick="location.href=\'05-ticket-detail.html?id=' + t.id + '\'">✕</span></div>' +
      '<div class="m-bd"><div class="form-grid"><div class="field"><label>Comment <span class="req">*</span></label><textarea id="ctext" placeholder="Type your reply…"></textarea></div>' +
      internalToggle + '</div></div><div class="m-ft"><a class="btn" href="05-ticket-detail.html?id=' + t.id + '">Cancel</a>' +
      '<button class="btn btn-primary" onclick="sd.addComment(\'' + t.id + '\')">💬 Post Comment</button></div></div>';
    renderModalPage(u, 'queue', detailBehind(t), modal);
  }

  /* ---------- admin pages ---------- */
  function renderCompanies(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var rows = DB.companies.map(function (c) {
      var tk = DB.tickets.filter(function (t) { return t.companyId === c.id; }).length;
      var us = DB.users.filter(function (x) { return x.companyId === c.id; }).length;
      return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + (c.type === 'VENDOR' ? '<span class="role-pill">VENDOR</span>' : 'CLIENT') +
        '</td><td>' + (c.type === 'VENDOR' ? '—' : tk) + '</td><td>' + us + '</td>' +
        '<td><span class="' + (c.status === 'Active' ? 'tag-active' : 'tag-inactive') + '">● ' + c.status + '</span></td></tr>';
    }).join('');
    var html = pageBar('Administration / Companies', 'Companies', '') +
      '<div class="content"><div class="card" style="overflow:hidden;"><table class="t"><thead><tr><th>Company</th><th>Type</th><th>Tickets</th><th>Users</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 9 — APEX Interactive Grid. FR-5. (Demo is read-only; APEX version supports inline CRUD.)</p></div>';
    renderShell(u, 'companies', html, tenantBanner(u));
  }
  function renderUsers(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var rows = DB.users.map(function (x) {
      return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.email) + '</td><td><span class="role-pill">' + esc(x.role) + '</span></td>' +
        '<td>' + esc(company(x.companyId).name) + '</td><td><span class="tag-active">● Active</span></td></tr>';
    }).join('');
    var html = pageBar('Administration / Users', 'Users', '') +
      '<div class="content"><div class="card" style="overflow:hidden;"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 10 — APEX Interactive Grid. FR-6: role + company set here drive login’s app items.</p></div>';
    renderShell(u, 'users', html, tenantBanner(u));
  }
  function renderCategories(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var rows = DB.categories.map(function (c) {
      var n = DB.tickets.filter(function (t) { return t.categoryId === c.id && t.status !== 'Closed'; }).length;
      return '<tr><td>' + esc(c.name) + '</td><td>' + n + '</td><td><span class="tag-active">● Active</span></td></tr>';
    }).join('');
    var prio = DB.priorities.map(function (p) { return '<tr><td>' + p + '</td><td>' + prioBadge(p) + '</td></tr>'; }).join('');
    var html = pageBar('Administration / Categories', 'Categories & Priorities', '') +
      '<div class="content"><div class="grid cols-2">' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd">Categories</div><table class="t"><thead><tr><th>Category</th><th>Open</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd">Priorities</div><table class="t"><thead><tr><th>Priority</th><th>Badge</th></tr></thead><tbody>' + prio + '</tbody></table></div>' +
      '</div></div>';
    renderShell(u, 'categories', html, tenantBanner(u));
  }
  function renderProfile(u) {
    var html = pageBar('Account / Profile', 'My Profile', '') +
      '<div class="content" style="max-width:720px;"><div class="card"><div class="card-hd">Personal details</div><div class="card-bd">' +
      '<div style="display:flex;gap:16px;align-items:center;margin-bottom:18px;"><div class="avatar" style="width:60px;height:60px;font-size:22px;">' + initials(u.name) + '</div>' +
      '<div><div style="font-weight:600;font-size:16px;">' + esc(u.name) + '</div><div class="muted">' + esc(u.role) + ' · ' + esc(company(u.companyId).name) + '</div></div></div>' +
      '<div class="form-grid cols-2">' +
        '<div class="field"><label>Full name</label><input value="' + esc(u.name) + '"></div>' +
        '<div class="field"><label>Email</label><input value="' + esc(u.email) + '" disabled></div>' +
        '<div class="field"><label>Role</label><input value="' + esc(u.role) + '" disabled></div>' +
        '<div class="field"><label>Company</label><input value="' + esc(company(u.companyId).name) + '" disabled></div>' +
      '</div></div></div></div>';
    renderShell(u, 'profile', html, '');
  }

  /* ---------- actions (exposed as window.sd) ---------- */
  function nextRef() { DB.seq += 1; return { n: DB.seq, ref: 'TKT-' + String(DB.seq).padStart(5, '0') }; }
  function nowIso() { return new Date().toISOString(); }
  function pushHistory(ticketId, userId, action, oldV, newV) {
    DB.history.push({ id: 'h' + NOW() + Math.floor(Math.random() * 1000), ticketId: ticketId, userId: userId, action: action, oldValue: oldV || '', newValue: newV || '', createdAt: nowIso() });
  }

  window.sd = {
    login: function () {
      var email = document.getElementById('email').value.trim().toLowerCase();
      var pwd = document.getElementById('pwd').value;
      var u = DB.users.find(function (x) { return x.email.toLowerCase() === email && x.password === pwd; });
      if (!u) { var e = document.getElementById('loginErr'); e.style.display = 'block'; e.textContent = 'Invalid email or password. (Hint: password is "demo".)'; return; }
      localStorage.setItem(LS_SESSION, JSON.stringify({ userId: u.id }));
      location.href = '03-dashboard.html';
    },
    quickLogin: function (uid) { localStorage.setItem(LS_SESSION, JSON.stringify({ userId: uid })); location.href = '03-dashboard.html'; },
    logout: function () { localStorage.removeItem(LS_SESSION); location.href = '01-login.html'; },
    reset: function () { if (confirm('Reset all demo data and sign out?')) { localStorage.removeItem(LS_DATA); localStorage.removeItem(LS_SESSION); location.href = '01-login.html'; } },
    createTicket: function () {
      var u = currentUser();
      var subject = document.getElementById('subject').value.trim();
      var desc = document.getElementById('desc').value.trim();
      if (!subject || !desc) { alert('Subject and description are required.'); return; }
      var r = nextRef();
      var t = { id: 't' + r.n, ref: r.ref, companyId: u.companyId, subject: subject, description: desc,
        categoryId: document.getElementById('cat').value, priority: document.getElementById('prio').value,
        status: 'New', createdBy: u.id, assignedTo: null, createdAt: nowIso(), updatedAt: nowIso() };
      DB.tickets.push(t);
      pushHistory(t.id, u.id, 'Raised ticket', '', 'New');
      save();
      location.href = '05-ticket-detail.html?id=' + t.id;
    },
    assign: function (id) {
      var u = currentUser(), t = DB.tickets.find(function (x) { return x.id === id; });
      var agentId = document.getElementById('agent').value;
      var emailOn = document.getElementById('emailSw').classList.contains('on');
      var old = t.status;
      t.assignedTo = agentId;
      if (t.status === 'New') t.status = 'Assigned';
      t.updatedAt = nowIso();
      pushHistory(id, u.id, 'Assigned to ' + user(agentId).name, old, t.status);
      save();
      sessionStorage.setItem('flash', (emailOn ? '📧 Assignment email sent (simulated). ' : '') + 'Assigned to ' + user(agentId).name + '.');
      location.href = '05-ticket-detail.html?id=' + id;
    },
    addComment: function (id) {
      var u = currentUser(), text = document.getElementById('ctext').value.trim();
      if (!text) { alert('Comment cannot be empty.'); return; }
      var internalEl = document.getElementById('intSw');
      var internal = internalEl ? internalEl.classList.contains('on') : false;
      DB.comments.push({ id: 'c' + NOW(), ticketId: id, userId: u.id, text: text, isInternal: internal, createdAt: nowIso() });
      var t = DB.tickets.find(function (x) { return x.id === id; }); t.updatedAt = nowIso();
      save();
      sessionStorage.setItem('flash', internal ? '🔒 Internal note added.' : 'Comment posted.');
      location.href = '05-ticket-detail.html?id=' + id;
    },
    changeStatus: function (id, to) {
      var u = currentUser(), t = DB.tickets.find(function (x) { return x.id === id; });
      var old = t.status; t.status = to; t.updatedAt = nowIso();
      if (to === 'Resolved') t.resolvedAt = nowIso();
      if (to === 'Closed') t.closedAt = nowIso();
      pushHistory(id, u.id, statusActionName(old, to), old, to);
      save();
      sessionStorage.setItem('flash', 'Status changed: ' + old + ' → ' + to + '.');
      renderDetail(u);
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },
    filterQueue: function () {
      var q = document.getElementById('q').value.toLowerCase();
      var rows = document.querySelectorAll('#qtable tbody tr'), shown = 0;
      rows.forEach(function (r) { var hit = r.textContent.toLowerCase().indexOf(q) >= 0; r.style.display = hit ? '' : 'none'; if (hit) shown++; });
      document.getElementById('qcount').textContent = shown + ' results';
    }
  };
  function statusActionName(o, n) {
    if (n === 'In Progress' && o === 'Assigned') return 'Started work';
    if (n === 'In Progress' && o === 'On Hold') return 'Resumed';
    if (n === 'On Hold') return 'Put on hold';
    if (n === 'Resolved') return 'Resolved';
    if (n === 'Closed') return 'Closed';
    if (n === 'In Progress' && o === 'Resolved') return 'Reopened';
    return 'Changed status';
  }

  /* ---------- router ---------- */
  function boot() {
    var page = document.body.getAttribute('data-page');
    if (page === 'login') { renderLogin(); return; }
    var u = currentUser();
    if (!u) { location.href = '01-login.html'; return; } // auth guard
    switch (page) {
      case 'home': renderHome(u); break;
      case 'dashboard': renderDashboard(u); break;
      case 'queue': renderQueue(u); break;
      case 'detail': renderDetail(u); break;
      case 'create': renderCreate(u); break;
      case 'assign': renderAssign(u); break;
      case 'comment': renderComment(u); break;
      case 'companies': renderCompanies(u); break;
      case 'users': renderUsers(u); break;
      case 'categories': renderCategories(u); break;
      case 'profile': renderProfile(u); break;
      default: renderHome(u);
    }
    var f = sessionStorage.getItem('flash');
    if (f) { toast(f); sessionStorage.removeItem('flash'); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
