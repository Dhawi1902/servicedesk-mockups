/* =========================================================================
   app.js — interactive demo engine for ServiceDesk.
   Simulated, CLIENT-SIDE only. Session + data live in localStorage.
   NOT real authentication. Demonstrates role-based access, tenant
   isolation, and the ticket lifecycle. Real version is built in APEX.

   Updated to match the latest brief (2026-07-02):
   - Severity (client-set) vs Priority (support-set) — Decision K / FR-7
   - Severity values: Critical/Major/Minor/Low (was Cosmetic → Low)
   - SLA per severity per company with breach indicators — FR-23
   - CSAT star rating after closure — FR-27
   - Escalate action (reassign + raise priority, tier-filtered) — FR-26
   - Client can assign from mapped agents — Decision J / FR-10
   - Agent self-assign from open queue — Decision A / FR-10
   - Dashboard analytics (avg resolution time, per-agent counts) — FR-28
   - Ticket age column — FR-15
   - Auto-acknowledgement email on create — FR-29
   - Ticket type INCIDENT / SERVICE_REQUEST — FR-30
   - First-response tracking — FR-31
   - SLA Compliance % KPI — FR-32
   - Severity guidance text — FR-34
   - Resolution code + summary on resolve — FR-36
   - Triage gate (priority required before In Progress) — FR-37
   - Client User department scoping — Decision N
   - Reopen count tracking
   - SLA Targets management page (Page 13)
   ========================================================================= */
(function () {
  'use strict';
  var LS_DATA = 'sd_demo_data_v6', LS_SESSION = 'sd_demo_session_v6';

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
  // Backfill arrays/fields for users with cached data from earlier versions
  if (!DB.attachments) { DB.attachments = []; }
  if (!DB.departments) { DB.departments = []; }
  if (!DB.ticketTypes) { DB.ticketTypes = ['INCIDENT', 'SERVICE_REQUEST']; }
  if (!DB.resolutionCodes) { DB.resolutionCodes = ['FIXED', 'WORKAROUND', 'KNOWN_ERROR', 'CANNOT_REPRODUCE', 'DUPLICATE', 'USER_EDUCATION', 'NOT_AN_INCIDENT']; }
  if (!DB.adminAuditLog) { DB.adminAuditLog = []; }
  DB.tickets.forEach(function (t) {
    if (t.ticketType === undefined) t.ticketType = 'INCIDENT';
    if (t.departmentId === undefined) t.departmentId = null;
    if (t.resolutionCode === undefined) t.resolutionCode = null;
    if (t.resolutionSummary === undefined) t.resolutionSummary = null;
    if (t.reopenCount === undefined) t.reopenCount = 0;
    if (t.firstResponseAt === undefined) t.firstResponseAt = null;
  });
  DB.users.forEach(function (x) {
    if (x.tier === undefined) x.tier = null;
    if (x.departmentId === undefined) x.departmentId = null;
  });
  save();

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
  function slaTarget(companyId, severity) {
    return (DB.slaTargets || []).find(function (s) { return s.companyId === companyId && s.severity === severity; });
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
  var SEV_CLS = { 'Critical': 'sev-critical', 'Major': 'sev-major', 'Minor': 'sev-minor', 'Low': 'sev-low' };
  var PRIO_CLS = { 'P1': 'pr-critical', 'P2': 'pr-high', 'P3': 'pr-medium', 'P4': 'pr-low' };
  function statusBadge(s) { return '<span class="badge ' + (STATUS_CLS[s] || '') + '"><span class="dot"></span>' + esc(s) + '</span>'; }
  function sevBadge(s) { return s ? '<span class="badge ' + (SEV_CLS[s] || '') + '">' + esc(s) + '</span>' : ''; }
  function prioBadge(p) { return p ? '<span class="badge ' + (PRIO_CLS[p] || '') + '">' + esc(p) + '</span>' : '<span class="muted">—</span>'; }

  /* ---------- ticket type badge (FR-30) ---------- */
  var TYPE_CLS = { 'INCIDENT': 'type-incident', 'SERVICE_REQUEST': 'type-request' };
  function typeBadge(t) {
    var label = t === 'SERVICE_REQUEST' ? 'Service Request' : 'Incident';
    return '<span class="badge ' + (TYPE_CLS[t] || '') + '">' + label + '</span>';
  }

  /* ---------- department lookup ---------- */
  function department(id) { return (DB.departments || []).find(function (d) { return d.id === id; }) || {}; }

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
  // Render inline previews: images as <img>, non-images as download chips
  function inlineAttachHtml(files) {
    if (!files.length) return '';
    var images = files.filter(function (a) { return a.mimeType && a.mimeType.indexOf('image/') === 0; });
    var others = files.filter(function (a) { return !a.mimeType || a.mimeType.indexOf('image/') !== 0; });
    var html = '';
    if (images.length) {
      html += '<div class="inline-previews">' + images.map(function (a) {
        // Simulated: use a placeholder gradient since we don't have real file data
        return '<div class="img-preview"><div class="img-placeholder">' + fileIcon(a.mimeType) +
          '<span>' + esc(a.fileName) + '</span></div>' +
          '<div class="img-caption">' + esc(a.fileName) + ' &middot; ' + fileSize(a.fileSize) + '</div></div>';
      }).join('') + '</div>';
    }
    if (others.length) {
      html += '<div class="file-chips">' + others.map(function (a) {
        return '<span class="file-chip"><span class="fc-icon">' + fileIcon(a.mimeType) + '</span>' +
          esc(a.fileName) + ' <span class="muted" style="font-size:10px;">' + fileSize(a.fileSize) + '</span></span>';
      }).join('') + '</div>';
    }
    return html;
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
      return t.companyId === u.companyId && t.departmentId === u.departmentId;
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
        if (agentOrAdmin) { out.push({ label: 'Put On Hold', to: 'On Hold', cls: '', icon: '&#9208;' }); out.push({ label: 'Resolve', to: 'Resolved', cls: 'btn-hot', icon: '&#10003;', action: 'resolve' }); }
        break;
      case 'On Hold':
        if (agentOrAdmin) out.push({ label: 'Resume', to: 'In Progress', cls: 'btn-primary', icon: '&#9654;' });
        break;
      case 'Resolved':
        if (clientSide) { out.push({ label: 'Close', to: 'Closed', cls: 'btn-primary', icon: '&#10003;', action: 'close' }); out.push({ label: 'Reopen', to: 'In Progress', cls: '', icon: '&#8634;' }); }
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
    // Dashboard visible to all roles (FR-19)
    items.push({ key: 'dashboard', label: 'Dashboard', icon: '&#128202;', href: '03-dashboard.html', section: 'Overview' });
    items.push({ key: 'queue', label: queueLabel, icon: '&#127915;', href: '04-ticket-list.html', section: 'Tickets' });
    if (canCreate(u)) items.push({ key: 'create', label: 'Raise a Ticket', icon: '&#10133;', href: '06-create-ticket.html', section: 'Tickets' });
    if (isAdmin(u)) {
      items.push({ key: 'companies', label: 'Companies', icon: '&#127970;', href: '09-companies.html', section: 'Administration' });
      items.push({ key: 'users', label: 'Users', icon: '&#128101;', href: '10-users.html', section: 'Administration' });
      items.push({ key: 'categories', label: 'Categories', icon: '&#127991;&#65039;', href: '11-categories.html', section: 'Administration' });
      items.push({ key: 'sla', label: 'SLA Targets', icon: '&#9202;', href: '13-sla-targets.html', section: 'Administration' });
      items.push({ key: 'agent-companies', label: 'Agent Mapping', icon: '&#128279;', href: '14-agent-companies.html', section: 'Administration' });
      items.push({ key: 'departments', label: 'Departments', icon: '&#127963;', href: '15-departments.html', section: 'Administration' });
      items.push({ key: 'audit-log', label: 'Audit Log', icon: '&#128220;', href: '16-audit-log.html', section: 'Administration' });
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
    var dept = department(u.departmentId);
    return '<div class="tenant-banner">&#128274; <b>' + esc(company(u.companyId).name) + '</b> / <b>' + esc(dept.name || 'General') + '</b> — you see <b>all tickets in your department</b>.</div>';
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

    // Group users by company
    var groups = [];
    // Vendor first
    var vendorUsers = DB.users.filter(function(u) { return u.companyId === 'C0'; });
    groups.push({ id: 'C0', name: 'Northwind IT', label: 'Vendor', users: vendorUsers });
    // Then each client company (active only)
    DB.companies.filter(function(c) { return c.type === 'CLIENT' && c.status === 'Active'; }).forEach(function(c) {
      var cUsers = DB.users.filter(function(u) { return u.companyId === c.id; });
      if (cUsers.length) groups.push({ id: c.id, name: c.name, label: c.name, users: cUsers });
    });

    // Build tabs
    var tabs = groups.map(function(g, i) {
      return '<button class="login-tab' + (i === 0 ? ' active' : '') + '" onclick="sd.switchLoginTab(\'' + g.id + '\', this)">' +
        esc(g.label) + ' <span class="tab-count">' + g.users.length + '</span></button>';
    }).join('');

    // Build tab panels
    var panels = groups.map(function(g, i) {
      var cards = g.users.map(function(u) {
        var roleLabel = u.role;
        if (u.tier) roleLabel += ' \u00b7 ' + u.tier;
        // For agents, show covered companies
        var coveredHtml = '';
        if (u.role === 'Support Agent') {
          var covered = (DB.agentCompanies || []).filter(function(ac) { return ac.userId === u.id; })
            .map(function(ac) { return company(ac.companyId).name; });
          if (covered.length) {
            coveredHtml = '<span class="p-covers">' + covered.map(function(n) { return '<span class="cover-tag">' + esc(n) + '</span>'; }).join(' ') + '</span>';
          }
        }
        // For clients, show department
        var deptHtml = '';
        if (u.departmentId) {
          var dept = (DB.departments || []).find(function(d) { return d.id === u.departmentId; });
          if (dept) deptHtml = '<span class="p-dept">' + esc(dept.name) + ' dept</span>';
        }
        var avatarCls = u.role === 'System Admin' ? 'av-admin' : (u.role === 'Support Agent' ? 'av-agent' : (u.role === 'Client Admin' ? 'av-cadmin' : 'av-cuser'));
        return '<button class="persona" onclick="sd.quickLogin(\'' + u.id + '\')">' +
          '<span class="avatar ' + avatarCls + '">' + initials(u.name) + '</span>' +
          '<span class="p-name">' + esc(u.name) + '</span>' +
          '<span class="p-role">' + esc(roleLabel) + '</span>' +
          coveredHtml + deptHtml + '</button>';
      }).join('');
      return '<div class="login-panel' + (i === 0 ? ' active' : '') + '" data-company="' + g.id + '">' + cards + '</div>';
    }).join('');

    document.body.className = '';
    document.body.innerHTML =
      '<div class="login-wrap"><div class="login-card" style="max-width:880px;">' +
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
            '</div>' +
            '<div class="role-legend">' +
              '<div class="rl-title">Roles in the system</div>' +
              '<div class="rl-item"><span class="avatar av-admin" style="width:18px;height:18px;font-size:8px;">SA</span> <b>System Admin</b> — sees everything, manages all</div>' +
              '<div class="rl-item"><span class="avatar av-agent" style="width:18px;height:18px;font-size:8px;">AG</span> <b>Support Agent</b> — works tickets (L1\u2013L4 tiers)</div>' +
              '<div class="rl-item"><span class="avatar av-cadmin" style="width:18px;height:18px;font-size:8px;">CA</span> <b>Client Admin</b> — sees all company tickets</div>' +
              '<div class="rl-item"><span class="avatar av-cuser" style="width:18px;height:18px;font-size:8px;">CU</span> <b>Client User</b> — sees own department only</div>' +
            '</div>' +
          '</div>' +
          '<div><h1 style="font-size:16px;">Pick a persona</h1>' +
            '<p class="sub">One click to sign in. Grouped by company.</p>' +
            '<div class="login-tabs">' + tabs + '</div>' +
            '<div class="login-panels">' + panels + '</div>' +
          '</div>' +
        '</div>' +
        '<hr class="sep"><p class="muted mb-0" style="font-size:11.5px;">&#129514; Simulated client-side login for demonstration only \u2014 not real authentication. ' +
        'Try different roles to see <b>tenant isolation</b> and <b>tier-based escalation</b> in action.</p>' +
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

    // FR-32: SLA Compliance % — resolved before SLA / total resolved
    var resolvedWithSla = ts.filter(function (t) { return (t.status === 'Resolved' || t.status === 'Closed') && t.slaDueDate; });
    var resolvedOnTime = resolvedWithSla.filter(function (t) {
      var resolveTime = new Date(t.resolvedAt || t.closedAt).getTime();
      return resolveTime <= new Date(t.slaDueDate).getTime();
    }).length;
    var slaCompliancePct = resolvedWithSla.length ? Math.round(resolvedOnTime / resolvedWithSla.length * 100) : 100;

    // Gap 4: Avg First Response
    var ticketsWithFr = ts.filter(function (t) { return t.firstResponseAt && t.createdAt; });
    var avgFrHours = 0;
    if (ticketsWithFr.length) {
      var frTotalMs = ticketsWithFr.reduce(function (sum, t) {
        return sum + (new Date(t.firstResponseAt).getTime() - new Date(t.createdAt).getTime());
      }, 0);
      avgFrHours = Math.round(frTotalMs / ticketsWithFr.length / (1000 * 3600) * 10) / 10;
    }
    var avgFrDisplay = avgFrHours >= 24 ? Math.round(avgFrHours / 24) + 'd' : avgFrHours + 'h';

    // Gap 4: Reopen Rate
    var resolvedOrClosed = ts.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; });
    var reopenedCount = resolvedOrClosed.filter(function (t) { return t.reopenCount > 0; }).length;
    var reopenPct = resolvedOrClosed.length ? Math.round(reopenedCount / resolvedOrClosed.length * 100) : 0;

    // Gap 4: CSAT Average
    var ticketsWithCsat = ts.filter(function (t) { return t.csatScore; });
    var csatAvg = 0;
    if (ticketsWithCsat.length) {
      csatAvg = Math.round(ticketsWithCsat.reduce(function (sum, t) { return sum + t.csatScore; }, 0) / ticketsWithCsat.length * 10) / 10;
    }
    var csatDisplay = ticketsWithCsat.length ? csatAvg + '/5' : '—';

    var kpiIcons = ['&#127915;', '&#128232;', '&#9881;', '&#9989;', '&#9202;', '&#9889;', '&#128260;', '&#11088;'];
    var kpiColors = ['#dbeafe', '#ffedd5', '#fef9c3', '#dcfce7', slaCompliancePct >= 80 ? '#dcfce7' : '#fee2e2', '#e0f2fe', reopenPct <= 10 ? '#dcfce7' : '#ffedd5', csatAvg >= 4 ? '#dcfce7' : (csatAvg >= 3 ? '#fef9c3' : '#fee2e2')];
    var kpiIconColors = ['#0572ce', '#f97316', '#eab308', '#22c55e', slaCompliancePct >= 80 ? '#22c55e' : '#b91c1c', '#0369a1', reopenPct <= 10 ? '#22c55e' : '#c2410c', csatAvg >= 4 ? '#22c55e' : (csatAvg >= 3 ? '#eab308' : '#b91c1c')];
    var kpiData = [
      { l: 'Open Tickets', v: open },
      { l: 'Unassigned', v: unassigned },
      { l: 'In Progress', v: inprog },
      { l: 'Resolved / Closed', v: resolved },
      { l: 'SLA Compliance', v: slaCompliancePct + '%' },
      { l: 'Avg First Response', v: avgFrDisplay },
      { l: 'Reopen Rate', v: reopenPct + '%' },
      { l: 'CSAT Average', v: csatDisplay }
    ];
    var kpis = kpiData.map(function (k, i) {
      return '<div class="kpi-badge"><div class="kpi-icon" style="background:' + kpiColors[i] + ';color:' + kpiIconColors[i] + ';">' + kpiIcons[i] + '</div>' +
        '<div class="kpi-body"><div class="kpi-value">' + k.v + '</div><div class="kpi-label">' + k.l + '</div></div></div>';
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
    var sevs = DB.severities || ['Critical', 'Major', 'Minor', 'Low'];
    var svcount = {}; sevs.forEach(function (s) { svcount[s] = 0; });
    ts.forEach(function (t) { if (t.severity) svcount[t.severity]++; });
    var stot = ts.length || 1;
    var svcolors = { 'Critical': '#b91c1c', 'Major': '#c2410c', 'Minor': '#0369a1', 'Low': '#64748b' };
    var svlegend = sevs.map(function (s) {
      return '<div class="li"><span class="sw" style="background:' + svcolors[s] + ';"></span> ' + s +
        ' <b style="margin-left:auto;">' + svcount[s] + ' (' + Math.round(svcount[s] / stot * 100) + '%)</b></div>';
    }).join('');

    // FR-30: Ticket type breakdown
    var incidentCount = ts.filter(function (t) { return t.ticketType === 'INCIDENT'; }).length;
    var srCount = ts.filter(function (t) { return t.ticketType === 'SERVICE_REQUEST'; }).length;
    var typeBreakdown = '<div class="legend" style="flex-direction:column;gap:10px;">' +
      '<div class="li"><span class="sw" style="background:#dc2626;"></span> Incidents <b style="margin-left:auto;">' + incidentCount + '</b></div>' +
      '<div class="li"><span class="sw" style="background:#2563eb;"></span> Service Requests <b style="margin-left:auto;">' + srCount + '</b></div>' +
      '</div>';

    // Priority breakdown (FR-18)
    var prios = DB.priorities || ['P1', 'P2', 'P3', 'P4'];
    var prcount = { 'Untriaged': 0 }; prios.forEach(function (p) { prcount[p] = 0; });
    ts.forEach(function (t) { if (t.priority) prcount[t.priority]++; else prcount['Untriaged']++; });
    var prcolors = { 'P1': '#b91c1c', 'P2': '#c2410c', 'P3': '#0369a1', 'P4': '#64748b', 'Untriaged': '#d4d4d8' };
    var prlegend = ['Untriaged'].concat(prios).map(function (p) {
      return '<div class="li"><span class="sw" style="background:' + prcolors[p] + ';"></span> ' + (p === 'Untriaged' ? '<i>Untriaged</i>' : p) +
        ' <b style="margin-left:auto;">' + prcount[p] + '</b></div>';
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
        // Gap 5: Per-company SLA compliance %
        var cResolved = ct.filter(function (t) { return (t.status === 'Resolved' || t.status === 'Closed') && t.slaDueDate; });
        var cOnTime = cResolved.filter(function (t) {
          var rt = new Date(t.resolvedAt || t.closedAt).getTime();
          return rt <= new Date(t.slaDueDate).getTime();
        }).length;
        var cSlaPct = cResolved.length ? Math.round(cOnTime / cResolved.length * 100) : 100;
        var cSlaCls = cSlaPct >= 90 ? 'sla-pct-green' : (cSlaPct >= 70 ? 'sla-pct-yellow' : 'sla-pct-red');
        return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + o + '</td><td>' + ip + '</td><td>' + rs + '</td><td>' + (br ? '<span class="sla-badge sla-breach">' + br + '</span>' : '0') + '</td><td><span class="' + cSlaCls + '">' + cSlaPct + '%</span></td></tr>';
      }).join('');
      var cardLabel = isAdmin(u) ? 'Tickets by Client Company <span class="sub">System Admin — cross-tenant view</span>' : 'Tickets by Project';
      companyCard = '<div class="card" style="margin-top:16px;"><div class="card-hd">' + cardLabel + '</div>' +
        '<table class="t"><thead><tr><th>Company</th><th>Open</th><th>In Progress</th><th>Resolved/Closed</th><th>SLA Breach</th><th>SLA Compliance</th></tr></thead><tbody>' + crows + '</tbody></table></div>';
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
      '<div class="content"><div class="grid cols-4">' + kpis + '</div>' +
      '<div class="grid cols-4" style="margin-top:16px;">' +
        '<div class="card"><div class="chart-region-hd">Tickets by Status</div><div class="card-bd"><div class="barchart">' + bars + '</div></div></div>' +
        '<div class="card"><div class="chart-region-hd">Tickets by Severity</div><div class="card-bd"><div class="legend" style="flex-direction:column;gap:10px;">' + svlegend + '</div></div></div>' +
        '<div class="card"><div class="chart-region-hd">Tickets by Priority</div><div class="card-bd"><div class="legend" style="flex-direction:column;gap:10px;">' + prlegend + '</div></div></div>' +
        '<div class="card"><div class="chart-region-hd">Tickets by Type <span class="sub">FR-30</span></div><div class="card-bd">' + typeBreakdown + '</div></div>' +
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

    // Build facet data
    var facetDefs = [
      { field: 'status', label: 'Status' },
      { field: 'severity', label: 'Severity' },
      { field: 'priority', label: 'Priority' },
      { field: 'type', label: 'Type' }
    ];
    if (showCompany) facetDefs.push({ field: 'company', label: 'Company' });
    facetDefs.push({ field: 'assignee', label: 'Assignee' });

    var facetValues = {};
    facetDefs.forEach(function (fd) { facetValues[fd.field] = {}; });
    ts.forEach(function (t) {
      var sv = { status: t.status, severity: t.severity || 'Unset', priority: t.priority || 'Untriaged',
        type: t.ticketType === 'SERVICE_REQUEST' ? 'Service Request' : 'Incident',
        company: company(t.companyId).name || '?',
        assignee: t.assignedTo ? (user(t.assignedTo) || {}).name || '?' : 'Unassigned' };
      facetDefs.forEach(function (fd) {
        var val = sv[fd.field];
        facetValues[fd.field][val] = (facetValues[fd.field][val] || 0) + 1;
      });
    });

    var facetHtml = facetDefs.map(function (fd) {
      var vals = Object.keys(facetValues[fd.field]).sort();
      var items = vals.map(function (v) {
        return '<div class="facet-item" data-field="' + fd.field + '" data-value="' + esc(v) + '" onclick="sd.toggleFacet(\'' + fd.field + '\',\'' + esc(v).replace(/'/g, "\\'") + '\')">' +
          '<span class="fi-check">&#10003;</span> ' + esc(v) + '<span class="fi-count">' + facetValues[fd.field][v] + '</span></div>';
      }).join('');
      return '<div class="facet-group"><div class="fg-label">' + fd.label + ' <span class="facet-clear" onclick="sd.clearFacets(\'' + fd.field + '\')">Clear</span></div>' + items + '</div>';
    }).join('');

    var rows = ts.map(function (t) {
      var asg = t.assignedTo ? user(t.assignedTo) : null;
      var asgName = asg ? esc(asg.name) : '<span class="muted">\u2014 Unassigned</span>';
      var asgAttr = asg ? asg.name : 'Unassigned';
      var typeLabel = t.ticketType === 'SERVICE_REQUEST' ? 'Service Request' : 'Incident';
      return '<tr data-status="' + esc(t.status) + '" data-severity="' + esc(t.severity || 'Unset') + '" data-priority="' + esc(t.priority || 'Untriaged') + '" data-type="' + esc(typeLabel) + '" data-company="' + esc(company(t.companyId).name) + '" data-assignee="' + esc(asgAttr) + '">' +
        '<td><a class="ref" href="05-ticket-detail.html?id=' + t.id + '">' + t.ref + '</a></td>' +
        '<td>' + esc(t.subject) + '</td>' +
        '<td>' + typeBadge(t.ticketType) + '</td>' +
        (showCompany ? '<td>' + esc(company(t.companyId).name) + '</td>' : '') +
        '<td>' + sevBadge(t.severity) + '</td>' +
        '<td>' + prioBadge(t.priority) + '</td>' +
        '<td>' + statusBadge(t.status) + '</td>' +
        '<td>' + asgName + '</td>' +
        '<td class="muted">' + ageDays(t.createdAt) + '</td>' +
        '<td>' + slaBadge(t) + '</td>' +
        '</tr>';
    }).join('');
    if (!rows) {
      var colSpan = showCompany ? 10 : 9;
      rows = '<tr><td colspan="' + colSpan + '" class="muted">No tickets visible to you.</td></tr>';
    }
    var actions = canCreate(u) ? '<a class="btn btn-primary" href="06-create-ticket.html">&#10133; New Ticket</a>' : '';
    window._facetState = {};

    var html = pageBar('Tickets / Queue', isClient(u) ? 'My Tickets' : 'Ticket Queue', actions) +
      '<div class="content"><div class="card" style="overflow:hidden;">' +
      '<div class="toolbar">' + chips + projTag + '</div>' +
      '<div class="queue-layout">' +
        '<div class="facet-panel">' + facetHtml + '</div>' +
        '<div class="queue-main">' +
          '<div class="ir-toolbar">' +
            '<div class="ir-search">&#128270; <input id="q" placeholder="Search reference or keyword\u2026" oninput="sd.filterQueue()"></div>' +
            '<div class="ir-actions">' +
              '<button class="ir-btn">Actions &#9662;</button>' +
              '<span class="ir-count" id="qcount">' + ts.length + ' results</span>' +
            '</div>' +
          '</div>' +
          '<table class="t" id="qtable"><thead><tr>' +
            '<th class="sortable">Ref <span class="sort-icon">&#9650;</span></th>' +
            '<th class="sortable">Subject</th>' +
            '<th class="sortable">Type</th>' +
            (showCompany ? '<th class="sortable">Company</th>' : '') +
            '<th class="sortable">Severity</th>' +
            '<th class="sortable">Priority</th>' +
            '<th class="sortable">Status</th>' +
            '<th class="sortable">Assignee</th>' +
            '<th class="sortable">Age <span class="sort-icon">&#9660;</span></th>' +
            '<th>SLA</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table>' +
          '<div class="ir-pagination">' +
            '<span>1 - ' + ts.length + ' of ' + ts.length + '</span>' +
            '<button>&#9664;</button><button>&#9654;</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '</div></div>';
    renderShell(u, 'queue', html, tenantBanner(u));
  }

  /* ---------- page: TICKET DETAIL ---------- */
  function renderDetail(u) {
    var t = DB.tickets.find(function (x) { return x.id === qs('id'); });
    if (!t) { renderShell(u, 'queue', notFound('Ticket not found.'), ''); return; }
    if (!canSee(u, t)) { renderShell(u, 'queue', notFound('&#128274; You don\u2019t have access to this ticket. (Tenant isolation in action.)'), ''); return; }

    var trs = transitions(t, u).map(function (a) {
      if (a.action === 'resolve') return '<button class="btn ' + a.cls + '" onclick="sd.showResolve(\'' + t.id + '\')">' + a.icon + ' ' + a.label + '</button>';
      if (a.action === 'close') return '<button class="btn ' + a.cls + '" onclick="sd.showClose(\'' + t.id + '\')">' + a.icon + ' ' + a.label + '</button>';
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
      return '<div class="comment ' + (c.isInternal ? 'internal' : '') + '"><div class="av">' + initials(au.name) + '</div>' +
        '<div style="flex:1;"><div class="head"><b>' + esc(au.name) + '</b> &middot; ' + esc(au.role || '') +
        (c.isInternal ? ' &middot; <span class="badge st-progress">&#128274; Internal note</span>' : '') + ' &middot; ' + timeAgo(c.createdAt) + '</div>' +
        '<div class="body">' + esc(c.text) + '</div>' + inlineAttachHtml(cFiles) + '</div></div>';
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
    var sla = slaTarget(t.companyId, t.severity);
    var slaInfo = sla ? 'SLA: ' + sla.resolutionDays + 'd resolution' : '';
    var actions = assignBtn + selfAssignBtn + escalateBtn + prioBtn + trs +
      '<a class="btn btn-primary" href="08-add-comment.html?id=' + t.id + '">&#128172; Comment</a>';

    // CSAT section (FR-27) — shown when ticket is Closed
    var csatSection = '';
    if (t.status === 'Closed') {
      var canRate = isClient(u) && t.companyId === u.companyId && u.id === t.createdBy && !t.csatScore;
      csatSection = '<div class="field" style="margin-top:12px;"><label>Customer Satisfaction (CSAT)</label><div>' +
        csatStars(t.csatScore, canRate) + '</div></div>';
    }

    var main =
      pageBar('<a href="04-ticket-list.html">Queue</a> / ' + t.ref, t.subject, actions) +
      '<div class="content" style="display:grid;grid-template-columns:1fr 300px;gap:16px;">' +
        '<div><div class="card"><div class="card-hd">' + t.ref + ' ' + typeBadge(t.ticketType) + ' ' + statusBadge(t.status) + ' ' + sevBadge(t.severity) + ' ' + prioBadge(t.priority) + ' ' + slaBadge(t) + '</div>' +
          '<div class="card-bd"><p style="margin-top:0;">' + esc(t.description) + '</p>' +
          inlineAttachHtml(ticketAttachments(t.id).filter(function (a) { return !a.commentId; })) +
          '<div class="grid cols-4" style="gap:8px;margin-top:8px;">' +
            '<div><div class="muted" style="font-size:11.5px;">Category</div><div>' + esc(category(t.categoryId).name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Raised by</div><div>' + esc(cu.name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Company</div><div>' + esc(company(t.companyId).name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Age</div><div>' + ageDays(t.createdAt) + '</div></div>' +
          '</div></div></div>' +
          '<div class="card" style="margin-top:16px;"><div class="card-hd">Conversation' +
            '<a class="btn btn-sm btn-primary" style="margin-left:auto;" href="08-add-comment.html?id=' + t.id + '">&#128172; Add Comment</a></div>' +
            '<div class="card-bd">' + cHtml + '</div></div>' +
          (function () {
            var allFiles = ticketAttachments(t.id);
            if (!allFiles.length) return '';
            return '<div class="card" style="margin-top:16px;"><div class="card-hd">&#128206; Attachments <span class="sub">' + allFiles.length + ' file' + (allFiles.length > 1 ? 's' : '') + '</span></div>' +
              '<div class="card-bd"><div class="attach-grid">' + allFiles.map(function (a) {
                var up = user(a.uploadedBy) || { name: '?' };
                var context = a.commentId ? 'on comment' : 'on ticket';
                return '<div class="attach-row"><span class="ar-icon">' + fileIcon(a.mimeType) + '</span>' +
                  '<div class="ar-info"><div class="ar-name">' + esc(a.fileName) + '</div>' +
                  '<div class="ar-meta">' + fileSize(a.fileSize) + ' &middot; ' + esc(up.name) + ' &middot; ' + timeAgo(a.uploadedAt) + ' &middot; ' + context + '</div></div>' +
                  '<span class="ar-dl">&#8595; Download</span></div>';
              }).join('') + '</div></div></div>';
          })() + '</div>' +
        '<div><div class="card"><div class="card-hd">Properties</div><div class="card-bd form-grid">' +
            '<div class="field"><label>Status</label><input value="' + esc(t.status) + '" disabled></div>' +
            '<div class="field"><label>Ticket Type</label><div>' + typeBadge(t.ticketType) + '</div></div>' +
            '<div class="field"><label>Severity</label><div>' + sevBadge(t.severity) + '</div></div>' +
            '<div class="field"><label>Priority</label><div>' + prioBadge(t.priority) + '</div></div>' +
            '<div class="field"><label>Assignee</label><input value="' + esc(t.assignedTo ? user(t.assignedTo).name : 'Unassigned') + '" disabled></div>' +
            '<div class="field"><label>Company</label><input value="' + esc(company(t.companyId).name) + '" disabled></div>' +
            '<div class="field"><label>Department</label><input value="' + esc(department(t.departmentId).name || '—') + '" disabled></div>' +
            '<div class="field"><label>SLA Due</label><input value="' + (t.slaDueDate ? new Date(t.slaDueDate).toLocaleDateString() : '—') + '" disabled></div>' +
            '<div class="field"><label>' + slaInfo + '</label><div>' + slaBadge(t) + '</div></div>' +
            (t.firstResponseAt ? '<div class="field"><label>First Response</label><input value="' + timeAgo(t.firstResponseAt) + '" disabled></div>' : '') +
            (t.reopenCount > 0 ? '<div class="field"><label>Reopen Count</label><input value="' + t.reopenCount + '" disabled></div>' : '') +
            ((t.status === 'Resolved' || t.status === 'Closed') && t.resolutionCode ? '<div class="field"><label>Resolution Code</label><input value="' + esc(t.resolutionCode) + '" disabled></div>' +
              '<div class="field"><label>Resolution Summary</label><div style="font-size:13px;">' + esc(t.resolutionSummary || '') + '</div></div>' : '') +
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
    var sevs = (DB.severities || ['Critical', 'Major', 'Minor', 'Low']).map(function (s) {
      return '<option' + (s === 'Minor' ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    // FR-30: Ticket type selector
    var typeOpts = (DB.ticketTypes || ['INCIDENT', 'SERVICE_REQUEST']).map(function (t) {
      return '<option value="' + t + '"' + (t === 'INCIDENT' ? ' selected' : '') + '>' + (t === 'SERVICE_REQUEST' ? 'Service Request' : 'Incident') + '</option>';
    }).join('');
    // Decision J: agents mapped to the client's company (L1 only for Client User — Decision L)
    var agentPool = DB.users.filter(function (x) { return x.role === 'Support Agent' && agentCovers(x.id, u.companyId) && x.tier === 'L1'; });
    var agentOpts = '<option value="">— Unassigned —</option>' + agentPool.map(function (a) {
      var load = DB.tickets.filter(function (x) { return x.assignedTo === a.id && x.status !== 'Closed'; }).length;
      return '<option value="' + a.id + '">' + esc(a.name) + (a.tier ? ' [' + a.tier + ']' : '') + ' \u00b7 ' + load + ' open</option>';
    }).join('');
    var dept = department(u.departmentId);
    var modal = '<div class="modal lg"><div class="m-hd"><h2>Raise a Ticket</h2><span class="x" onclick="location.href=\'04-ticket-list.html\'">&#10005;</span></div>' +
      '<div class="m-bd"><div class="tenant-banner" style="border-radius:4px;margin-bottom:16px;">&#128274; Filed under <b>' + esc(company(u.companyId).name) + '</b>' + (dept.name ? ' / <b>' + esc(dept.name) + '</b>' : '') + ' automatically.</div>' +
      '<div class="form-grid cols-2">' +
        '<div class="field full"><label>Ticket Type <span class="req">*</span></label><select id="ticketType">' + typeOpts + '</select>' +
          '<span class="hint">Incident = something is broken. Service Request = a standard request.</span></div>' +
        '<div class="field full"><label>Subject <span class="req">*</span></label><input id="subject" placeholder="Short summary"></div>' +
        '<div class="field full"><label>Description <span class="req">*</span></label><textarea id="desc" placeholder="Describe the issue\u2026"></textarea></div>' +
        '<div class="field"><label>Category <span class="req">*</span></label><select id="cat">' + cats + '</select></div>' +
        '<div class="field"><label>Severity <span class="req">*</span></label><select id="sev">' + sevs + '</select>' +
          '<span class="hint">Critical = Complete outage affecting all users. Major = Significant impact, workaround possible. Minor = Limited impact. Low = Cosmetic or nice-to-have.</span></div>' +
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
      pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && agentCovers(x.id, t.companyId) && x.tier === 'L1'; });
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
      return '<tr><td><span class="ig-row-check"></span></td><td><b>' + esc(c.name) + '</b></td><td>' + (c.type === 'VENDOR' ? '<span class="role-pill">VENDOR</span>' : 'CLIENT') +
        '</td><td>' + (c.type === 'VENDOR' ? '\u2014' : tk) + '</td><td>' + us + '</td>' +
        '<td><span class="' + (c.status === 'Active' ? 'tag-active' : 'tag-inactive') + '">&#9679; ' + c.status + '</span></td>' +
        '<td><button class="btn btn-sm" onclick="sd.showEditCompany(\'' + c.id + '\')">&#9998; Edit</button></td></tr>';
    }).join('');
    var html = pageBar('Administration / Companies', 'Companies', '') +
      '<div class="content"><div class="card" style="overflow:hidden;" id="ig-companies-wrap">' +
      '<div class="ig-toolbar">' +
        '<button class="ir-btn primary" onclick="sd.showAddCompany()">+ Add Row</button>' +
        '<button class="ir-btn">&#128190; Save</button>' +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.igSearch(\'ig-companies\')"></div>' +
        '<div class="ir-actions" style="margin-left:auto;">' +
          '<button class="ir-btn">Actions &#9662;</button>' +
          '<span class="ir-count">' + DB.companies.length + ' rows</span>' +
        '</div>' +
      '</div>' +
      '<table class="t ig-table" id="ig-companies"><thead><tr><th style="width:30px;"></th><th class="sortable">Company</th><th class="sortable">Type</th><th class="sortable">Tickets</th><th class="sortable">Users</th><th class="sortable">Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 9 \u2014 APEX Interactive Grid. FR-5: create/edit/deactivate companies.</p></div>';
    renderShell(u, 'companies', html, tenantBanner(u));
  }
  function renderUsers(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var rows = DB.users.map(function (x) {
      var dept = department(x.departmentId);
      return '<tr><td><span class="ig-row-check"></span></td><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.email) + '</td><td><span class="role-pill">' + esc(x.role) + '</span></td>' +
        '<td>' + esc(company(x.companyId).name) + '</td><td>' + (x.tier || '<span class="muted">\u2014</span>') + '</td>' +
        '<td>' + (dept.name ? esc(dept.name) : '<span class="muted">\u2014</span>') + '</td>' +
        '<td><span class="tag-active">&#9679; Active</span></td>' +
        '<td><button class="btn btn-sm" onclick="sd.showEditUser(\'' + x.id + '\')">&#9998; Edit</button></td></tr>';
    }).join('');
    // Company filter for user list
    var allCompanies = DB.companies.filter(function(c) { return c.status === 'Active'; });
    var userCompanySelect = '<select id="users-company-filter" class="ig-filter-select" onchange="sd.filterUsersByCompany(this.value)">' +
      '<option value="all">All Companies (' + allCompanies.length + ')</option>' +
      allCompanies.map(function (c) {
        var count = DB.users.filter(function(u2) { return u2.companyId === c.id; }).length;
        return '<option value="' + c.id + '">' + esc(c.name) + ' (' + count + ' users)</option>';
      }).join('') + '</select>';
    var html = pageBar('Administration / Users', 'Users', '') +
      '<div class="content"><div class="card" style="overflow:hidden;" id="ig-users-wrap">' +
      '<div class="ig-toolbar">' +
        '<button class="ir-btn primary" onclick="sd.showAddUser()">+ Add Row</button>' +
        '<button class="ir-btn">&#128190; Save</button>' +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.igSearch(\'ig-users\')"></div>' +
        '<div style="margin-left:8px;display:flex;align-items:center;gap:6px;"><label for="users-company-filter" style="font-size:12px;white-space:nowrap;">Company:</label>' + userCompanySelect + '</div>' +
        '<div class="ir-actions" style="margin-left:auto;">' +
          '<button class="ir-btn">Actions &#9662;</button>' +
          '<span class="ir-count" id="users-row-count">' + DB.users.length + ' rows</span>' +
        '</div>' +
      '</div>' +
      '<table class="t ig-table" id="ig-users"><thead><tr><th style="width:30px;"></th><th class="sortable">Name</th><th class="sortable">Email</th><th class="sortable">Role</th><th class="sortable">Company</th><th class="sortable">Tier</th><th class="sortable">Dept</th><th class="sortable">Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 10 \u2014 APEX Interactive Grid. FR-6: create/edit/deactivate users.</p></div>';
    renderShell(u, 'users', html, tenantBanner(u));
  }
  function renderCategories(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var rows = DB.categories.map(function (c) {
      var n = DB.tickets.filter(function (t) { return t.categoryId === c.id && t.status !== 'Closed'; }).length;
      return '<tr><td>' + esc(c.name) + '</td><td>' + n + '</td><td><span class="tag-active">&#9679; Active</span></td></tr>';
    }).join('');
    var html = pageBar('Administration / Categories', 'Categories, Severities & SLA', '') +
      '<div class="content"><div class="grid cols-3">' +
      '<div class="card" style="overflow:hidden;" id="ig-cats-wrap"><div class="card-hd">Categories</div>' +
      '<div class="ig-toolbar">' +
        '<button class="ir-btn">Actions &#9662;</button>' +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.igSearch(\'ig-cats\')"></div>' +
        '<span class="ir-count" style="margin-left:auto;">' + DB.categories.length + ' rows</span>' +
      '</div>' +
      '<table class="t" id="ig-cats"><thead><tr><th class="sortable">Category</th><th class="sortable">Open</th><th class="sortable">Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd">Severities (client-set)</div><table class="t"><thead><tr><th>Severity</th><th>Badge</th></tr></thead><tbody>' +
        (DB.severities || []).map(function (s) { return '<tr><td>' + s + '</td><td>' + sevBadge(s) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<div class="card-hd" style="border-top:1px solid var(--c-border-lt);margin-top:0;">Priorities (support-set)</div><table class="t"><thead><tr><th>Priority</th><th>Badge</th></tr></thead><tbody>' +
        (DB.priorities || []).map(function (p) { return '<tr><td>' + p + '</td><td>' + prioBadge(p) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd">SLA Targets</div>' +
      '<div class="card-bd"><p style="margin:0;">SLA targets are configured <b>per company</b> on the dedicated management page.</p>' +
      '<a class="btn btn-primary" href="13-sla-targets.html" style="margin-top:12px;">&#9202; Manage SLA Targets</a>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">' + (DB.slaTargets || []).length + ' targets across ' +
        DB.companies.filter(function(c) { return c.type === 'CLIENT' && c.status === 'Active'; }).length + ' active clients.</p>' +
      '</div></div>' +
      '</div></div>';
    renderShell(u, 'categories', html, tenantBanner(u));
  }
  /* ---------- page: SLA TARGETS (Page 13) ---------- */
  function renderSlaTargets(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    // Group SLA targets by company
    var byCompany = {};
    (DB.slaTargets || []).forEach(function (s) {
      if (!byCompany[s.companyId]) byCompany[s.companyId] = [];
      byCompany[s.companyId].push(s);
    });
    var clientCompanies = DB.companies.filter(function (c) { return c.type === 'CLIENT' && c.status === 'Active'; });

    // Build company filter dropdown (scales to many companies)
    var companySelect = '<select id="sla-company-filter" class="ig-filter-select" onchange="sd.switchSlaTab(this.value)">' +
      '<option value="all">All Companies (' + clientCompanies.length + ')</option>' +
      clientCompanies.map(function (c) {
        var count = (byCompany[c.id] || []).length;
        return '<option value="' + c.id + '">' + esc(c.name) + ' (' + count + ' targets)</option>';
      }).join('') + '</select>';

    // Build per-company tables
    var tables = clientCompanies.map(function (c) {
      var targets = byCompany[c.id] || [];
      var rows = targets.map(function (s) {
        return '<tr><td>' + sevBadge(s.severity) + '</td><td>' + s.responseHours + 'h</td><td>' + s.resolutionDays + 'd</td><td>' + (s.escalationPct || 80) + '%</td></tr>';
      }).join('');
      if (!rows) rows = '<tr><td colspan="4" class="muted">No targets configured — will use defaults.</td></tr>';
      // Ticket stats for this company
      var companyTickets = DB.tickets.filter(function (t) { return t.companyId === c.id; });
      var openCount = companyTickets.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
      var breachedCount = companyTickets.filter(function (t) { return slaStatus(t) === 'breached'; }).length;
      return '<div class="sla-company-card" data-sla-company="' + c.id + '">' +
        '<div class="card"><div class="card-hd"><span style="display:flex;align-items:center;gap:8px;">' + esc(c.name) +
        '<span class="muted" style="font-size:12px;font-weight:400;">' + openCount + ' open tickets' +
        (breachedCount ? ' &middot; <span style="color:#b91c1c;">' + breachedCount + ' breached</span>' : '') +
        '</span></span></div>' +
        '<table class="t"><thead><tr><th>Severity</th><th>Response Time</th><th>Resolution Time</th><th>Escalation Threshold</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }).join('');

    var html = pageBar('Administration / SLA Targets', 'SLA Targets', '') +
      '<div class="content">' +
      '<div class="card" style="margin-bottom:16px;"><div class="card-bd">' +
      '<p style="margin:0;font-size:13px;">Each client company has its own SLA targets per severity level. ' +
      'Response time = max time before first agent response. Resolution time = max time to resolve. ' +
      'Escalation threshold = % of SLA elapsed before auto-escalation triggers (FR-35).</p></div></div>' +
      '<div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;"><label for="sla-company-filter" style="font-weight:600;font-size:13px;white-space:nowrap;">Filter by Company:</label>' + companySelect + '</div>' +
      '<div id="sla-panels">' + tables + '</div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 13 — APEX Interactive Grid. System Admin only. In APEX, targets are editable inline.</p></div>';
    renderShell(u, 'sla', html, tenantBanner(u));
  }

  /* ---------- page: AGENT-COMPANY MAPPING (Page 14) ---------- */
  function renderAgentCompanies(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var mappings = (DB.agentCompanies || []);
    var rows = mappings.map(function (m, idx) {
      var a = user(m.userId);
      var c = company(m.companyId);
      if (!a || !c) return '';
      return '<tr><td><span class="ig-row-check"></span></td><td><b>' + esc(a.name) + '</b></td><td>' + esc(a.email) + '</td><td>' + (a.tier || '<span class="muted">&mdash;</span>') + '</td><td>' + esc(c.name) + '</td>' +
        '<td><button class="btn btn-sm" style="color:#b91c1c;" onclick="sd.removeAgentCompany(' + idx + ')">&#10005; Remove</button></td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="6" class="muted">No agent-company mappings yet.</td></tr>';
    var html = pageBar('Administration / Agent Mapping', 'Agent-Company Mapping', '') +
      '<div class="content"><div class="card" style="overflow:hidden;" id="ig-ac-wrap">' +
      '<div class="ig-toolbar">' +
        '<button class="ir-btn primary" onclick="sd.showAddAgentCompany()">+ Add Row</button>' +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.igSearch(\'ig-ac\')"></div>' +
        '<div class="ir-actions" style="margin-left:auto;">' +
          '<button class="ir-btn">Actions &#9662;</button>' +
          '<span class="ir-count">' + mappings.length + ' rows</span>' +
        '</div>' +
      '</div>' +
      '<table class="t ig-table" id="ig-ac"><thead><tr><th style="width:30px;"></th><th class="sortable">Agent</th><th class="sortable">Email</th><th class="sortable">Tier</th><th class="sortable">Company</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 14 &mdash; APEX Interactive Grid. Maps support agents to client companies they cover.</p></div>';
    renderShell(u, 'agent-companies', html, tenantBanner(u));
  }

  /* ---------- page: DEPARTMENTS (Page 15) ---------- */
  function renderDepartments(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var clientCompanies = DB.companies.filter(function (c) { return c.type === 'CLIENT' && c.status === 'Active'; });
    var deptCompanySelect = '<select id="dept-company-filter" class="ig-filter-select" onchange="sd.filterDeptsByCompany(this.value)">' +
      '<option value="all">All Companies (' + clientCompanies.length + ')</option>' +
      clientCompanies.map(function (c) {
        var count = (DB.departments || []).filter(function(d) { return d.companyId === c.id; }).length;
        return '<option value="' + c.id + '">' + esc(c.name) + ' (' + count + ' depts)</option>';
      }).join('') + '</select>';
    var rows = (DB.departments || []).map(function (d, idx) {
      var c = company(d.companyId);
      var userCount = DB.users.filter(function (x) { return x.departmentId === d.id; }).length;
      return '<tr data-dept-company="' + esc(d.companyId) + '"><td><span class="ig-row-check"></span></td><td><b>' + esc(d.name) + '</b></td><td>' + esc(c.name) + '</td><td>' + userCount + '</td>' +
        '<td><button class="btn btn-sm" onclick="sd.showEditDept(\'' + d.id + '\')">&#9998; Edit</button></td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="5" class="muted">No departments yet.</td></tr>';
    var html = pageBar('Administration / Departments', 'Departments', '') +
      '<div class="content"><div class="card" style="overflow:hidden;" id="ig-depts-wrap">' +
      '<div class="ig-toolbar">' +
        '<button class="ir-btn primary" onclick="sd.showAddDept()">+ Add Row</button>' +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.igSearch(\'ig-depts\')"></div>' +
        '<div style="margin-left:8px;display:flex;align-items:center;gap:6px;"><label for="dept-company-filter" style="font-size:12px;white-space:nowrap;">Company:</label>' + deptCompanySelect + '</div>' +
        '<div class="ir-actions" style="margin-left:auto;">' +
          '<button class="ir-btn">Actions &#9662;</button>' +
          '<span class="ir-count" id="depts-row-count">' + (DB.departments || []).length + ' rows</span>' +
        '</div>' +
      '</div>' +
      '<table class="t ig-table" id="ig-depts"><thead><tr><th style="width:30px;"></th><th class="sortable">Department</th><th class="sortable">Company</th><th class="sortable">Users</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 15 &mdash; APEX Interactive Grid. Decision N: departments per company.</p></div>';
    renderShell(u, 'departments', html, tenantBanner(u));
  }

  /* ---------- page: AUDIT LOG (Page 16) ---------- */
  function renderAuditLog(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var logs = (DB.adminAuditLog || []).slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    var rows = logs.map(function (l) {
      var au = user(l.userId);
      return '<tr><td class="audit-ts">' + esc(new Date(l.timestamp).toLocaleString()) + '</td>' +
        '<td>' + esc(au ? au.name : l.userId) + '</td>' +
        '<td><span class="audit-action">' + esc(l.action) + '</span></td>' +
        '<td class="audit-entity">' + esc(l.entity) + '</td>' +
        '<td>' + esc(l.record) + '</td>' +
        '<td class="muted">' + esc(l.oldValue || '—') + '</td>' +
        '<td class="muted">' + esc(l.newValue || '—') + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="7" class="muted">No admin actions logged yet. Try adding or editing a company or user.</td></tr>';
    var html = pageBar('Administration / Audit Log', 'Audit Log', '') +
      '<div class="content"><div class="card" style="overflow:hidden;" id="ig-audit-wrap">' +
      '<div class="ir-toolbar">' +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.igSearch(\'ig-audit\')"></div>' +
        '<div class="ir-actions" style="margin-left:auto;">' +
          '<button class="ir-btn">Actions &#9662;</button>' +
          '<span class="ir-count">' + logs.length + ' rows</span>' +
        '</div>' +
      '</div>' +
      '<table class="t" id="ig-audit"><thead><tr><th class="sortable">Timestamp</th><th class="sortable">User</th><th class="sortable">Action</th><th class="sortable">Entity</th><th class="sortable">Record</th><th>Old Value</th><th>New Value</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 16 &mdash; APEX Interactive Report (read-only). Tracks admin CRUD actions.</p></div>';
    renderShell(u, 'audit-log', html, tenantBanner(u));
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
  // Gap 3: Admin audit log helper
  function auditLog(userId, action, entity, record, oldValue, newValue) {
    if (!DB.adminAuditLog) DB.adminAuditLog = [];
    DB.adminAuditLog.push({ id: 'al' + NOW() + Math.floor(Math.random() * 1000), timestamp: nowIso(), userId: userId, action: action, entity: entity, record: record, oldValue: oldValue || '', newValue: newValue || '' });
  }

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
    switchLoginTab: function(companyId, btn) {
      document.querySelectorAll('.login-tab').forEach(function(t) { t.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.login-panel').forEach(function(p) {
        p.classList.toggle('active', p.getAttribute('data-company') === companyId);
      });
    },
    filterUsersByCompany: function(companyId) {
      var rows = document.querySelectorAll('#ig-users tbody tr');
      var visible = 0;
      rows.forEach(function(row) {
        var companyCell = row.children[4]; // Company is the 5th column (0-indexed)
        if (!companyCell) return;
        var show = (companyId === 'all' || companyCell.textContent.trim() === (DB.companies.find(function(c){ return c.id === companyId; }) || {}).name);
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      var countEl = document.getElementById('users-row-count');
      if (countEl) countEl.textContent = visible + ' rows';
    },
    switchSlaTab: function(companyId) {
      document.querySelectorAll('.sla-company-card').forEach(function(p) {
        p.style.display = (companyId === 'all' || p.getAttribute('data-sla-company') === companyId) ? '' : 'none';
      });
    },
    logout: function () { localStorage.removeItem(LS_SESSION); location.href = '01-login.html'; },
    reset: function () { if (confirm('Reset all demo data and sign out?')) { localStorage.removeItem(LS_DATA); localStorage.removeItem(LS_SESSION); location.href = '01-login.html'; } },

    createTicket: function () {
      var u = currentUser();
      var subject = document.getElementById('subject').value.trim();
      var desc = document.getElementById('desc').value.trim();
      if (!subject || !desc) { alert('Subject and description are required.'); return; }
      var severity = document.getElementById('sev').value;
      var ticketType = document.getElementById('ticketType').value;
      var sla = slaTarget(u.companyId, severity);
      var slaDue = null;
      if (sla) {
        var d = new Date();
        d.setDate(d.getDate() + sla.resolutionDays);
        slaDue = d.toISOString();
      }
      var agentId = document.getElementById('createAgent').value || null;
      var r = nextRef();
      var initStatus = agentId ? 'Assigned' : 'New';
      var t = { id: 't' + r.n, ref: r.ref, companyId: u.companyId, departmentId: u.departmentId, subject: subject, description: desc,
        categoryId: document.getElementById('cat').value, severity: severity, priority: null,
        status: initStatus, ticketType: ticketType, createdBy: u.id, assignedTo: agentId,
        createdAt: nowIso(), updatedAt: nowIso(), resolvedAt: null, closedAt: null,
        slaDueDate: slaDue, csatScore: null, firstResponseAt: null,
        resolutionCode: null, resolutionSummary: null, reopenCount: 0 };
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
      // FR-31: First response tracking — stamp on first agent/admin comment
      var t = DB.tickets.find(function (x) { return x.id === id; });
      if (!t.firstResponseAt && (isAgent(u) || isAdmin(u))) {
        t.firstResponseAt = nowIso();
      }
      // FR-25: save pending attachments on the comment
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
      // FR-37: Triage gate — priority required before moving to In Progress
      if (to === 'In Progress' && !t.priority) {
        alert('Priority must be set before starting work. Please set priority first (triage gate — FR-37).');
        return;
      }
      var old = t.status;
      // Reopen handling: Resolved → In Progress increments reopenCount
      if (to === 'In Progress' && old === 'Resolved') {
        t.reopenCount = (t.reopenCount || 0) + 1;
      }
      t.status = to; t.updatedAt = nowIso();
      // First response tracking (FR-31): stamp on first move to In Progress
      if (to === 'In Progress' && !t.firstResponseAt && (isAgent(u) || isAdmin(u))) {
        t.firstResponseAt = nowIso();
      }
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
      // FR-26: tier-filtered — show agents at same or higher tier than current assignee
      var TIER_ORDER = { 'L1': 1, 'L2': 2, 'L3': 3, 'L4': 4 };
      var currentAssignee = t.assignedTo ? user(t.assignedTo) : null;
      var currentTierLevel = currentAssignee && currentAssignee.tier ? (TIER_ORDER[currentAssignee.tier] || 0) : 0;
      var pool = DB.users.filter(function (x) {
        if (x.role !== 'Support Agent' || x.id === t.assignedTo) return false;
        if (!agentCovers(x.id, t.companyId)) return false;
        var agentTier = x.tier ? (TIER_ORDER[x.tier] || 0) : 0;
        return agentTier >= currentTierLevel;
      });
      if (!pool.length) pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && x.id !== t.assignedTo; });
      var agents = pool.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + (a.tier ? ' [' + a.tier + ']' : '') + '</option>'; }).join('');
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

    // FR-36: Resolve dialog — requires resolution code + summary
    showResolve: function (id) {
      var t = DB.tickets.find(function (x) { return x.id === id; });
      var codes = (DB.resolutionCodes || ['FIXED', 'WORKAROUND', 'KNOWN_ERROR', 'CANNOT_REPRODUCE', 'DUPLICATE', 'USER_EDUCATION', 'NOT_AN_INCIDENT']).map(function (c) {
        return '<option value="' + c + '">' + c.replace(/_/g, ' ') + '</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>&#10003; Resolve &middot; ' + t.ref + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><p class="muted mt-0">Mark this ticket as resolved. Resolution details are required (FR-36).</p>' +
        '<div class="form-grid">' +
          '<div class="field"><label>Resolution Code <span class="req">*</span></label><select id="resCode">' + codes + '</select></div>' +
          '<div class="field"><label>Resolution Summary <span class="req">*</span></label><textarea id="resSummary" placeholder="Describe what was done to resolve this\u2026"></textarea></div>' +
          '<div class="field"><label>Comment (optional)</label><textarea id="resComment" placeholder="Optional closing comment\u2026"></textarea></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-hot" onclick="sd.doResolve(\'' + t.id + '\')">&#10003; Resolve</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.id = 'resolveModal';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doResolve: function (id) {
      var u = currentUser(), t = DB.tickets.find(function (x) { return x.id === id; });
      var code = document.getElementById('resCode').value;
      var summary = document.getElementById('resSummary').value.trim();
      if (!summary) { alert('Resolution summary is required.'); return; }
      var comment = document.getElementById('resComment').value.trim();
      var old = t.status;
      t.status = 'Resolved';
      t.resolutionCode = code;
      t.resolutionSummary = summary;
      t.resolvedAt = nowIso();
      t.updatedAt = nowIso();
      pushHistory(id, u.id, 'STATUS_CHANGE', old, 'Resolved');
      if (comment) {
        DB.comments.push({ id: 'c' + NOW(), ticketId: id, userId: u.id, text: comment, isInternal: false, createdAt: nowIso() });
      }
      save();
      sessionStorage.setItem('flash', '&#10003; Resolved (' + code.replace(/_/g, ' ') + ').');
      sd.closeModal();
      renderDetail(u);
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // FR-27 + FR-11: Close dialog with optional CSAT
    showClose: function (id) {
      var t = DB.tickets.find(function (x) { return x.id === id; });
      var u = currentUser();
      var csatHtml = (isClient(u) && u.id === t.createdBy) ? '<div class="field"><label>How was the support? (optional)</label><div>' + csatStars(null, true) + '</div></div>' : '';
      var modal = '<div class="modal" style="max-width:440px;"><div class="m-hd"><h2>&#10003; Close &middot; ' + t.ref + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><p class="muted mt-0">Confirm you want to close this ticket. Once closed, it cannot be reopened.</p>' +
        '<div class="form-grid">' + csatHtml + '</div></div>' +
        '<div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doClose(\'' + t.id + '\')">&#10003; Close Ticket</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.id = 'closeModal';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doClose: function (id) {
      var u = currentUser(), t = DB.tickets.find(function (x) { return x.id === id; });
      // Check if user set CSAT via stars in the modal
      var stars = document.querySelectorAll('#closeModal .star.filled');
      if (stars.length) {
        t.csatScore = stars.length;
        pushHistory(id, u.id, 'CSAT', '', stars.length + '/5 stars');
      }
      var old = t.status;
      t.status = 'Closed';
      t.closedAt = nowIso();
      t.updatedAt = nowIso();
      pushHistory(id, u.id, 'STATUS_CHANGE', old, 'Closed');
      save();
      sessionStorage.setItem('flash', '&#10003; Ticket closed.' + (stars.length ? ' Thank you for your feedback!' : ''));
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

    // FR-5: Company CRUD
    showAddCompany: function() {
      var modal = '<div class="modal"><div class="m-hd"><h2>New Company</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Company Name <span class="req">*</span></label><input id="cmpName" placeholder="e.g. Wayne Enterprises"></div>' +
        '<div class="field"><label>Type</label><select id="cmpType"><option value="CLIENT" selected>CLIENT</option><option value="VENDOR">VENDOR</option></select></div>' +
        '<div class="field"><label>Status</label><select id="cmpStatus"><option value="Active" selected>Active</option><option value="Inactive">Inactive</option></select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddCompany()">&#10133; Create Company</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddCompany: function() {
      var name = document.getElementById('cmpName').value.trim();
      if (!name) { alert('Company name is required.'); return; }
      var type = document.getElementById('cmpType').value;
      var status = document.getElementById('cmpStatus').value;
      var id = 'C' + Date.now();
      DB.companies.push({ id: id, name: name, type: type, status: status });
      if (type === 'CLIENT') {
        (DB.severities || ['Critical','Major','Minor','Low']).forEach(function(sev) {
          var defaults = { 'Critical': {r:1,d:1}, 'Major': {r:4,d:3}, 'Minor': {r:8,d:7}, 'Low': {r:24,d:14} };
          var def = defaults[sev] || {r:24,d:14};
          DB.slaTargets.push({ companyId: id, severity: sev, responseHours: def.r, resolutionDays: def.d, escalationPct: 80 });
        });
      }
      auditLog(currentUser().id, 'CREATE', 'Company', name, '', type + ' / ' + status);
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'Company "' + name + '" created.' + (type === 'CLIENT' ? ' Default SLA targets added.' : ''));
      renderCompanies(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },
    showEditCompany: function(cid) {
      var c = DB.companies.find(function(x) { return x.id === cid; });
      if (!c) return;
      var modal = '<div class="modal"><div class="m-hd"><h2>Edit Company</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Company Name <span class="req">*</span></label><input id="cmpName" value="' + esc(c.name) + '"></div>' +
        '<div class="field"><label>Type</label><select id="cmpType"><option value="CLIENT"' + (c.type==='CLIENT'?' selected':'') + '>CLIENT</option><option value="VENDOR"' + (c.type==='VENDOR'?' selected':'') + '>VENDOR</option></select></div>' +
        '<div class="field"><label>Status</label><select id="cmpStatus"><option value="Active"' + (c.status==='Active'?' selected':'') + '>Active</option><option value="Inactive"' + (c.status==='Inactive'?' selected':'') + '>Inactive</option></select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doEditCompany(\'' + cid + '\')">Save Changes</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doEditCompany: function(cid) {
      var c = DB.companies.find(function(x) { return x.id === cid; });
      var name = document.getElementById('cmpName').value.trim();
      if (!name) { alert('Company name is required.'); return; }
      var oldName = c.name; var oldType = c.type; var oldStatus = c.status;
      c.name = name;
      c.type = document.getElementById('cmpType').value;
      c.status = document.getElementById('cmpStatus').value;
      var changes = [];
      if (oldName !== c.name) changes.push('name: ' + oldName + ' -> ' + c.name);
      if (oldType !== c.type) changes.push('type: ' + oldType + ' -> ' + c.type);
      if (oldStatus !== c.status) changes.push('status: ' + oldStatus + ' -> ' + c.status);
      if (changes.length) auditLog(currentUser().id, 'UPDATE', 'Company', c.name, oldName + ' / ' + oldType + ' / ' + oldStatus, c.name + ' / ' + c.type + ' / ' + c.status);
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'Company updated.');
      renderCompanies(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // FR-6: User CRUD
    showAddUser: function() {
      var companies = DB.companies.map(function(c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
      var depts = '<option value="">— None —</option>' + (DB.departments || []).map(function(d) {
        return '<option value="' + d.id + '">' + esc(d.name) + ' (' + esc(company(d.companyId).name) + ')</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>New User</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid cols-2">' +
        '<div class="field"><label>Full Name <span class="req">*</span></label><input id="usrName" placeholder="e.g. Jane Smith"></div>' +
        '<div class="field"><label>Email <span class="req">*</span></label><input id="usrEmail" type="email" placeholder="jane@company.example"></div>' +
        '<div class="field"><label>Role <span class="req">*</span></label><select id="usrRole"><option value="Client User">Client User</option><option value="Client Admin">Client Admin</option><option value="Support Agent">Support Agent</option><option value="System Admin">System Admin</option></select></div>' +
        '<div class="field"><label>Company <span class="req">*</span></label><select id="usrCompany">' + companies + '</select></div>' +
        '<div class="field"><label>Tier</label><select id="usrTier"><option value="">— None —</option><option>L1</option><option>L2</option><option>L3</option><option>L4</option></select><span class="hint">For Support Agents only</span></div>' +
        '<div class="field"><label>Department</label><select id="usrDept">' + depts + '</select><span class="hint">For client users</span></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddUser()">&#10133; Create User</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddUser: function() {
      var name = document.getElementById('usrName').value.trim();
      var email = document.getElementById('usrEmail').value.trim();
      if (!name || !email) { alert('Name and email are required.'); return; }
      if (DB.users.some(function(u) { return u.email.toLowerCase() === email.toLowerCase(); })) {
        alert('A user with this email already exists.'); return;
      }
      var role = document.getElementById('usrRole').value;
      var companyId = document.getElementById('usrCompany').value;
      var tier = document.getElementById('usrTier').value || null;
      var deptId = document.getElementById('usrDept').value || null;
      var id = 'u' + Date.now();
      DB.users.push({ id: id, name: name, email: email, password: 'demo', role: role, companyId: companyId, tier: tier, departmentId: deptId });
      auditLog(currentUser().id, 'CREATE', 'User', name + ' (' + email + ')', '', role + ' / ' + company(companyId).name);
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'User "' + name + '" created with role ' + role + '. Password: demo.');
      renderUsers(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },
    showEditUser: function(uid) {
      var x = DB.users.find(function(u) { return u.id === uid; });
      if (!x) return;
      var companies = DB.companies.map(function(c) { return '<option value="' + c.id + '"' + (c.id===x.companyId?' selected':'') + '>' + esc(c.name) + '</option>'; }).join('');
      var roles = ['Client User','Client Admin','Support Agent','System Admin'].map(function(r) {
        return '<option' + (r===x.role?' selected':'') + '>' + r + '</option>';
      }).join('');
      var tiers = ['','L1','L2','L3','L4'].map(function(t) {
        var label = t || '— None —';
        return '<option value="' + t + '"' + (t===(x.tier||'')?' selected':'') + '>' + label + '</option>';
      }).join('');
      var depts = '<option value="">— None —</option>' + (DB.departments || []).map(function(d) {
        return '<option value="' + d.id + '"' + (d.id===x.departmentId?' selected':'') + '>' + esc(d.name) + ' (' + esc(company(d.companyId).name) + ')</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>Edit User</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid cols-2">' +
        '<div class="field"><label>Full Name <span class="req">*</span></label><input id="usrName" value="' + esc(x.name) + '"></div>' +
        '<div class="field"><label>Email</label><input id="usrEmail" value="' + esc(x.email) + '" disabled><span class="hint">Cannot change email</span></div>' +
        '<div class="field"><label>Role <span class="req">*</span></label><select id="usrRole">' + roles + '</select></div>' +
        '<div class="field"><label>Company <span class="req">*</span></label><select id="usrCompany">' + companies + '</select></div>' +
        '<div class="field"><label>Tier</label><select id="usrTier">' + tiers + '</select><span class="hint">For Support Agents only</span></div>' +
        '<div class="field"><label>Department</label><select id="usrDept">' + depts + '</select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doEditUser(\'' + uid + '\')">Save Changes</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doEditUser: function(uid) {
      var x = DB.users.find(function(u) { return u.id === uid; });
      var name = document.getElementById('usrName').value.trim();
      if (!name) { alert('Name is required.'); return; }
      var oldRole = x.role; var oldCompany = x.companyId; var oldName = x.name;
      x.name = name;
      x.role = document.getElementById('usrRole').value;
      x.companyId = document.getElementById('usrCompany').value;
      x.tier = document.getElementById('usrTier').value || null;
      x.departmentId = document.getElementById('usrDept').value || null;
      auditLog(currentUser().id, 'UPDATE', 'User', x.name + ' (' + x.email + ')', oldName + ' / ' + oldRole + ' / ' + company(oldCompany).name, x.name + ' / ' + x.role + ' / ' + company(x.companyId).name);
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'User "' + name + '" updated.');
      renderUsers(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // Gap 1: Agent-Company Mapping CRUD
    showAddAgentCompany: function() {
      var agents = DB.users.filter(function(x) { return x.role === 'Support Agent'; });
      var agentOpts = agents.map(function(a) {
        return '<option value="' + a.id + '">' + esc(a.name) + (a.tier ? ' [' + a.tier + ']' : '') + '</option>';
      }).join('');
      var clientCompanies = DB.companies.filter(function(c) { return c.type === 'CLIENT' && c.status === 'Active'; });
      var companyOpts = clientCompanies.map(function(c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>Add Agent-Company Mapping</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Agent <span class="req">*</span></label><select id="acAgent">' + agentOpts + '</select></div>' +
        '<div class="field"><label>Company <span class="req">*</span></label><select id="acCompany">' + companyOpts + '</select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddAgentCompany()">&#10133; Add Mapping</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddAgentCompany: function() {
      var agentId = document.getElementById('acAgent').value;
      var companyId = document.getElementById('acCompany').value;
      if (!agentId || !companyId) { alert('Agent and company are required.'); return; }
      var exists = (DB.agentCompanies || []).some(function(m) { return m.userId === agentId && m.companyId === companyId; });
      if (exists) { alert('This mapping already exists.'); return; }
      DB.agentCompanies.push({ userId: agentId, companyId: companyId });
      auditLog(currentUser().id, 'CREATE', 'Agent-Company', user(agentId).name + ' -> ' + company(companyId).name, '', '');
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'Mapping added: ' + user(agentId).name + ' covers ' + company(companyId).name + '.');
      renderAgentCompanies(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },
    removeAgentCompany: function(idx) {
      var m = DB.agentCompanies[idx];
      if (!m) return;
      if (!confirm('Remove mapping: ' + (user(m.userId) || {}).name + ' from ' + company(m.companyId).name + '?')) return;
      auditLog(currentUser().id, 'DELETE', 'Agent-Company', (user(m.userId) || {}).name + ' -> ' + company(m.companyId).name, '', '');
      DB.agentCompanies.splice(idx, 1);
      save();
      sessionStorage.setItem('flash', 'Mapping removed.');
      renderAgentCompanies(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // Gap 2: Department CRUD
    showAddDept: function() {
      var clientCompanies = DB.companies.filter(function(c) { return c.type === 'CLIENT' && c.status === 'Active'; });
      var companyOpts = clientCompanies.map(function(c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>New Department</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Department Name <span class="req">*</span></label><input id="deptName" placeholder="e.g. Finance"></div>' +
        '<div class="field"><label>Company <span class="req">*</span></label><select id="deptCompany">' + companyOpts + '</select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddDept()">&#10133; Create Department</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddDept: function() {
      var name = document.getElementById('deptName').value.trim();
      var companyId = document.getElementById('deptCompany').value;
      if (!name) { alert('Department name is required.'); return; }
      var id = 'dep' + Date.now();
      DB.departments.push({ id: id, companyId: companyId, name: name });
      auditLog(currentUser().id, 'CREATE', 'Department', name + ' (' + company(companyId).name + ')', '', '');
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'Department "' + name + '" created under ' + company(companyId).name + '.');
      renderDepartments(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },
    showEditDept: function(deptId) {
      var d = (DB.departments || []).find(function(x) { return x.id === deptId; });
      if (!d) return;
      var clientCompanies = DB.companies.filter(function(c) { return c.type === 'CLIENT' && c.status === 'Active'; });
      var companyOpts = clientCompanies.map(function(c) {
        return '<option value="' + c.id + '"' + (c.id === d.companyId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>Edit Department</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Department Name <span class="req">*</span></label><input id="deptName" value="' + esc(d.name) + '"></div>' +
        '<div class="field"><label>Company <span class="req">*</span></label><select id="deptCompany">' + companyOpts + '</select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doEditDept(\'' + deptId + '\')">Save Changes</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doEditDept: function(deptId) {
      var d = (DB.departments || []).find(function(x) { return x.id === deptId; });
      var name = document.getElementById('deptName').value.trim();
      if (!name) { alert('Department name is required.'); return; }
      var oldName = d.name; var oldCompanyId = d.companyId;
      d.name = name;
      d.companyId = document.getElementById('deptCompany').value;
      auditLog(currentUser().id, 'UPDATE', 'Department', d.name, oldName + ' (' + company(oldCompanyId).name + ')', d.name + ' (' + company(d.companyId).name + ')');
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'Department updated.');
      renderDepartments(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },
    filterDeptsByCompany: function(companyId) {
      var rows = document.querySelectorAll('#ig-depts tbody tr');
      var visible = 0;
      rows.forEach(function(row) {
        var show = (companyId === 'all' || row.getAttribute('data-dept-company') === companyId);
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      var countEl = document.getElementById('depts-row-count');
      if (countEl) countEl.textContent = visible + ' rows';
    },

    closeModal: function () {
      var m = document.querySelector('.modal-backdrop');
      if (m) m.remove();
    },

    filterQueue: function () {
      var q = document.getElementById('q');
      var searchTerm = q ? q.value.toLowerCase() : '';
      var rows = document.querySelectorAll('#qtable tbody tr'), shown = 0;
      rows.forEach(function (r) {
        if (r.getAttribute('data-hidden-by-facet') === '1') { r.style.display = 'none'; return; }
        var hit = !searchTerm || r.textContent.toLowerCase().indexOf(searchTerm) >= 0;
        r.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      var el = document.getElementById('qcount');
      if (el) el.textContent = shown + ' results';
    },
    toggleFacet: function (field, value) {
      if (!window._facetState) window._facetState = {};
      if (!window._facetState[field]) window._facetState[field] = {};
      if (window._facetState[field][value]) {
        delete window._facetState[field][value];
      } else {
        window._facetState[field][value] = true;
      }
      if (Object.keys(window._facetState[field]).length === 0) delete window._facetState[field];
      var rows = document.querySelectorAll('#qtable tbody tr');
      rows.forEach(function (r) {
        var dominated = false;
        var state = window._facetState || {};
        Object.keys(state).forEach(function (f) {
          var allowed = Object.keys(state[f]);
          if (allowed.length === 0) return;
          var cellVal = r.getAttribute('data-' + f) || '';
          if (allowed.indexOf(cellVal) < 0) dominated = true;
        });
        r.setAttribute('data-hidden-by-facet', dominated ? '1' : '0');
      });
      document.querySelectorAll('.facet-item').forEach(function (fi) {
        var f = fi.getAttribute('data-field');
        var v = fi.getAttribute('data-value');
        var active = window._facetState && window._facetState[f] && window._facetState[f][v];
        fi.classList.toggle('active', !!active);
      });
      sd.filterQueue();
    },
    clearFacets: function (field) {
      if (window._facetState) delete window._facetState[field];
      var rows = document.querySelectorAll('#qtable tbody tr');
      rows.forEach(function (r) { r.setAttribute('data-hidden-by-facet', '0'); });
      if (window._facetState && Object.keys(window._facetState).length) {
        Object.keys(window._facetState).forEach(function (f) {
          var allowed = Object.keys(window._facetState[f]);
          if (!allowed.length) return;
          rows.forEach(function (r) {
            if (r.getAttribute('data-hidden-by-facet') === '1') return;
            var cellVal = r.getAttribute('data-' + f) || '';
            if (allowed.indexOf(cellVal) < 0) r.setAttribute('data-hidden-by-facet', '1');
          });
        });
      }
      document.querySelectorAll('.facet-item[data-field="' + field + '"]').forEach(function (fi) { fi.classList.remove('active'); });
      sd.filterQueue();
    },
    igSearch: function (tableId) {
      var inp = document.querySelector('#' + tableId + '-wrap .ir-search input');
      var term = inp ? inp.value.toLowerCase() : '';
      var rows = document.querySelectorAll('#' + tableId + ' tbody tr'), shown = 0;
      rows.forEach(function (r) { var hit = !term || r.textContent.toLowerCase().indexOf(term) >= 0; r.style.display = hit ? '' : 'none'; if (hit) shown++; });
      var el = document.querySelector('#' + tableId + '-wrap .ir-count');
      if (el) el.textContent = shown + ' rows';
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
      case 'sla-targets': renderSlaTargets(u); break;
      case 'agent-companies': renderAgentCompanies(u); break;
      case 'departments': renderDepartments(u); break;
      case 'audit-log': renderAuditLog(u); break;
      case 'profile': renderProfile(u); break;
      default: renderHome(u);
    }
    var f = sessionStorage.getItem('flash');
    if (f) { toast(f); sessionStorage.removeItem('flash'); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
