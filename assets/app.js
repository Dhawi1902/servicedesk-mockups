/* =========================================================================
   app.js — interactive demo engine for ServiceDesk.
   Simulated, CLIENT-SIDE only. Session + data live in localStorage.
   NOT real authentication. Demonstrates role-based access, tenant
   isolation, and the ticket lifecycle. Real version is built in APEX.

   Updated to match the latest brief (2026-06-30):
   - Severity (client-set) vs Priority (support-set) — Decision K / FR-7
   - SLA per severity with breach indicators — FR-23
   - CSAT star rating after closure — FR-27
   - Escalate action (reassign + raise priority) — FR-26
   - Client can assign from mapped agents — Decision J / FR-10
   - Agent self-assign from open queue — Decision A / FR-10
   - Dashboard analytics (avg resolution time, per-agent counts) — FR-28
   - Ticket age column — FR-15
   - Auto-acknowledgement email on create — FR-29
   ========================================================================= */
(function () {
  'use strict';
  var LS_DATA = 'sd_demo_data_v4', LS_SESSION = 'sd_demo_session_v4';

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
  // Backfill attachments array for users with cached v4 data (before FR-25)
  if (!DB.attachments) { DB.attachments = []; save(); }

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
  function ageDays(iso) {
    var d = (NOW() - new Date(iso).getTime()) / (1000 * 86400);
    if (d < 1) return '<1d';
    return Math.floor(d) + 'd';
  }

  /* ---------- SLA (FR-23) ---------- */
  function slaTarget(severity) {
    return (DB.slaTargets || []).find(function (s) { return s.severity === severity; });
  }
  function slaStatus(ticket) {
    if (!ticket.slaDueDate) return null;
    if (ticket.status === 'Closed') return 'closed';
    var due = new Date(ticket.slaDueDate).getTime();
    var now = NOW();
    var total = due - new Date(ticket.createdAt).getTime();
    var remaining = due - now;
    if (remaining <= 0) return 'breached';
    if (remaining / total <= 0.25) return 'at-risk';
    return 'on-track';
  }
  function slaBadge(ticket) {
    var s = slaStatus(ticket);
    if (!s || s === 'closed') return '';
    var map = { 'on-track': '<span class="sla-badge sla-ok">&#x1F7E2; On track</span>',
                'at-risk':  '<span class="sla-badge sla-warn">&#x1F7E1; At risk</span>',
                'breached': '<span class="sla-badge sla-breach">&#x1F534; Breached</span>' };
    return map[s] || '';
  }

  /* ---------- badges ---------- */
  var STATUS_CLS = { 'New': 'st-new', 'Assigned': 'st-assigned', 'In Progress': 'st-progress', 'On Hold': 'st-hold', 'Resolved': 'st-resolved', 'Closed': 'st-closed' };
  var SEV_CLS = { 'Critical': 'sev-critical', 'Major': 'sev-major', 'Minor': 'sev-minor', 'Cosmetic': 'sev-cosmetic' };
  var PRIO_CLS = { 'P1': 'pr-critical', 'P2': 'pr-high', 'P3': 'pr-medium', 'P4': 'pr-low' };
  function statusBadge(s) { return '<span class="badge ' + (STATUS_CLS[s] || '') + '"><span class="dot"></span>' + esc(s) + '</span>'; }
  function sevBadge(s) { return s ? '<span class="badge ' + (SEV_CLS[s] || '') + '">' + esc(s) + '</span>' : ''; }
  function prioBadge(p) { return p ? '<span class="badge ' + (PRIO_CLS[p] || '') + '">' + esc(p) + '</span>' : '<span class="muted">—</span>'; }

  /* ---------- CSAT stars (FR-27) ---------- */
  function csatStars(score, editable) {
    if (!editable && !score) return '<span class="muted">—</span>';
    var html = '<span class="csat-stars' + (editable ? ' editable' : '') + '">';
    for (var i = 1; i <= 5; i++) {
      var filled = score && i <= score;
      html += '<span class="star' + (filled ? ' filled' : '') + '" data-val="' + i + '"' +
        (editable ? ' onclick="sd.rateCsat(this)"' : '') + '>&#9733;</span>';
    }
    html += '</span>';
    if (score) html += ' <span class="muted">(' + score + '/5)</span>';
    return html;
  }

  /* ---------- attachments (FR-25) ---------- */
  function fileIcon(mime) {
    if (!mime) return '&#128196;';
    if (mime.indexOf('image/') === 0) return '&#128247;';
    if (mime.indexOf('application/pdf') === 0) return '&#128462;';
    if (mime.indexOf('text/') === 0) return '&#128196;';
    return '&#128206;';
  }
  function fileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  function ticketAttachments(ticketId) {
    return (DB.attachments || []).filter(function (a) { return a.ticketId === ticketId; });
  }
  function commentAttachments(commentId) {
    return (DB.attachments || []).filter(function (a) { return a.commentId === commentId; });
  }
  // Pending attachments for create/comment forms (simulated — cleared on submit)
  var pendingFiles = [];
  function renderPendingFiles() {
    var el = document.getElementById('pending-files');
    if (!el) return;
    if (!pendingFiles.length) { el.innerHTML = ''; return; }
    el.innerHTML = pendingFiles.map(function (f, i) {
      return '<div class="attach-item"><span class="ai-icon">' + fileIcon(f.type) + '</span>' +
        '<span class="ai-name">' + esc(f.name) + '</span>' +
        '<span class="ai-meta">' + fileSize(f.size) + '</span>' +
        '<span class="ai-remove" onclick="sd.removePending(' + i + ')">&#10005;</span></div>';
    }).join('');
  }
  function attachZoneHtml() {
    return '<div class="field full"><label>Attachments</label>' +
      '<div class="attach-zone" onclick="document.getElementById(\'file-input\').click()">' +
        '<div class="az-icon">&#128206;</div>' +
        '<div class="az-text">Click to browse files</div>' +
        '<div class="az-hint">Images, PDFs, logs — max 10 MB per file (simulated)</div>' +
      '</div>' +
      '<input type="file" id="file-input" multiple style="display:none" onchange="sd.addFiles(this)">' +
      '<div id="pending-files" class="attach-list"></div></div>';
  }

  /* ---------- authorization / tenant isolation ---------- */
  function isAdmin(u) { return u.role === 'System Admin'; }
  function isAgent(u) { return u.role === 'Support Agent'; }
  function isClientAdmin(u) { return u.role === 'Client Admin'; }
  function isClient(u) { return u.role === 'Client User' || u.role === 'Client Admin'; }

  function agentCompanyIds(u) {
    return (DB.agentCompanies || [])
      .filter(function (m) { return m.userId === u.id; })
      .map(function (m) { return m.companyId; });
  }
  function agentCovers(userId, companyId) {
    return (DB.agentCompanies || []).some(function (m) { return m.userId === userId && m.companyId === companyId; });
  }

  function visibleTickets(u) {
    return DB.tickets.filter(function (t) {
      if (isAdmin(u)) return true;
      if (isAgent(u)) return agentCompanyIds(u).indexOf(t.companyId) >= 0;
      if (isClientAdmin(u)) return t.companyId === u.companyId;
      return t.companyId === u.companyId && t.createdBy === u.id;
    });
  }
  function canSee(u, t) { return visibleTickets(u).some(function (x) { return x.id === t.id; }); }
  function canCreate(u) { return isClient(u); }

  // Decision J + Decision A: who can assign
  // System Admin: any agent. Client User/Admin: agents mapped to their company.
  // Agent: self-assign from open queue (handled separately on detail page).
  function canAssign(u, t) {
    if (isAdmin(u)) return true;
    if (isClient(u) && t && t.companyId === u.companyId) return true;
    return false;
  }
  function canSelfAssign(u, t) {
    return isAgent(u) && t && t.assignedTo == null &&
      t.status !== 'Closed' && agentCovers(u.id, t.companyId);
  }
  function canEscalate(u, t) {
    return (isAgent(u) || isAdmin(u)) && t && t.status === 'In Progress';
  }
  function canSetPriority(u) { return isAdmin(u) || isAgent(u); }
  function canInternalNote(u) { return isAdmin(u) || isAgent(u); }

  function transitions(t, u) {
    var out = [];
    var agentOrAdmin = isAdmin(u) || (isAgent(u) && (t.assignedTo === u.id || t.assignedTo == null));
    var clientSide = isAdmin(u) || (isClient(u) && t.companyId === u.companyId);
    switch (t.status) {
      case 'Assigned':
        if (agentOrAdmin) out.push({ label: 'Start Work', to: 'In Progress', cls: 'btn-primary', icon: '&#9654;' });
        break;
      case 'In Progress':
        if (agentOrAdmin) { out.push({ label: 'Put On Hold', to: 'On Hold', cls: '', icon: '&#9208;' }); out.push({ label: 'Resolve', to: 'Resolved', cls: 'btn-hot', icon: '&#10003;' }); }
        break;
      case 'On Hold':
        if (agentOrAdmin) out.push({ label: 'Resume', to: 'In Progress', cls: 'btn-primary', icon: '&#9654;' });
        break;
      case 'Resolved':
        if (clientSide) { out.push({ label: 'Close', to: 'Closed', cls: 'btn-primary', icon: '&#10003;' }); out.push({ label: 'Reopen', to: 'In Progress', cls: '', icon: '&#8634;' }); }
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
      { key: 'home', label: 'Projects', icon: '&#128193;', href: '02-home.html', section: 'Overview' }
    ];
    // Dashboard visible to Agent, Admin, and Client Admin (FR-19)
    if (isAdmin(u) || isAgent(u) || isClientAdmin(u)) items.push({ key: 'dashboard', label: 'Dashboard', icon: '&#128202;', href: '03-dashboard.html', section: 'Overview' });
    items.push({ key: 'queue', label: queueLabel, icon: '&#127915;', href: '04-ticket-list.html', section: 'Tickets' });
    if (canCreate(u)) items.push({ key: 'create', label: 'Raise a Ticket', icon: '&#10133;', href: '06-create-ticket.html', section: 'Tickets' });
    if (isAdmin(u)) {
      items.push({ key: 'companies', label: 'Companies', icon: '&#127970;', href: '09-companies.html', section: 'Administration' });
      items.push({ key: 'users', label: 'Users', icon: '&#128101;', href: '10-users.html', section: 'Administration' });
      items.push({ key: 'categories', label: 'Categories', icon: '&#127991;&#65039;', href: '11-categories.html', section: 'Administration' });
    }
    items.push({ key: 'profile', label: 'My Profile', icon: '&#128100;', href: '12-profile.html', section: 'Account' });
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
      '<div class="brand"><div class="logo">&#127915;</div> ServiceDesk</div>' +
      '<div class="spacer"></div>' +
      '<div class="hdr-item" title="Reset demo data" onclick="sd.reset()">&#8634; Reset demo</div>' +
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
    return '<div class="demo-foot">&#129514; <b>Interactive demo</b> — simulated client-side login (no real auth). ' +
           'Data persists in your browser. Real auth &amp; tenant isolation are built in Oracle APEX. ' +
           '<a href="#" onclick="sd.reset();return false;">Reset</a></div>';
  }
  function tenantBanner(u) {
    if (isAdmin(u)) return '<div class="tenant-banner">&#127760; <b>System Admin</b> — viewing <b>all companies</b>. Other roles are scoped to their own company.</div>';
    if (isAgent(u)) {
      var projNames = agentCompanyIds(u).map(function (id) { return company(id).name; });
      var projList = projNames.length ? projNames.join(', ') : 'no projects assigned yet';
      return '<div class="tenant-banner">&#128736;&#65039; <b>Support Agent</b> — you only see tickets for <b>your assigned projects</b>: ' + esc(projList) + '. Other clients are hidden.</div>';
    }
    if (isClientAdmin(u)) return '<div class="tenant-banner">&#128274; <b>' + esc(company(u.companyId).name) + '</b> only — you see <b>all tickets for your company</b> (never other companies\u2019).</div>';
    return '<div class="tenant-banner">&#128274; <b>' + esc(company(u.companyId).name) + '</b> — you see <b>only your own tickets</b>.</div>';
  }
  function pageBar(crumb, title, actions) {
    return '<div class="page-bar"><div class="titles"><div class="crumb">' + crumb + '</div><h1>' + esc(title) + '</h1></div>' +
           '<div class="actions">' + (actions || '') + '</div></div>';
  }

  function landingFor(u) { return isAdmin(u) ? '03-dashboard.html' : '04-ticket-list.html'; }

  /* ---------- page: LOGIN ---------- */
  function renderLogin() {
    var cu = currentUser();
    if (cu) { location.href = landingFor(cu); return; }
    var personas = DB.users.map(function (u) {
      return '<button class="persona" onclick="sd.quickLogin(\'' + u.id + '\')">' +
        '<span class="avatar">' + initials(u.name) + '</span>' +
        '<span class="p-name">' + esc(u.name) + '</span>' +
        '<span class="p-role">' + esc(u.role) + ' &middot; ' + esc(company(u.companyId).name) + '</span></button>';
    }).join('');
    document.body.className = '';
    document.body.innerHTML =
      '<div class="login-wrap"><div class="login-card" style="max-width:760px;">' +
        '<div class="brand"><div class="logo">&#127915;</div><div>' +
          '<div style="font-weight:700;font-size:15px;">ServiceDesk</div>' +
          '<div class="muted" style="font-size:12px;">Multi-tenant support portal &middot; interactive demo</div></div></div>' +
        '<div class="grid cols-2" style="margin-top:14px;gap:28px;align-items:start;">' +
          '<div><h1>Sign in</h1><p class="sub">Use a demo account (password is <b>demo</b> for all).</p>' +
            '<div id="loginErr" class="login-error" style="display:none;"></div>' +
            '<div class="form-grid">' +
              '<div class="field"><label>Email</label><input id="email" type="email" value="anna@acme.example"></div>' +
              '<div class="field"><label>Password</label><input id="pwd" type="password" value="demo"></div>' +
              '<button class="btn btn-primary btn-block" onclick="sd.login()">Sign in</button>' +
            '</div></div>' +
          '<div><h1 style="font-size:16px;">Or pick a persona</h1>' +
            '<p class="sub">One click to log in and see that role\u2019s view.</p>' +
            '<div class="persona-grid">' + personas + '</div></div>' +
        '</div>' +
        '<hr class="sep"><p class="muted mb-0" style="font-size:11.5px;">&#129514; Simulated client-side login for demonstration only — not real authentication. ' +
        'Try logging in as <b>Anna (Client User)</b> then as <b>Sara (System Admin)</b> to see tenant isolation.</p>' +
      '</div></div>';
  }

  /* ---------- page: HOME (project picker) ---------- */
  function renderHome(u) {
    var companyIds;
    if (isAdmin(u)) companyIds = DB.companies.filter(function (c) { return c.type === 'CLIENT'; }).map(function (c) { return c.id; });
    else if (isAgent(u)) companyIds = agentCompanyIds(u);
    else companyIds = [u.companyId];
    var showGrab = isAdmin(u) || isAgent(u);

    var projects = companyIds.map(function (cid) {
      var c = company(cid);
      var ct = visibleTickets(u).filter(function (t) { return t.companyId === cid; });
      return { id: cid, name: c.name,
        open: ct.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length,
        unassigned: ct.filter(function (t) { return t.assignedTo == null && t.status !== 'Closed'; }).length,
        total: ct.length };
    }).sort(function (a, b) { return (b.open - a.open) || (b.unassigned - a.unassigned) || a.name.localeCompare(b.name); });

    var cards = projects.map(function (p) {
      var second = showGrab ? '<span><b>' + p.unassigned + '</b> unassigned</span>' : '<span><b>' + p.total + '</b> total</span>';
      return '<a class="card proj-card" data-name="' + esc(p.name.toLowerCase()) + '" href="04-ticket-list.html?company=' + encodeURIComponent(p.id) + '"><div class="card-bd">' +
        '<div class="proj-ico">' + initials(p.name) + '</div>' +
        '<div class="proj-name">' + esc(p.name) + '</div>' +
        '<div class="proj-stats"><span><b>' + p.open + '</b> open</span>' + second + '</div>' +
        '</div></a>';
    }).join('') || '<div class="muted">No projects assigned to you yet. Ask a System Admin to add you to a client.</div>';

    var searchBar = projects.length > 6
      ? '<div class="proj-toolbar"><div class="search">&#128270; <input id="projq" placeholder="Search projects\u2026" oninput="sd.filterProjects()"></div>' +
        '<span class="muted" id="projcount" style="font-size:12.5px;">' + projects.length + ' projects</span></div>'
      : '';

    var mine = visibleTickets(u).slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    var rows = mine.slice(0, 6).map(function (t) {
      return '<tr><td><a class="ref" href="05-ticket-detail.html?id=' + t.id + '">' + t.ref + '</a></td>' +
        '<td>' + esc(t.subject) + '</td><td>' + statusBadge(t.status) + '</td><td>' + sevBadge(t.severity) + '</td><td class="muted">' + timeAgo(t.updatedAt) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">No tickets yet.</td></tr>';

    var lead = isClient(u) ? 'Your workspace'
      : (isAdmin(u) ? 'All client companies — pick one to drill into its tickets'
                    : 'Your assigned projects — pick one to see its tickets');
    var html = pageBar('Home / Projects', 'Welcome back, ' + esc(u.name.split(' ')[0]) + ' &#128075;', '') +
      '<div class="content"><p class="muted" style="margin-top:0;">' + lead + '</p>' +
      searchBar +
      '<div class="grid cols-3" id="projgrid">' + cards + '</div>' +
      '<div class="card" style="margin-top:18px;"><div class="card-hd">Recent activity</div>' +
      '<table class="t"><thead><tr><th>Ref</th><th>Subject</th><th>Status</th><th>Severity</th><th>Updated</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    renderShell(u, 'home', html, tenantBanner(u));
  }

  /* ---------- page: DASHBOARD ---------- */
  function renderDashboard(u) {
    var ts = visibleTickets(u);
    var open = ts.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
    var unassigned = ts.filter(function (t) { return t.assignedTo == null && t.status !== 'Closed'; }).length;
    var inprog = ts.filter(function (t) { return t.status === 'In Progress'; }).length;
    var resolved = ts.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length;

    // SLA breach count
    var breached = ts.filter(function (t) { return slaStatus(t) === 'breached'; }).length;

    var kpis = [
      { l: 'Open Tickets', v: open, c: '#0572ce' },
      { l: 'Unassigned', v: unassigned, c: '#f97316' },
      { l: 'In Progress', v: inprog, c: '#eab308' },
      { l: 'Resolved / Closed', v: resolved, c: '#22c55e' },
      { l: 'SLA Breached', v: breached, c: '#b91c1c' }
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

    // severity breakdown (instead of old "priority" breakdown)
    var sevs = DB.severities || ['Critical', 'Major', 'Minor', 'Cosmetic'];
    var svcount = {}; sevs.forEach(function (s) { svcount[s] = 0; });
    ts.forEach(function (t) { if (t.severity) svcount[t.severity]++; });
    var stot = ts.length || 1;
    var svcolors = { 'Critical': '#b91c1c', 'Major': '#c2410c', 'Minor': '#0369a1', 'Cosmetic': '#64748b' };
    var svlegend = sevs.map(function (s) {
      return '<div class="li"><span class="sw" style="background:' + svcolors[s] + ';"></span> ' + s +
        ' <b style="margin-left:auto;">' + svcount[s] + ' (' + Math.round(svcount[s] / stot * 100) + '%)</b></div>';
    }).join('');

    // FR-28: Average resolution time
    var resolvedTickets = ts.filter(function (t) { return t.resolvedAt; });
    var avgResHours = 0;
    if (resolvedTickets.length) {
      var totalMs = resolvedTickets.reduce(function (sum, t) {
        return sum + (new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime());
      }, 0);
      avgResHours = Math.round(totalMs / resolvedTickets.length / (1000 * 3600));
    }
    var avgResDisplay = avgResHours >= 24 ? Math.round(avgResHours / 24) + ' days' : avgResHours + ' hrs';

    // FR-28: Tickets handled per agent
    var agentStats = DB.users.filter(function (x) { return x.role === 'Support Agent'; }).map(function (a) {
      var assigned = ts.filter(function (t) { return t.assignedTo === a.id; });
      var openT = assigned.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
      var closedT = assigned.filter(function (t) { return t.status === 'Closed' || t.status === 'Resolved'; }).length;
      return { name: a.name, open: openT, closed: closedT, total: assigned.length };
    });
    var agentRows = agentStats.map(function (a) {
      return '<tr><td><b>' + esc(a.name) + '</b></td><td>' + a.open + '</td><td>' + a.closed + '</td><td>' + a.total + '</td></tr>';
    }).join('');

    // company breakdown (admin/agent only)
    var companyCard = '';
    if (isAdmin(u) || isAgent(u)) {
      var companyIds = isAdmin(u)
        ? DB.companies.filter(function (c) { return c.type === 'CLIENT'; }).map(function (c) { return c.id; })
        : agentCompanyIds(u);
      var crows = companyIds.map(function (cid) {
        var c = company(cid);
        var ct = ts.filter(function (t) { return t.companyId === cid; });
        var o = ct.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
        var ip = ct.filter(function (t) { return t.status === 'In Progress'; }).length;
        var rs = ct.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length;
        var br = ct.filter(function (t) { return slaStatus(t) === 'breached'; }).length;
        return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + o + '</td><td>' + ip + '</td><td>' + rs + '</td><td>' + (br ? '<span class="sla-badge sla-breach">' + br + '</span>' : '0') + '</td></tr>';
      }).join('');
      var cardLabel = isAdmin(u) ? 'Tickets by Client Company <span class="sub">System Admin — cross-tenant view</span>' : 'Tickets by Project';
      companyCard = '<div class="card" style="margin-top:16px;"><div class="card-hd">' + cardLabel + '</div>' +
        '<table class="t"><thead><tr><th>Company</th><th>Open</th><th>In Progress</th><th>Resolved/Closed</th><th>SLA Breach</th></tr></thead><tbody>' + crows + '</tbody></table></div>';
    }

    // Analytics card (FR-28)
    var analyticsCard =
      '<div class="card" style="margin-top:16px;"><div class="card-hd">Operational Analytics <span class="sub">FR-28</span></div>' +
      '<div class="card-bd"><div class="grid cols-2">' +
        '<div><div class="stat" style="border:0;box-shadow:none;padding:0;"><span class="label">Avg Resolution Time</span><span class="value" style="font-size:24px;">' + avgResDisplay + '</span></div></div>' +
        '<div><div class="stat" style="border:0;box-shadow:none;padding:0;"><span class="label">Resolved Tickets</span><span class="value" style="font-size:24px;">' + resolvedTickets.length + '</span></div></div>' +
      '</div>' +
      '<div style="margin-top:16px;"><div style="font-weight:600;font-size:13px;margin-bottom:8px;">Tickets per Agent</div>' +
      '<table class="t"><thead><tr><th>Agent</th><th>Open</th><th>Resolved/Closed</th><th>Total</th></tr></thead><tbody>' + agentRows + '</tbody></table></div>' +
      '</div></div>';

    var html = pageBar('Overview / Dashboard', 'Dashboard', '') +
      '<div class="content"><div class="grid cols-5">' + kpis + '</div>' +
      '<div class="grid cols-2" style="margin-top:16px;">' +
        '<div class="card"><div class="card-hd">Tickets by Status</div><div class="card-bd"><div class="barchart">' + bars + '</div></div></div>' +
        '<div class="card"><div class="card-hd">Tickets by Severity</div><div class="card-bd"><div class="legend" style="flex-direction:column;gap:10px;">' + svlegend + '</div></div></div>' +
      '</div>' + companyCard + analyticsCard + '</div>';
    renderShell(u, 'dashboard', html, tenantBanner(u));
  }

  /* ---------- page: QUEUE ---------- */
  function queueFilters(u) {
    if (isClient(u)) return [{ f: 'open', label: 'Open' }, { f: 'all', label: 'All' }];
    return [{ f: 'mine', label: 'Assigned to me' }, { f: 'unassigned', label: 'Unassigned' }, { f: 'all', label: 'All' }];
  }
  function defaultFilter(u) { return isAgent(u) ? 'mine' : (isAdmin(u) ? 'all' : 'open'); }
  function applyQueueFilter(ts, u, f) {
    if (f === 'mine') return ts.filter(function (t) { return t.assignedTo === u.id; });
    if (f === 'unassigned') return ts.filter(function (t) { return t.assignedTo == null && t.status !== 'Closed'; });
    if (f === 'open') return ts.filter(function (t) { return t.status !== 'Closed'; });
    return ts;
  }
  function renderQueue(u) {
    var all = visibleTickets(u);
    var companyId = qs('company');
    if (companyId) all = all.filter(function (t) { return t.companyId === companyId; });
    var filters = queueFilters(u);
    var f = qs('f') || defaultFilter(u);
    if (!filters.some(function (x) { return x.f === f; })) f = defaultFilter(u);
    var ts = applyQueueFilter(all, u, f).slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    var showCompany = isAdmin(u) || isAgent(u);
    var cq = companyId ? '&company=' + encodeURIComponent(companyId) : '';

    var chips = filters.map(function (x) {
      var n = applyQueueFilter(all, u, x.f).length;
      return '<a class="chip' + (x.f === f ? ' active' : '') + '" href="04-ticket-list.html?f=' + x.f + cq + '">' +
        esc(x.label) + ' <span class="chip-n">' + n + '</span></a>';
    }).join('');
    var projTag = companyId ? '<a class="chip proj" href="04-ticket-list.html?f=' + f + '" title="Clear project filter">&#128193; ' + esc(company(companyId).name) + ' &#10005;</a>' : '';

    var rows = ts.map(function (t) {
      var asg = t.assignedTo ? esc(user(t.assignedTo).name) : '<span class="muted">— Unassigned</span>';
      return '<tr>' +
        '<td><a class="ref" href="05-ticket-detail.html?id=' + t.id + '">' + t.ref + '</a></td>' +
        '<td>' + esc(t.subject) + '</td>' +
        (showCompany ? '<td>' + esc(company(t.companyId).name) + '</td>' : '') +
        '<td>' + sevBadge(t.severity) + '</td>' +
        '<td>' + prioBadge(t.priority) + '</td>' +
        '<td>' + statusBadge(t.status) + '</td>' +
        '<td>' + asg + '</td>' +
        '<td class="muted">' + ageDays(t.createdAt) + '</td>' +
        '<td>' + slaBadge(t) + '</td>' +
        '</tr>';
    }).join('');
    if (!rows) {
      var colSpan = showCompany ? 9 : 8;
      var emptyMsg = { mine: 'Nothing is assigned to you right now — check <b>Unassigned</b> to pick up work.',
        unassigned: 'No unassigned tickets in your projects. The queue is clear. &#127881;',
        open: 'No open tickets — you\u2019re all caught up. &#127881;', all: 'No tickets visible to you.' }[f] || 'No tickets visible to you.';
      rows = '<tr><td colspan="' + colSpan + '" class="muted">' + emptyMsg + '</td></tr>';
    }
    var actions = canCreate(u) ? '<a class="btn btn-primary" href="06-create-ticket.html">&#10133; New Ticket</a>' : '';
    var html = pageBar('Tickets / Queue', isClient(u) ? 'My Tickets' : 'Ticket Queue', actions) +
      '<div class="content"><div class="card" style="overflow:hidden;">' +
      '<div class="toolbar">' + chips + projTag +
      '<div class="search">&#128270; <input id="q" placeholder="Search reference or keyword\u2026" oninput="sd.filterQueue()"></div>' +
      '<span class="muted" style="font-size:12.5px;margin-left:auto;" id="qcount">' + ts.length + ' results</span></div>' +
      '<table class="t" id="qtable"><thead><tr><th>Ref</th><th>Subject</th>' + (showCompany ? '<th>Company</th>' : '') +
      '<th>Severity</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Age</th><th>SLA</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    renderShell(u, 'queue', html, tenantBanner(u));
  }

  /* ---------- page: TICKET DETAIL ---------- */
  function renderDetail(u) {
    var t = DB.tickets.find(function (x) { return x.id === qs('id'); });
    if (!t) { renderShell(u, 'queue', notFound('Ticket not found.'), ''); return; }
    if (!canSee(u, t)) { renderShell(u, 'queue', notFound('&#128274; You don\u2019t have access to this ticket. (Tenant isolation in action.)'), ''); return; }

    var trs = transitions(t, u).map(function (a) {
      return '<button class="btn ' + a.cls + '" onclick="sd.changeStatus(\'' + t.id + '\',\'' + a.to + '\')">' + a.icon + ' ' + a.label + '</button>';
    }).join('');

    // Assignment button — Decision J: clients can assign from mapped agents
    var assignBtn = '';
    if (canAssign(u, t)) {
      assignBtn = '<a class="btn" href="07-assign.html?id=' + t.id + '">&#128100; ' + (t.assignedTo ? 'Reassign' : 'Assign') + '</a>';
    }
    // Self-assign button — Decision A: agents self-assign from open queue
    var selfAssignBtn = '';
    if (canSelfAssign(u, t)) {
      selfAssignBtn = '<button class="btn btn-primary" onclick="sd.selfAssign(\'' + t.id + '\')">&#9997; Self-Assign</button>';
    }
    // Escalate button — FR-26
    var escalateBtn = '';
    if (canEscalate(u, t)) {
      escalateBtn = '<button class="btn btn-escalate" onclick="sd.showEscalate(\'' + t.id + '\')">&#9888; Escalate</button>';
    }
    // Set Priority button — agents/admins can set priority during triage
    var prioBtn = '';
    if (canSetPriority(u) && !t.priority && t.status !== 'Closed') {
      prioBtn = '<button class="btn" onclick="sd.showSetPriority(\'' + t.id + '\')">&#9873; Set Priority</button>';
    }

    var comments = DB.comments.filter(function (c) { return c.ticketId === t.id; })
      .filter(function (c) { return !c.isInternal || canInternalNote(u); })
      .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    var cHtml = comments.map(function (c) {
      var au = user(c.userId) || { name: '?' };
      var cFiles = commentAttachments(c.id);
      var chipHtml = cFiles.length ? '<div class="file-chips">' + cFiles.map(function (a) {
        return '<span class="file-chip"><span class="fc-icon">' + fileIcon(a.mimeType) + '</span>' + esc(a.fileName) + '</span>';
      }).join('') + '</div>' : '';
      return '<div class="comment ' + (c.isInternal ? 'internal' : '') + '"><div class="av">' + initials(au.name) + '</div>' +
        '<div style="flex:1;"><div class="head"><b>' + esc(au.name) + '</b> &middot; ' + esc(au.role || '') +
        (c.isInternal ? ' &middot; <span class="badge st-progress">&#128274; Internal note</span>' : '') + ' &middot; ' + timeAgo(c.createdAt) + '</div>' +
        '<div class="body">' + esc(c.text) + '</div>' + chipHtml + '</div></div>';
    }).join('') || '<div class="muted">No comments yet.</div>';

    var hist = DB.history.filter(function (h) { return h.ticketId === t.id; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
      .map(function (h) {
        var hu = user(h.userId) || { name: '?' };
        var actionLabel = historyActionLabel(h);
        var chg = h.oldValue ? esc(h.oldValue) + ' &#8594; ' + esc(h.newValue) : esc(h.newValue);
        return '<li><span class="pt"></span><div><span class="who">' + esc(hu.name) + '</span> ' + esc(actionLabel) + '</div>' +
          '<div class="meta">' + chg + ' &middot; ' + timeAgo(h.createdAt) + '</div></li>';
      }).join('');

    var cu = user(t.createdBy) || { name: '?' };
    var sla = slaTarget(t.severity);
    var slaInfo = sla ? 'SLA: ' + sla.resolutionDays + 'd resolution' : '';
    var actions = assignBtn + selfAssignBtn + escalateBtn + prioBtn + trs +
      '<a class="btn btn-primary" href="08-add-comment.html?id=' + t.id + '">&#128172; Comment</a>';

    // CSAT section (FR-27) — shown when ticket is Closed
    var csatSection = '';
    if (t.status === 'Closed') {
      var canRate = isClient(u) && t.companyId === u.companyId && !t.csatScore;
      csatSection = '<div class="field" style="margin-top:12px;"><label>Customer Satisfaction (CSAT)</label><div>' +
        csatStars(t.csatScore, canRate) + '</div></div>';
    }

    var main =
      pageBar('<a href="04-ticket-list.html">Queue</a> / ' + t.ref, t.subject, actions) +
      '<div class="content" style="display:grid;grid-template-columns:1fr 300px;gap:16px;">' +
        '<div><div class="card"><div class="card-hd">' + t.ref + ' ' + statusBadge(t.status) + ' ' + sevBadge(t.severity) + ' ' + prioBadge(t.priority) + ' ' + slaBadge(t) + '</div>' +
          '<div class="card-bd"><p style="margin-top:0;">' + esc(t.description) + '</p>' +
          '<div class="grid cols-4" style="gap:8px;margin-top:8px;">' +
            '<div><div class="muted" style="font-size:11.5px;">Category</div><div>' + esc(category(t.categoryId).name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Raised by</div><div>' + esc(cu.name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Company</div><div>' + esc(company(t.companyId).name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Age</div><div>' + ageDays(t.createdAt) + '</div></div>' +
          '</div>' +
          (function () {
            var allFiles = ticketAttachments(t.id);
            if (!allFiles.length) return '';
            return '<div style="margin-top:14px;border-top:1px solid var(--c-border-lt);padding-top:12px;">' +
              '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">&#128206; Attachments <span class="muted" style="font-weight:400;font-size:12px;">' + allFiles.length + ' file' + (allFiles.length > 1 ? 's' : '') + '</span></div>' +
              '<div class="attach-grid">' + allFiles.map(function (a) {
                var up = user(a.uploadedBy) || { name: '?' };
                var context = a.commentId ? 'on comment' : 'on ticket';
                return '<div class="attach-row"><span class="ar-icon">' + fileIcon(a.mimeType) + '</span>' +
                  '<div class="ar-info"><div class="ar-name">' + esc(a.fileName) + '</div>' +
                  '<div class="ar-meta">' + fileSize(a.fileSize) + ' &middot; ' + esc(up.name) + ' &middot; ' + timeAgo(a.uploadedAt) + ' &middot; ' + context + '</div></div>' +
                  '<span class="ar-dl">&#8595; Download</span></div>';
              }).join('') + '</div></div>';
          })() + '</div></div>' +
          '<div class="card" style="margin-top:16px;"><div class="card-hd">Conversation' +
            '<a class="btn btn-sm btn-primary" style="margin-left:auto;" href="08-add-comment.html?id=' + t.id + '">&#128172; Add Comment</a></div>' +
            '<div class="card-bd">' + cHtml + '</div></div></div>' +
        '<div><div class="card"><div class="card-hd">Properties</div><div class="card-bd form-grid">' +
            '<div class="field"><label>Status</label><input value="' + esc(t.status) + '" disabled></div>' +
            '<div class="field"><label>Severity</label><div>' + sevBadge(t.severity) + '</div></div>' +
            '<div class="field"><label>Priority</label><div>' + prioBadge(t.priority) + '</div></div>' +
            '<div class="field"><label>Assignee</label><input value="' + esc(t.assignedTo ? user(t.assignedTo).name : 'Unassigned') + '" disabled></div>' +
            '<div class="field"><label>Company</label><input value="' + esc(company(t.companyId).name) + '" disabled></div>' +
            '<div class="field"><label>SLA Due</label><input value="' + (t.slaDueDate ? new Date(t.slaDueDate).toLocaleDateString() : '—') + '" disabled></div>' +
            '<div class="field"><label>' + slaInfo + '</label><div>' + slaBadge(t) + '</div></div>' +
            csatSection +
          '</div></div>' +
          '<div class="card" style="margin-top:16px;"><div class="card-hd">Activity History</div>' +
            '<div class="card-bd"><ul class="timeline">' + hist + '</ul></div></div></div>' +
      '</div>';
    renderShell(u, 'queue', main, '');
  }
  function notFound(msg) { return '<div class="content"><div class="card"><div class="card-bd"><p>' + msg + '</p><a class="btn" href="04-ticket-list.html">&#8592; Back to queue</a></div></div></div>'; }

  function historyActionLabel(h) {
    var map = {
      'STATUS_CHANGE': 'Changed status',
      'ASSIGN': 'Assigned',
      'ESCALATE': 'Escalated',
      'PRIORITY_CHANGE': 'Set priority',
      'COMMENT': 'Commented',
      'CSAT': 'Rated support'
    };
    return map[h.action] || h.action;
  }

  /* ---------- modal pages: CREATE / ASSIGN / COMMENT / ESCALATE ---------- */
  function renderModalPage(u, activeKey, behindHtml, modalHtml) {
    renderShell(u, activeKey, '<div class="behind">' + behindHtml + '</div>', '');
    var wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = modalHtml;
    document.body.appendChild(wrap);
  }

  function renderCreate(u) {
    if (!canCreate(u)) { renderShell(u, 'queue', notFound('Only client users can raise tickets.'), ''); return; }
    pendingFiles = [];
    var cats = DB.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    // Client sets both severity AND priority at creation
    var sevs = (DB.severities || ['Critical', 'Major', 'Minor', 'Cosmetic']).map(function (s) {
      return '<option' + (s === 'Minor' ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    var prios = '<option value="">— Select —</option>' + (DB.priorities || ['P1', 'P2', 'P3', 'P4']).map(function (p) {
      return '<option>' + p + '</option>';
    }).join('');
    // Decision J: agents mapped to the client's company
    var agentPool = DB.users.filter(function (x) { return x.role === 'Support Agent' && agentCovers(x.id, u.companyId); });
    var agentOpts = '<option value="">— Unassigned —</option>' + agentPool.map(function (a) {
      var load = DB.tickets.filter(function (x) { return x.assignedTo === a.id && x.status !== 'Closed'; }).length;
      return '<option value="' + a.id + '">' + esc(a.name) + ' \u00b7 ' + load + ' open</option>';
    }).join('');
    var modal = '<div class="modal lg"><div class="m-hd"><h2>Raise a Ticket</h2><span class="x" onclick="location.href=\'04-ticket-list.html\'">&#10005;</span></div>' +
      '<div class="m-bd"><div class="tenant-banner" style="border-radius:4px;margin-bottom:16px;">&#128274; Filed under <b>' + esc(company(u.companyId).name) + '</b> automatically (your company).</div>' +
      '<div class="form-grid cols-2">' +
        '<div class="field full"><label>Subject <span class="req">*</span></label><input id="subject" placeholder="Short summary"></div>' +
        '<div class="field full"><label>Description <span class="req">*</span></label><textarea id="desc" placeholder="Describe the issue\u2026"></textarea></div>' +
        '<div class="field"><label>Category</label><select id="cat">' + cats + '</select></div>' +
        '<div class="field"><label>Severity <span class="req">*</span></label><select id="sev">' + sevs + '</select>' +
          '<span class="hint">Business impact — how badly does this affect your work?</span></div>' +
        '<div class="field"><label>Priority</label><select id="prio">' + prios + '</select>' +
          '<span class="hint">How urgently should this be handled?</span></div>' +
        '<div class="field"><label>Assign to</label><select id="createAgent">' + agentOpts + '</select>' +
          '<span class="hint">Pick a support agent (optional).</span></div>' +
        attachZoneHtml() +
      '</div></div><div class="m-ft"><a class="btn" href="04-ticket-list.html">Cancel</a>' +
      '<button class="btn btn-primary" onclick="sd.createTicket()">&#10133; Submit Ticket</button></div></div>';
    renderModalPage(u, 'create', queueBehind(u), modal);
  }
  function queueBehind(u) { return pageBar('Tickets / Queue', isClient(u) ? 'My Tickets' : 'Ticket Queue', '') + '<div class="content"><div class="card" style="height:300px;"></div></div>'; }

  function renderAssign(u) {
    var t = DB.tickets.find(function (x) { return x.id === qs('id'); });
    if (!t || !canAssign(u, t)) { renderShell(u, 'queue', notFound('Not allowed, or ticket missing.'), ''); return; }
    // Decision J: For clients, only agents mapped to their company are offered.
    // For admin, all agents covering this company (fall back to all agents).
    var pool;
    if (isClient(u)) {
      pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && agentCovers(x.id, t.companyId); });
    } else {
      pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && agentCovers(x.id, t.companyId); });
      if (!pool.length) pool = DB.users.filter(function (x) { return x.role === 'Support Agent'; });
    }
    var agents = pool.map(function (a) {
      var load = DB.tickets.filter(function (x) { return x.assignedTo === a.id && x.status !== 'Closed'; }).length;
      return '<option value="' + a.id + '"' + (t.assignedTo === a.id ? ' selected' : '') + '>' + esc(a.name) + ' &middot; ' + load + ' open</option>';
    }).join('');
    var modal = '<div class="modal"><div class="m-hd"><h2>Assign &middot; ' + t.ref + '</h2><span class="x" onclick="location.href=\'05-ticket-detail.html?id=' + t.id + '\'">&#10005;</span></div>' +
      '<div class="m-bd"><p class="muted mt-0">Put an agent on <b>' + esc(t.subject) + '</b> (' + esc(company(t.companyId).name) + ', ' + esc(t.severity) + ').</p>' +
      (isClient(u) ? '<div class="tenant-banner" style="border-radius:4px;margin-bottom:12px;">&#128274; Only agents assigned to <b>' + esc(company(u.companyId).name) + '</b> are shown.</div>' : '') +
      '<div class="form-grid"><div class="field"><label>Assign to agent <span class="req">*</span></label><select id="agent">' + agents + '</select></div>' +
      '<div class="field"><label class="switch on" id="emailSw" onclick="this.classList.toggle(\'on\')"><span class="track"></span> Send assignment email (simulated)</label></div>' +
      '</div></div><div class="m-ft"><a class="btn" href="05-ticket-detail.html?id=' + t.id + '">Cancel</a>' +
      '<button class="btn btn-primary" onclick="sd.assign(\'' + t.id + '\')">&#128100; Assign</button></div></div>';
    renderModalPage(u, 'queue', detailBehind(t), modal);
  }
  function detailBehind(t) { return pageBar('Queue / ' + t.ref, t.subject, '') + '<div class="content"><div class="card" style="height:300px;"></div></div>'; }

  function renderComment(u) {
    var t = DB.tickets.find(function (x) { return x.id === qs('id'); });
    if (!t || !canSee(u, t)) { renderShell(u, 'queue', notFound('Not allowed, or ticket missing.'), ''); return; }
    var internalToggle = canInternalNote(u) ?
      '<div class="field"><label class="switch" id="intSw" onclick="this.classList.toggle(\'on\')"><span class="track"></span> &#128274; Internal note (hidden from client)</label></div>' : '';
    pendingFiles = [];
    var modal = '<div class="modal"><div class="m-hd"><h2>Add Comment &middot; ' + t.ref + '</h2><span class="x" onclick="location.href=\'05-ticket-detail.html?id=' + t.id + '\'">&#10005;</span></div>' +
      '<div class="m-bd"><div class="form-grid"><div class="field"><label>Comment <span class="req">*</span></label><textarea id="ctext" placeholder="Type your reply\u2026"></textarea></div>' +
      internalToggle + attachZoneHtml() + '</div></div><div class="m-ft"><a class="btn" href="05-ticket-detail.html?id=' + t.id + '">Cancel</a>' +
      '<button class="btn btn-primary" onclick="sd.addComment(\'' + t.id + '\')">&#128172; Post Comment</button></div></div>';
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
        '<td><span class="' + (c.status === 'Active' ? 'tag-active' : 'tag-inactive') + '">&#9679; ' + c.status + '</span></td></tr>';
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
        '<td>' + esc(company(x.companyId).name) + '</td><td><span class="tag-active">&#9679; Active</span></td></tr>';
    }).join('');
    var html = pageBar('Administration / Users', 'Users', '') +
      '<div class="content"><div class="card" style="overflow:hidden;"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 10 — APEX Interactive Grid. FR-6: role + company set here drive login\u2019s app items.</p></div>';
    renderShell(u, 'users', html, tenantBanner(u));
  }
  function renderCategories(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var rows = DB.categories.map(function (c) {
      var n = DB.tickets.filter(function (t) { return t.categoryId === c.id && t.status !== 'Closed'; }).length;
      return '<tr><td>' + esc(c.name) + '</td><td>' + n + '</td><td><span class="tag-active">&#9679; Active</span></td></tr>';
    }).join('');
    // Show SLA targets table (FR-23)
    var slaRows = (DB.slaTargets || []).map(function (s) {
      return '<tr><td>' + sevBadge(s.severity) + '</td><td>' + s.responseHours + 'h</td><td>' + s.resolutionDays + 'd</td></tr>';
    }).join('');
    var html = pageBar('Administration / Categories', 'Categories, Severities & SLA', '') +
      '<div class="content"><div class="grid cols-3">' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd">Categories</div><table class="t"><thead><tr><th>Category</th><th>Open</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd">Severities (client-set)</div><table class="t"><thead><tr><th>Severity</th><th>Badge</th></tr></thead><tbody>' +
        (DB.severities || []).map(function (s) { return '<tr><td>' + s + '</td><td>' + sevBadge(s) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<div class="card-hd" style="border-top:1px solid var(--c-border-lt);margin-top:0;">Priorities (support-set)</div><table class="t"><thead><tr><th>Priority</th><th>Badge</th></tr></thead><tbody>' +
        (DB.priorities || []).map(function (p) { return '<tr><td>' + p + '</td><td>' + prioBadge(p) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd">SLA Targets <span class="sub">FR-23 &middot; per severity</span></div><table class="t"><thead><tr><th>Severity</th><th>Response</th><th>Resolution</th></tr></thead><tbody>' + slaRows + '</tbody></table>' +
      '<div class="card-bd"><p class="muted" style="margin:0;font-size:11.5px;">Global targets, vendor-managed. SLA due date stamped at ticket creation.</p></div></div>' +
      '</div></div>';
    renderShell(u, 'categories', html, tenantBanner(u));
  }
  function renderProfile(u) {
    var html = pageBar('Account / Profile', 'My Profile', '') +
      '<div class="content" style="max-width:720px;"><div class="card"><div class="card-hd">Personal details</div><div class="card-bd">' +
      '<div style="display:flex;gap:16px;align-items:center;margin-bottom:18px;"><div class="avatar" style="width:60px;height:60px;font-size:22px;">' + initials(u.name) + '</div>' +
      '<div><div style="font-weight:600;font-size:16px;">' + esc(u.name) + '</div><div class="muted">' + esc(u.role) + ' &middot; ' + esc(company(u.companyId).name) + '</div></div></div>' +
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
      location.href = landingFor(u);
    },
    quickLogin: function (uid) { localStorage.setItem(LS_SESSION, JSON.stringify({ userId: uid })); location.href = landingFor(user(uid)); },
    logout: function () { localStorage.removeItem(LS_SESSION); location.href = '01-login.html'; },
    reset: function () { if (confirm('Reset all demo data and sign out?')) { localStorage.removeItem(LS_DATA); localStorage.removeItem(LS_SESSION); location.href = '01-login.html'; } },

    createTicket: function () {
      var u = currentUser();
      var subject = document.getElementById('subject').value.trim();
      var desc = document.getElementById('desc').value.trim();
      if (!subject || !desc) { alert('Subject and description are required.'); return; }
      var severity = document.getElementById('sev').value;
      var sla = slaTarget(severity);
      var slaDue = null;
      if (sla) {
        var d = new Date();
        d.setDate(d.getDate() + sla.resolutionDays);
        slaDue = d.toISOString();
      }
      var priority = document.getElementById('prio').value || null;
      var agentId = document.getElementById('createAgent').value || null;
      var r = nextRef();
      var initStatus = agentId ? 'Assigned' : 'New';
      var t = { id: 't' + r.n, ref: r.ref, companyId: u.companyId, subject: subject, description: desc,
        categoryId: document.getElementById('cat').value, severity: severity, priority: priority,
        status: initStatus, createdBy: u.id, assignedTo: agentId,
        createdAt: nowIso(), updatedAt: nowIso(), resolvedAt: null, closedAt: null,
        slaDueDate: slaDue, csatScore: null };
      DB.tickets.push(t);
      pushHistory(t.id, u.id, 'STATUS_CHANGE', '', initStatus);
      if (agentId) pushHistory(t.id, u.id, 'ASSIGN', '', user(agentId).name);
      // FR-25: save pending attachments
      pendingFiles.forEach(function (f) {
        DB.attachments.push({ id: 'a' + NOW() + Math.floor(Math.random() * 1000), ticketId: t.id, companyId: u.companyId, commentId: null, fileName: f.name, mimeType: f.type, fileSize: f.size, uploadedBy: u.id, uploadedAt: nowIso() });
      });
      pendingFiles = [];
      save();
      // FR-29: simulated auto-acknowledgement email
      sessionStorage.setItem('flash', '&#9989; Ticket ' + r.ref + ' created. &#128231; Auto-acknowledgement email sent (simulated).');
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
      pushHistory(id, u.id, 'ASSIGN', old === 'New' ? 'Unassigned' : (user(t.assignedTo) || {}).name || '', user(agentId).name);
      if (old === 'New') pushHistory(id, u.id, 'STATUS_CHANGE', old, t.status);
      save();
      sessionStorage.setItem('flash', (emailOn ? '&#128231; Assignment email sent (simulated). ' : '') + 'Assigned to ' + user(agentId).name + '.');
      location.href = '05-ticket-detail.html?id=' + id;
    },

    selfAssign: function (id) {
      var u = currentUser(), t = DB.tickets.find(function (x) { return x.id === id; });
      var old = t.status;
      t.assignedTo = u.id;
      if (t.status === 'New') t.status = 'Assigned';
      t.updatedAt = nowIso();
      pushHistory(id, u.id, 'ASSIGN', 'Unassigned', u.name + ' (self-assign)');
      if (old === 'New') pushHistory(id, u.id, 'STATUS_CHANGE', old, t.status);
      save();
      sessionStorage.setItem('flash', 'Self-assigned. You now own this ticket.');
      renderDetail(u);
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    addComment: function (id) {
      var u = currentUser(), text = document.getElementById('ctext').value.trim();
      if (!text) { alert('Comment cannot be empty.'); return; }
      var internalEl = document.getElementById('intSw');
      var internal = internalEl ? internalEl.classList.contains('on') : false;
      var cId = 'c' + NOW();
      DB.comments.push({ id: cId, ticketId: id, userId: u.id, text: text, isInternal: internal, createdAt: nowIso() });
      // FR-25: save pending attachments on the comment
      var t = DB.tickets.find(function (x) { return x.id === id; });
      pendingFiles.forEach(function (f) {
        DB.attachments.push({ id: 'a' + NOW() + Math.floor(Math.random() * 1000), ticketId: id, companyId: t.companyId, commentId: cId, fileName: f.name, mimeType: f.type, fileSize: f.size, uploadedBy: u.id, uploadedAt: nowIso() });
      });
      pendingFiles = [];
      t.updatedAt = nowIso();
      save();
      sessionStorage.setItem('flash', internal ? '&#128274; Internal note added.' : 'Comment posted.');
      location.href = '05-ticket-detail.html?id=' + id;
    },

    changeStatus: function (id, to) {
      var u = currentUser(), t = DB.tickets.find(function (x) { return x.id === id; });
      var old = t.status; t.status = to; t.updatedAt = nowIso();
      if (to === 'Resolved') t.resolvedAt = nowIso();
      if (to === 'Closed') t.closedAt = nowIso();
      pushHistory(id, u.id, 'STATUS_CHANGE', old, to);
      save();
      sessionStorage.setItem('flash', 'Status changed: ' + old + ' &#8594; ' + to + '.');
      renderDetail(u);
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // FR-26: Escalate — reassign to another agent + raise priority
    showEscalate: function (id) {
      var t = DB.tickets.find(function (x) { return x.id === id; });
      var u = currentUser();
      var pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && x.id !== t.assignedTo && agentCovers(x.id, t.companyId); });
      if (!pool.length) pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && x.id !== t.assignedTo; });
      var agents = pool.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('');
      var prios = (DB.priorities || ['P1','P2','P3','P4']).map(function (p) {
        var sel = t.priority && p < t.priority ? ' selected' : (p === 'P1' ? ' selected' : '');
        return '<option' + sel + '>' + p + '</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>&#9888; Escalate &middot; ' + t.ref + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><p class="muted mt-0">Reassign to a higher-tier agent and raise priority. This action is logged in history.</p>' +
        '<div class="form-grid"><div class="field"><label>Reassign to <span class="req">*</span></label><select id="escAgent">' + agents + '</select></div>' +
        '<div class="field"><label>New Priority <span class="req">*</span></label><select id="escPrio">' + prios + '</select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-escalate" onclick="sd.doEscalate(\'' + t.id + '\')">&#9888; Escalate</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.id = 'escModal';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doEscalate: function (id) {
      var u = currentUser(), t = DB.tickets.find(function (x) { return x.id === id; });
      var newAgent = document.getElementById('escAgent').value;
      var newPrio = document.getElementById('escPrio').value;
      var oldAgent = t.assignedTo ? user(t.assignedTo).name : 'Unassigned';
      var oldPrio = t.priority || '—';
      t.assignedTo = newAgent;
      t.priority = newPrio;
      t.updatedAt = nowIso();
      pushHistory(id, u.id, 'ESCALATE', oldAgent + ' / ' + oldPrio, user(newAgent).name + ' / ' + newPrio);
      save();
      sessionStorage.setItem('flash', '&#9888; Escalated: reassigned to ' + user(newAgent).name + ', priority raised to ' + newPrio + '.');
      sd.closeModal();
      renderDetail(u);
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // Set priority (support triage)
    showSetPriority: function (id) {
      var t = DB.tickets.find(function (x) { return x.id === id; });
      var prios = (DB.priorities || ['P1','P2','P3','P4']).map(function (p) {
        return '<option' + (p === 'P3' ? ' selected' : '') + '>' + p + '</option>';
      }).join('');
      var modal = '<div class="modal" style="max-width:400px;"><div class="m-hd"><h2>Set Priority &middot; ' + t.ref + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><p class="muted mt-0">Triage: set the support work-order priority.</p>' +
        '<div class="form-grid"><div class="field"><label>Priority</label><select id="newPrio">' + prios + '</select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doSetPriority(\'' + t.id + '\')">Set Priority</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.id = 'prioModal';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doSetPriority: function (id) {
      var u = currentUser(), t = DB.tickets.find(function (x) { return x.id === id; });
      var newPrio = document.getElementById('newPrio').value;
      var oldPrio = t.priority || '—';
      t.priority = newPrio;
      t.updatedAt = nowIso();
      pushHistory(id, u.id, 'PRIORITY_CHANGE', oldPrio, newPrio);
      save();
      sessionStorage.setItem('flash', 'Priority set to ' + newPrio + '.');
      sd.closeModal();
      renderDetail(u);
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // FR-27: CSAT rating
    rateCsat: function (starEl) {
      var val = parseInt(starEl.getAttribute('data-val'));
      var u = currentUser();
      // Find the ticket from the current page
      var tid = qs('id');
      var t = DB.tickets.find(function (x) { return x.id === tid; });
      if (!t || t.csatScore) return;
      t.csatScore = val;
      t.updatedAt = nowIso();
      pushHistory(tid, u.id, 'CSAT', '', val + '/5 stars');
      save();
      sessionStorage.setItem('flash', '&#11088; Thank you for your feedback! (' + val + '/5)');
      renderDetail(u);
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // FR-25: Attachment file handling (simulated)
    addFiles: function (input) {
      for (var i = 0; i < input.files.length; i++) {
        pendingFiles.push({ name: input.files[i].name, size: input.files[i].size, type: input.files[i].type || 'application/octet-stream' });
      }
      input.value = '';
      renderPendingFiles();
    },
    removePending: function (idx) {
      pendingFiles.splice(idx, 1);
      renderPendingFiles();
    },

    closeModal: function () {
      var m = document.querySelector('.modal-backdrop');
      if (m) m.remove();
    },

    filterQueue: function () {
      var q = document.getElementById('q').value.toLowerCase();
      var rows = document.querySelectorAll('#qtable tbody tr'), shown = 0;
      rows.forEach(function (r) { var hit = r.textContent.toLowerCase().indexOf(q) >= 0; r.style.display = hit ? '' : 'none'; if (hit) shown++; });
      document.getElementById('qcount').textContent = shown + ' results';
    },
    filterProjects: function () {
      var q = document.getElementById('projq').value.toLowerCase().trim();
      var cards = document.querySelectorAll('#projgrid .proj-card'), shown = 0;
      cards.forEach(function (c) { var hit = (c.getAttribute('data-name') || '').indexOf(q) >= 0; c.style.display = hit ? '' : 'none'; if (hit) shown++; });
      var el = document.getElementById('projcount'); if (el) el.textContent = shown + ' projects';
    }
  };

  /* ---------- router ---------- */
  function boot() {
    var page = document.body.getAttribute('data-page');
    if (page === 'login') { renderLogin(); return; }
    var u = currentUser();
    if (!u) { location.href = '01-login.html'; return; }
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
