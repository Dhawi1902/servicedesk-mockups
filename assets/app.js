/* =========================================================================
   app.js — interactive demo engine for ServiceDesk.
   Simulated, CLIENT-SIDE only. Session + data live in localStorage.
   NOT real authentication. Demonstrates role-based access, tenant
   isolation, and the ticket lifecycle. Real version is built in APEX.

   Updated to match the latest brief (2026-07-04):
   - Decision O: PROJECTS layer between COMPANIES and TICKETS
   - Decision M revised 2026-07-04: tier is per agent-project mapping
     (agentProjects[].tier) — same agent can be L3 on one project, L2 on another
   - Decision N revised: project-scoped client visibility (not department-scoped)
   - Decision P: multi-role support (userRoles array)
   - AGENT_PROJECTS replaces AGENT_COMPANIES
   - Decision Q: PROJECTS.visibility OPEN/RESTRICTED; USER_PROJECTS is an
     INVITATION list (client sees OPEN projects + invited RESTRICTED ones);
     provider-company users auto-granted CLIENT_USER
   - Project Detail hub (Page 19): Details | Support Team | SLA | Categories | Invitations
   - SLA targets keyed on projectId (not companyId)
   - Severity (client-set) vs Priority (support-set) — Decision K / FR-7
   - Severity values: Critical/Major/Minor/Low
   - SLA per severity per project with breach indicators — FR-23
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
   - Reopen count tracking
   - SLA Targets management page (Page 13)
   - Projects management page (Page 11)
   - User-Projects management page (Page 18)
   ========================================================================= */
(function () {
  'use strict';
  var LS_DATA = 'sd_demo_data_v9', LS_SESSION = 'sd_demo_session_v9';

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

  // Backfill projects from seed if missing
  if (!DB.projects) { DB.projects = (window.DEMO_SEED && window.DEMO_SEED.projects) ? clone(window.DEMO_SEED.projects) : []; }
  // Backfill visibility (Decision Q) on projects cached before v8
  DB.projects.forEach(function (p) { if (p.visibility === undefined) p.visibility = 'OPEN'; });
  // Backfill userRoles from seed if missing
  if (!DB.userRoles) { DB.userRoles = (window.DEMO_SEED && window.DEMO_SEED.userRoles) ? clone(window.DEMO_SEED.userRoles) : []; }
  // Backfill userProjects from seed if missing
  if (!DB.userProjects) { DB.userProjects = (window.DEMO_SEED && window.DEMO_SEED.userProjects) ? clone(window.DEMO_SEED.userProjects) : []; }

  // Migrate agentCompanies -> agentProjects if needed
  if (!DB.agentProjects) {
    if (DB.agentCompanies && DB.agentCompanies.length) {
      // Best-effort migration: map each agent-company to the first project of that company
      DB.agentProjects = [];
      DB.agentCompanies.forEach(function (ac) {
        var compProjs = (DB.projects || []).filter(function (p) { return p.companyId === ac.companyId && p.isActive; });
        compProjs.forEach(function (p) {
          var exists = DB.agentProjects.some(function (ap) { return ap.userId === ac.userId && ap.projectId === p.id; });
          if (!exists) {
            DB.agentProjects.push({ userId: ac.userId, projectId: p.id });
          }
        });
      });
    } else {
      DB.agentProjects = (window.DEMO_SEED && window.DEMO_SEED.agentProjects) ? clone(window.DEMO_SEED.agentProjects) : [];
    }
  }
  // Remove old agentCompanies
  delete DB.agentCompanies;

  // Decision M revised 2026-07-04: tier lives on agentProjects mappings.
  // Migrate old localStorage shape (tier on the user) into the mappings, then drop it.
  (DB.agentProjects || []).forEach(function (m) {
    if (m.tier === undefined || m.tier === null) {
      var mu = DB.users.find(function (x) { return x.id === m.userId; });
      m.tier = (mu && mu.tier) ? mu.tier : 'L1';
    }
  });
  DB.users.forEach(function (x) {
    delete x.tier;
    if (x.departmentId === undefined) x.departmentId = null;
    if (x.status === undefined) x.status = 'Active';
    if (x.lastLogin === undefined) x.lastLogin = null;
  });

  DB.tickets.forEach(function (t) {
    if (t.ticketType === undefined) t.ticketType = 'INCIDENT';
    if (t.departmentId === undefined) t.departmentId = null;
    if (t.resolutionCode === undefined) t.resolutionCode = null;
    if (t.resolutionSummary === undefined) t.resolutionSummary = null;
    if (t.reopenCount === undefined) t.reopenCount = 0;
    if (t.firstResponseAt === undefined) t.firstResponseAt = null;
    // Backfill projectId on tickets if missing
    if (t.projectId === undefined || t.projectId === null) {
      var compProjs = (DB.projects || []).filter(function (p) { return p.companyId === t.companyId && p.isActive; });
      t.projectId = compProjs.length ? compProjs[0].id : null;
    }
  });

  DB.categories.forEach(function (c) {
    if (c.companyId === undefined) c.companyId = null;
    if (c.projectId === undefined) c.projectId = null;
    if (c.description === undefined) c.description = '';
    if (c.status === undefined) c.status = 'Active';
  });

  (DB.slaPolicies || []).forEach(function (sp) {
    if (sp.effectiveFrom === undefined) sp.effectiveFrom = '2026-01-01';
    if (sp.approvedBy === undefined) sp.approvedBy = 'u1';
    if (sp.notes === undefined) sp.notes = '';
  });
  (DB.projects || []).forEach(function (p) {
    if (p.slaPolicyId === undefined) p.slaPolicyId = null; // null = default policy applies
  });
  save();

  /* ---------- session ---------- */
  function getSession() { var r = localStorage.getItem(LS_SESSION); return r ? JSON.parse(r) : null; }
  // Decision P: the session may carry an activeRole override (nav-bar role switcher).
  // currentUser() returns the user AS the active role — the rest of the app just reads u.role.
  function currentUser() {
    var s = getSession(); if (!s) return null;
    var u = DB.users.find(function (x) { return x.id === s.userId; });
    if (!u) return null;
    if (s.activeRole && s.activeRole !== u.role) {
      var copy = clone(u); copy.role = s.activeRole; copy._baseRole = u.role;
      return copy;
    }
    return u;
  }
  // Roles this user can switch into (decision P), as display labels.
  // Decision Q rule: hide client mode while the accessible-project set is empty.
  var ROLE_LABEL = { SYSTEM_ADMIN: 'System Admin', SUPPORT_AGENT: 'Support Agent', CLIENT_ADMIN: 'Client Admin', CLIENT_USER: 'Client User' };
  function switchableRoles(u) {
    var labels = (DB.userRoles || []).filter(function (r) { return r.userId === u.id; })
      .map(function (r) { return ROLE_LABEL[r.role] || r.role; });
    var base = u._baseRole || u.role;
    if (labels.indexOf(base) < 0) labels.push(base);
    return labels.filter(function (l) {
      if (l === 'Client User' && userAccessibleProjectIds(u).length === 0 && labels.length > 1) return false;
      return true;
    });
  }

  /* ---------- lookups + utils ---------- */
  function company(id) { return DB.companies.find(function (c) { return c.id === id; }) || {}; }
  function user(id) { return DB.users.find(function (u) { return u.id === id; }) || null; }
  function category(id) { return DB.categories.find(function (c) { return c.id === id; }) || {}; }
  function project(id) { return (DB.projects || []).find(function (p) { return p.id === id; }) || {}; }
  function companyProjects(companyId) { return (DB.projects || []).filter(function (p) { return p.companyId === companyId && p.isActive; }); }

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

  // Decision M revised 2026-07-04: tier is per agent-project mapping —
  // "which support line is this agent on THIS project" (AGENT_PROJECTS.tier).
  function agentTier(userId, projectId) {
    var m = (DB.agentProjects || []).find(function (x) { return x.userId === userId && x.projectId === projectId; });
    return (m && m.tier) ? m.tier : null;
  }
  // Distinct tiers an agent holds across all their mappings, e.g. 'L2' or 'L2/L3'.
  // For project-less contexts only (users grid, login cards, dashboard rollups).
  function agentTierSummary(userId) {
    var seen = [];
    (DB.agentProjects || []).forEach(function (x) {
      if (x.userId === userId && x.tier && seen.indexOf(x.tier) < 0) seen.push(x.tier);
    });
    return seen.length ? seen.sort().join('/') : null;
  }
  // Sensible default when mapping an agent to a NEW project: their most common
  // existing tier (falls back to L1 = first-line).
  function defaultTierFor(userId) {
    var counts = {};
    (DB.agentProjects || []).forEach(function (x) {
      if (x.userId === userId && x.tier) counts[x.tier] = (counts[x.tier] || 0) + 1;
    });
    var best = null;
    Object.keys(counts).forEach(function (t) { if (!best || counts[t] > counts[best]) best = t; });
    return best || 'L1';
  }

  function ageDays(iso) {
    var d = (NOW() - new Date(iso).getTime()) / (1000 * 86400);
    if (d < 1) return '<1d';
    return Math.floor(d) + 'd';
  }

  /* ---------- Project-scoped agent functions ---------- */
  function agentProjectIds(u) {
    return (DB.agentProjects || []).filter(function (m) { return m.userId === u.id; }).map(function (m) { return m.projectId; });
  }
  function agentCoversProject(userId, projectId) {
    return (DB.agentProjects || []).some(function (m) { return m.userId === userId && m.projectId === projectId; });
  }
  // Derive company coverage from projects
  function agentCompanyIds(u) {
    var projIds = agentProjectIds(u);
    var compIds = [];
    projIds.forEach(function (pid) {
      var p = project(pid);
      if (p.companyId && compIds.indexOf(p.companyId) < 0) compIds.push(p.companyId);
    });
    return compIds;
  }

  // Client user's accessible projects (Decision Q):
  // all OPEN projects of their company + RESTRICTED projects they're invited to.
  // USER_PROJECTS rows GRANT access to restricted projects (invitation list).
  function userAccessibleProjectIds(u) {
    var invited = (DB.userProjects || []).filter(function (r) { return r.userId === u.id; })
      .map(function (r) { return r.projectId; });
    return companyProjects(u.companyId).filter(function (p) {
      return (p.visibility || 'OPEN') === 'OPEN' || invited.indexOf(p.id) >= 0;
    }).map(function (p) { return p.id; });
  }

  /* ---------- support-team helpers (Flows 3/4: L1 gate, removal guards) ---------- */
  // Returns the project's agents with .tier = their tier ON THIS PROJECT
  // (copies, not the live user objects — decision M revised).
  function projectTeam(projectId) {
    return (DB.agentProjects || []).filter(function (ap) { return ap.projectId === projectId; })
      .map(function (ap) {
        var a = DB.users.find(function (x) { return x.id === ap.userId; });
        if (!a) return null;
        var copy = clone(a);
        copy.tier = ap.tier || null;
        return copy;
      })
      .filter(function (a) { return !!a; });
  }
  function agentOpenCountInProject(agentId, projectId) {
    return DB.tickets.filter(function (t) {
      return t.assignedTo === agentId && t.projectId === projectId &&
        t.status !== 'Resolved' && t.status !== 'Closed';
    }).length;
  }
  // Returns a blocking message if the agent cannot be removed from the project, else null.
  function teamRemovalBlock(agentId, projectId) {
    var openN = agentOpenCountInProject(agentId, projectId);
    var a = DB.users.find(function (x) { return x.id === agentId; });
    var p = project(projectId);
    if (openN > 0) {
      return (a ? a.name : 'This agent') + ' still holds ' + openN + ' open ticket' + (openN > 1 ? 's' : '') +
        ' in ' + (p.projectName || 'this project') + '. Reassign them first (Flow 4).';
    }
    var l1s = projectTeam(projectId).filter(function (x) { return x.tier === 'L1' && x.status === 'Active'; });
    if (p.isActive && a && agentTier(agentId, projectId) === 'L1' && l1s.length === 1 && l1s[0].id === agentId) {
      return 'Cannot remove the last L1 agent from an active project — clients could assign nobody (FR-10). Map another L1 first.';
    }
    return null;
  }
  // Coverage warnings for a project's team (Flow 3 gates made visible)
  function teamCoverageBadges(projectId) {
    var team = projectTeam(projectId).filter(function (a) { return a.status === 'Active'; });
    var hasL1 = team.some(function (a) { return a.tier === 'L1'; });
    var hasHigher = team.some(function (a) { return a.tier && a.tier !== 'L1'; });
    var out = '';
    if (!hasL1) out += ' <span class="tag-warn" title="Clients could assign nobody (FR-10)">&#9888; No L1</span>';
    if (hasL1 && !hasHigher) out += ' <span class="tag-warn" title="Auto-escalation has no higher tier to go to (FR-35)">&#9888; No L2+</span>';
    return out;
  }
  // Coverage classifier for the exceptions-first Agent-Project Mapping view (Page 14).
  // An empty team also counts as 'no-l1': clients can assign nobody either way (FR-10).
  function projectCoverageIssues(projectId) {
    var team = projectTeam(projectId).filter(function (a) { return a.status === 'Active'; });
    if (!team.length) return ['no-agents', 'no-l1'];
    var issues = [];
    var hasL1 = team.some(function (a) { return a.tier === 'L1'; });
    if (!hasL1) issues.push('no-l1');
    if (hasL1 && !team.some(function (a) { return a.tier && a.tier !== 'L1'; })) issues.push('no-l2');
    if (team.length === 1) issues.push('single');
    return issues;
  }

  /* ---------- SLA (FR-23) — named policies assigned to projects ---------- */
  function slaPolicy(id) {
    return (DB.slaPolicies || []).find(function (sp) { return sp.id === id; }) || null;
  }
  function defaultSlaPolicy() {
    return (DB.slaPolicies || []).find(function (sp) { return sp.isDefault; }) || (DB.slaPolicies || [])[0] || null;
  }
  // Resolution order: project's assigned policy → default policy (Freshservice/ConnectWise pattern).
  function slaPolicyFor(projectId) {
    var p = project(projectId);
    return (p && p.slaPolicyId && slaPolicy(p.slaPolicyId)) || defaultSlaPolicy();
  }
  function slaPolicyProjects(policyId) {
    var def = defaultSlaPolicy();
    return (DB.projects || []).filter(function (p) {
      if (!p.isActive) return false;
      return p.slaPolicyId ? p.slaPolicyId === policyId : (def && def.id === policyId);
    });
  }
  function slaTarget(projectId, severity) {
    var pol = slaPolicyFor(projectId);
    if (!pol) return null;
    return (pol.targets || []).find(function (t) { return t.severity === severity; }) || null;
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
  function prioBadge(p) { return p ? '<span class="badge ' + (PRIO_CLS[p] || '') + '">' + esc(p) + '</span>' : '<span class="muted">\u2014</span>'; }

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
    if (!editable && !score) return '<span class="muted">\u2014</span>';
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
  function inlineAttachHtml(files) {
    if (!files.length) return '';
    var images = files.filter(function (a) { return a.mimeType && a.mimeType.indexOf('image/') === 0; });
    var others = files.filter(function (a) { return !a.mimeType || a.mimeType.indexOf('image/') !== 0; });
    var html = '';
    if (images.length) {
      html += '<div class="inline-previews">' + images.map(function (a) {
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
        '<div class="az-hint">Images, PDFs, logs \u2014 max 10 MB per file (simulated)</div>' +
      '</div>' +
      '<input type="file" id="file-input" multiple style="display:none" onchange="sd.addFiles(this)">' +
      '<div id="pending-files" class="attach-list"></div></div>';
  }

  /* ---------- authorization / tenant isolation ---------- */
  function isAdmin(u) { return u.role === 'System Admin'; }
  function isAgent(u) { return u.role === 'Support Agent'; }
  function isClientAdmin(u) { return u.role === 'Client Admin'; }
  function isClient(u) { return u.role === 'Client User' || u.role === 'Client Admin'; }

  function visibleTickets(u) {
    return DB.tickets.filter(function (t) {
      if (isAdmin(u)) return true;
      if (isAgent(u)) return agentProjectIds(u).indexOf(t.projectId) >= 0;
      if (isClientAdmin(u)) return t.companyId === u.companyId;
      // Client User: project-scoped (NOT department-scoped!)
      return t.companyId === u.companyId && userAccessibleProjectIds(u).indexOf(t.projectId) >= 0;
    });
  }
  function canSee(u, t) { return visibleTickets(u).some(function (x) { return x.id === t.id; }); }
  function canCreate(u) { return isClient(u); }

  function canAssign(u, t) {
    if (isAdmin(u)) return true;
    if (isClient(u) && t && t.companyId === u.companyId) return true;
    return false;
  }
  function canSelfAssign(u, t) {
    return isAgent(u) && t && t.assignedTo == null &&
      t.status !== 'Closed' && agentCoversProject(u.id, t.projectId);
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
      { key: 'home', label: 'Home', icon: '&#128193;', href: '02-home.html', section: 'Overview' }
    ];
    items.push({ key: 'dashboard', label: 'Dashboard', icon: '&#128202;', href: '03-dashboard.html', section: 'Overview' });
    items.push({ key: 'queue', label: queueLabel, icon: '&#127915;', href: '04-ticket-list.html', section: 'Tickets' });
    if (canCreate(u)) items.push({ key: 'create', label: 'Raise a Ticket', icon: '&#10133;', href: '06-create-ticket.html', section: 'Tickets' });
    if (isAdmin(u)) {
      items.push({ key: 'companies', label: 'Companies', icon: '&#127970;', href: '09-companies.html', section: 'Administration' });
      items.push({ key: 'projects', label: 'Projects', icon: '&#128194;', href: '11-projects.html', section: 'Administration' });
      items.push({ key: 'users', label: 'Users', icon: '&#128101;', href: '10-users.html', section: 'Administration' });
      items.push({ key: 'categories', label: 'Categories', icon: '&#127991;&#65039;', href: '11-categories.html', section: 'Administration' });
      items.push({ key: 'sla', label: 'SLA Policies', icon: '&#9202;', href: '13-sla-targets.html', section: 'Administration' });
      items.push({ key: 'agent-projects', label: 'Agent-Project Mapping', icon: '&#128279;', href: '14-agent-companies.html', section: 'Administration' });
      items.push({ key: 'audit-log', label: 'Audit Log', icon: '&#128220;', href: '16-audit-log.html', section: 'Administration' });
    }
    if (isClientAdmin(u)) {
      items.push({ key: 'projects', label: 'Projects', icon: '&#128194;', href: '11-projects.html', section: 'Administration' });
      items.push({ key: 'my-company', label: 'My Company', icon: '&#127970;', href: '17-company-detail.html', section: 'Administration' });
    }
    if (isClient(u) && !isClientAdmin(u)) {
      items.push({ key: 'projects', label: 'Projects', icon: '&#128194;', href: '11-projects.html', section: 'Workspace' });
      items.push({ key: 'my-company', label: 'My Company', icon: '&#127970;', href: '17-company-detail.html', section: 'Workspace' });
    }
    if (isAgent(u)) {
      items.push({ key: 'projects', label: 'Projects', icon: '&#128194;', href: '11-projects.html', section: 'Workspace' });
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
    // Decision P: nav-bar role switcher for multi-role users (no re-login).
    var roles = switchableRoles(u);
    var rolePillHtml;
    if (roles.length > 1) {
      rolePillHtml = '<span class="role-pill" title="You hold multiple roles (decision P) — switch without re-login" style="padding:0;">' +
        '<select onchange="sd.switchRole(this.value)" style="border:none;background:transparent;font:inherit;color:inherit;padding:3px 6px;cursor:pointer;">' +
        roles.map(function (r) { return '<option' + (r === u.role ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') +
        '</select></span>';
    } else {
      rolePillHtml = '<span class="role-pill">' + esc(u.role) + '</span>';
    }
    var header =
      '<div class="brand"><div class="logo">&#127915;</div> ServiceDesk</div>' +
      '<div class="spacer"></div>' +
      '<div class="hdr-item" title="Reset demo data" onclick="sd.reset()">&#8634; Reset demo</div>' +
      '<div class="hdr-item">' + rolePillHtml + '</div>' +
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
    return '<div class="demo-foot">&#129514; <b>Interactive demo</b> \u2014 simulated client-side login (no real auth). ' +
           'Data persists in your browser. Real auth &amp; tenant isolation are built in Oracle APEX. ' +
           '<a href="#" onclick="sd.reset();return false;">Reset</a></div>';
  }
  function tenantBanner(u) {
    if (isAdmin(u)) return '<div class="tenant-banner">&#127760; <b>System Admin</b> \u2014 viewing <b>all companies</b> and <b>all projects</b>. Other roles are scoped to their own company/projects.</div>';
    if (isAgent(u)) {
      var projIds = agentProjectIds(u);
      // Group projects by company
      var byComp = {};
      projIds.forEach(function (pid) {
        var p = project(pid);
        var cName = company(p.companyId).name || '?';
        if (!byComp[cName]) byComp[cName] = [];
        byComp[cName].push(p.projectName || p.projectKey || pid);
      });
      var parts = [];
      Object.keys(byComp).forEach(function (cName) {
        parts.push(esc(cName) + ' (' + byComp[cName].map(function (n) { return esc(n); }).join(', ') + ')');
      });
      var projList = parts.length ? parts.join('; ') : 'no projects assigned yet';
      return '<div class="tenant-banner">&#128736;&#65039; <b>Support Agent</b> \u2014 you only see tickets for <b>your assigned projects</b>: ' + projList + '. Other projects are hidden.</div>';
    }
    if (isClientAdmin(u)) return '<div class="tenant-banner">&#128274; <b>' + esc(company(u.companyId).name) + '</b> only \u2014 you see <b>all tickets for your company</b> (never other companies\u2019).</div>';
    // Client User: show accessible projects
    var accessProjs = userAccessibleProjectIds(u);
    var projNames = accessProjs.map(function (pid) { return project(pid).projectName || pid; });
    var projDisplay = projNames.length ? projNames.map(function (n) { return esc(n); }).join(', ') : 'all projects';
    return '<div class="tenant-banner">&#128274; <b>' + esc(company(u.companyId).name) + '</b> \u2014 projects you have access to: <b>' + projDisplay + '</b>.</div>';
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

    var groups = [];
    DB.companies.filter(function(c) { return c.status === 'Active'; }).forEach(function(c) {
      var cUsers = DB.users.filter(function(u) { return u.companyId === c.id; });
      if (cUsers.length) groups.push({ id: c.id, name: c.name, label: c.name, users: cUsers });
    });

    var tabs = groups.map(function(g, i) {
      return '<button class="login-tab' + (i === 0 ? ' active' : '') + '" onclick="sd.switchLoginTab(\'' + g.id + '\', this)">' +
        esc(g.label) + ' <span class="tab-count">' + g.users.length + '</span></button>';
    }).join('');

    var panels = groups.map(function(g, i) {
      var cards = g.users.map(function(u) {
        var roleLabel = u.role;
        // Show the agent's tier(s) across their project mappings (decision M revised)
        var tierSum = agentTierSummary(u.id);
        if (u.role === 'Support Agent' && tierSum) {
          roleLabel += ' \u00b7 ' + tierSum;
        }
        // For agents, show covered projects grouped by company
        var coveredHtml = '';
        if (u.role === 'Support Agent') {
          var myProjIds = (DB.agentProjects || []).filter(function(ap) { return ap.userId === u.id; }).map(function(ap) { return ap.projectId; });
          if (myProjIds.length) {
            var projTags = myProjIds.map(function(pid) {
              var p = project(pid);
              return '<span class="cover-tag">' + esc(p.projectName || pid) + '</span>';
            });
            coveredHtml = '<span class="p-covers">' + projTags.join(' ') + '</span>';
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
              '<div class="rl-item"><span class="avatar av-admin" style="width:18px;height:18px;font-size:8px;">SA</span> <b>System Admin</b> \u2014 sees everything, manages all</div>' +
              '<div class="rl-item"><span class="avatar av-agent" style="width:18px;height:18px;font-size:8px;">AG</span> <b>Support Agent</b> \u2014 works tickets (L1\u2013L4 tiers)</div>' +
              '<div class="rl-item"><span class="avatar av-cadmin" style="width:18px;height:18px;font-size:8px;">CA</span> <b>Client Admin</b> \u2014 sees all company tickets</div>' +
              '<div class="rl-item"><span class="avatar av-cuser" style="width:18px;height:18px;font-size:8px;">CU</span> <b>Client User</b> \u2014 sees own projects only</div>' +
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
    var showGrab = isAdmin(u) || isAgent(u);
    // Gather visible projects
    var visProjs = [];
    if (isAdmin(u)) {
      visProjs = (DB.projects || []).filter(function (p) { return p.isActive; });
    } else if (isAgent(u)) {
      var apIds = agentProjectIds(u);
      visProjs = (DB.projects || []).filter(function (p) { return p.isActive && apIds.indexOf(p.id) >= 0; });
    } else if (isClientAdmin(u)) {
      visProjs = companyProjects(u.companyId);
    } else {
      var accessIds = userAccessibleProjectIds(u);
      visProjs = (DB.projects || []).filter(function (p) { return p.isActive && accessIds.indexOf(p.id) >= 0; });
    }

    var vts = visibleTickets(u);
    var projCards = visProjs.map(function (p) {
      var c = company(p.companyId);
      var pt = vts.filter(function (t) { return t.projectId === p.id; });
      return {
        id: p.id, name: p.projectName, companyName: c.name || '?', companyId: p.companyId,
        open: pt.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length,
        unassigned: pt.filter(function (t) { return t.assignedTo == null && t.status !== 'Closed'; }).length,
        total: pt.length
      };
    }).sort(function (a, b) { return (b.open - a.open) || (b.unassigned - a.unassigned) || a.name.localeCompare(b.name); });

    var cards = projCards.map(function (p) {
      var second = showGrab ? '<span><b>' + p.unassigned + '</b> unassigned</span>' : '<span><b>' + p.total + '</b> total</span>';
      var manageLink = isAdmin(u) ? '<a class="proj-manage" href="17-company-detail.html?id=' + encodeURIComponent(p.companyId) + '" onclick="event.stopPropagation();" title="Manage company">\u2699\uFE0F</a>' : '';
      return '<div class="card proj-card" data-name="' + esc((p.name + ' ' + p.companyName).toLowerCase()) + '" style="position:relative;">' + manageLink +
        '<a class="proj-card-link" href="04-ticket-list.html?project=' + encodeURIComponent(p.id) + '"><div class="card-bd">' +
        '<div class="proj-ico">' + initials(p.name) + '</div>' +
        '<div class="proj-name">' + esc(p.name) + '</div>' +
        '<div class="muted" style="font-size:11.5px;margin-top:2px;">' + esc(p.companyName) + '</div>' +
        '<div class="proj-stats"><span><b>' + p.open + '</b> open</span>' + second + '</div>' +
        '</div></a></div>';
    }).join('') || '<div class="muted">No projects assigned to you yet. Ask a System Admin to add you to a project.</div>';

    var searchBar = projCards.length > 6
      ? '<div class="proj-toolbar"><div class="search">&#128270; <input id="projq" placeholder="Search projects\u2026" oninput="sd.filterProjects()"></div>' +
        '<span class="muted" id="projcount" style="font-size:12.5px;">' + projCards.length + ' projects</span></div>'
      : '';

    var mine = vts.slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    var rows = mine.slice(0, 6).map(function (t) {
      return '<tr><td><a class="ref" href="05-ticket-detail.html?id=' + t.id + '">' + t.ref + '</a></td>' +
        '<td>' + esc(t.subject) + '</td><td>' + esc(project(t.projectId).projectName || '\u2014') + '</td><td>' + statusBadge(t.status) + '</td><td>' + sevBadge(t.severity) + '</td><td class="muted">' + timeAgo(t.updatedAt) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">No tickets yet.</td></tr>';

    var lead = isClient(u) ? 'Your workspace \u2014 projects you have access to'
      : (isAdmin(u) ? 'All projects across all companies \u2014 pick one to drill into its tickets'
                    : 'Your assigned projects \u2014 pick one to see its tickets');
    var crumb = 'Home';
    var html = pageBar(crumb, 'Welcome back, ' + u.name.split(' ')[0] + ' \u{1F44B}', '') +
      '<div class="content"><p class="muted" style="margin-top:0;">' + lead + '</p>' +
      searchBar +
      '<div class="grid cols-3" id="projgrid">' + cards + '</div>' +
      '<div class="card" style="margin-top:18px;"><div class="card-hd">Recent activity</div>' +
      '<table class="t"><thead><tr><th>Ref</th><th>Subject</th><th>Project</th><th>Status</th><th>Severity</th><th>Updated</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    renderShell(u, 'home', html, tenantBanner(u));
  }

  /* ---------- page: DASHBOARD ---------- */
  function renderDashboard(u) {
    var ts = visibleTickets(u);
    var open = ts.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
    var unassigned = ts.filter(function (t) { return t.assignedTo == null && t.status !== 'Closed'; }).length;
    var inprog = ts.filter(function (t) { return t.status === 'In Progress'; }).length;
    var resolved = ts.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length;

    // FR-32: SLA Compliance %
    var resolvedWithSla = ts.filter(function (t) { return (t.status === 'Resolved' || t.status === 'Closed') && t.slaDueDate; });
    var resolvedOnTime = resolvedWithSla.filter(function (t) {
      var resolveTime = new Date(t.resolvedAt || t.closedAt).getTime();
      return resolveTime <= new Date(t.slaDueDate).getTime();
    }).length;
    var slaCompliancePct = resolvedWithSla.length ? Math.round(resolvedOnTime / resolvedWithSla.length * 100) : 100;

    var ticketsWithFr = ts.filter(function (t) { return t.firstResponseAt && t.createdAt; });
    var avgFrHours = 0;
    if (ticketsWithFr.length) {
      var frTotalMs = ticketsWithFr.reduce(function (sum, t) {
        return sum + (new Date(t.firstResponseAt).getTime() - new Date(t.createdAt).getTime());
      }, 0);
      avgFrHours = Math.round(frTotalMs / ticketsWithFr.length / (1000 * 3600) * 10) / 10;
    }
    var avgFrDisplay = avgFrHours >= 24 ? Math.round(avgFrHours / 24) + 'd' : avgFrHours + 'h';

    var resolvedOrClosed = ts.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; });
    var reopenedCount = resolvedOrClosed.filter(function (t) { return t.reopenCount > 0; }).length;
    var reopenPct = resolvedOrClosed.length ? Math.round(reopenedCount / resolvedOrClosed.length * 100) : 0;

    var ticketsWithCsat = ts.filter(function (t) { return t.csatScore; });
    var csatAvg = 0;
    if (ticketsWithCsat.length) {
      csatAvg = Math.round(ticketsWithCsat.reduce(function (sum, t) { return sum + t.csatScore; }, 0) / ticketsWithCsat.length * 10) / 10;
    }
    var csatDisplay = ticketsWithCsat.length ? csatAvg + '/5' : '\u2014';

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

    // severity breakdown
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

    // Priority breakdown
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
      return { name: a.name, tier: agentTierSummary(a.id) || '\u2014', open: openT, closed: closedT, total: assigned.length };
    });
    var agentRows = agentStats.map(function (a) {
      return '<tr><td><b>' + esc(a.name) + '</b></td><td>' + esc(a.tier) + '</td><td>' + a.open + '</td><td>' + a.closed + '</td><td>' + a.total + '</td></tr>';
    }).join('');

    // company breakdown (admin/agent only)
    var companyCard = '';
    if (isAdmin(u) || isAgent(u)) {
      var companyIds = isAdmin(u)
        ? DB.companies.filter(function (c) { return c.status === 'Active'; }).map(function (c) { return c.id; })
        : agentCompanyIds(u);
      var crows = companyIds.map(function (cid) {
        var c = company(cid);
        var ct = ts.filter(function (t) { return t.companyId === cid; });
        var o = ct.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
        var ip = ct.filter(function (t) { return t.status === 'In Progress'; }).length;
        var rs = ct.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length;
        var br = ct.filter(function (t) { return slaStatus(t) === 'breached'; }).length;
        var cResolved = ct.filter(function (t) { return (t.status === 'Resolved' || t.status === 'Closed') && t.slaDueDate; });
        var cOnTime = cResolved.filter(function (t) {
          var rt = new Date(t.resolvedAt || t.closedAt).getTime();
          return rt <= new Date(t.slaDueDate).getTime();
        }).length;
        var cSlaPct = cResolved.length ? Math.round(cOnTime / cResolved.length * 100) : 100;
        var cSlaCls = cSlaPct >= 90 ? 'sla-pct-green' : (cSlaPct >= 70 ? 'sla-pct-yellow' : 'sla-pct-red');
        return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + o + '</td><td>' + ip + '</td><td>' + rs + '</td><td>' + (br ? '<span class="sla-badge sla-breach">' + br + '</span>' : '0') + '</td><td><span class="' + cSlaCls + '">' + cSlaPct + '%</span></td></tr>';
      }).join('');
      var cardLabel = isAdmin(u) ? 'Tickets by Client Company <span class="sub">System Admin \u2014 cross-tenant view</span>' : 'Tickets by Client';
      companyCard = '<div class="card" style="margin-top:16px;"><div class="card-hd">' + cardLabel + '</div>' +
        '<table class="t"><thead><tr><th>Company</th><th>Open</th><th>In Progress</th><th>Resolved/Closed</th><th>SLA Breach</th><th>SLA Compliance</th></tr></thead><tbody>' + crows + '</tbody></table></div>';
    }

    // Tickets by Project breakdown (admin/agent only)
    var projectCard = '';
    if (isAdmin(u) || isAgent(u)) {
      var visProjs = isAdmin(u)
        ? (DB.projects || []).filter(function (p) { return p.isActive; })
        : (DB.projects || []).filter(function (p) { return p.isActive && agentProjectIds(u).indexOf(p.id) >= 0; });
      var prows = visProjs.map(function (p) {
        var c = company(p.companyId);
        var pt = ts.filter(function (t) { return t.projectId === p.id; });
        var po = pt.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
        var pbr = pt.filter(function (t) { return slaStatus(t) === 'breached'; }).length;
        return '<tr><td><b>' + esc(p.projectName) + '</b></td><td>' + esc(c.name) + '</td><td>' + po + '</td><td>' + pt.length + '</td><td>' + (pbr ? '<span class="sla-badge sla-breach">' + pbr + '</span>' : '0') + '</td></tr>';
      }).join('');
      projectCard = '<div class="card" style="margin-top:16px;"><div class="card-hd">Tickets by Project</div>' +
        '<table class="t"><thead><tr><th>Project</th><th>Company</th><th>Open</th><th>Total</th><th>SLA Breach</th></tr></thead><tbody>' + prows + '</tbody></table></div>';
    }

    // Analytics card (FR-28)
    var analyticsCard =
      '<div class="card" style="margin-top:16px;"><div class="card-hd">Operational Analytics <span class="sub">FR-28</span></div>' +
      '<div class="card-bd"><div class="grid cols-2">' +
        '<div><div class="stat" style="border:0;box-shadow:none;padding:0;"><span class="label">Avg Resolution Time</span><span class="value" style="font-size:24px;">' + avgResDisplay + '</span></div></div>' +
        '<div><div class="stat" style="border:0;box-shadow:none;padding:0;"><span class="label">Resolved Tickets</span><span class="value" style="font-size:24px;">' + resolvedTickets.length + '</span></div></div>' +
      '</div>' +
      '<div style="margin-top:16px;"><div style="font-weight:600;font-size:13px;margin-bottom:8px;">Tickets per Agent</div>' +
      '<table class="t"><thead><tr><th>Agent</th><th>Tier</th><th>Open</th><th>Resolved/Closed</th><th>Total</th></tr></thead><tbody>' + agentRows + '</tbody></table></div>' +
      '</div></div>';

    var html = pageBar('Overview / Dashboard', 'Dashboard', '') +
      '<div class="content"><div class="grid cols-4">' + kpis + '</div>' +
      '<div class="grid cols-4" style="margin-top:16px;">' +
        '<div class="card"><div class="chart-region-hd">Tickets by Status</div><div class="card-bd"><div class="barchart">' + bars + '</div></div></div>' +
        '<div class="card"><div class="chart-region-hd">Tickets by Severity</div><div class="card-bd"><div class="legend" style="flex-direction:column;gap:10px;">' + svlegend + '</div></div></div>' +
        '<div class="card"><div class="chart-region-hd">Tickets by Priority</div><div class="card-bd"><div class="legend" style="flex-direction:column;gap:10px;">' + prlegend + '</div></div></div>' +
        '<div class="card"><div class="chart-region-hd">Tickets by Type <span class="sub">FR-30</span></div><div class="card-bd">' + typeBreakdown + '</div></div>' +
      '</div>' + companyCard + projectCard + analyticsCard + '</div>';
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
    var projectFilter = qs('project');
    if (projectFilter) all = all.filter(function (t) { return t.projectId === projectFilter; });
    var filters = queueFilters(u);
    var f = qs('f') || defaultFilter(u);
    if (!filters.some(function (x) { return x.f === f; })) f = defaultFilter(u);
    var ts = applyQueueFilter(all, u, f).slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    var showCompany = isAdmin(u) || isAgent(u);
    // Project column/facet: staff always; clients only when they can see 2+ projects
    // (single-project users would see a column that always says the same thing).
    var clientProjCount = isClient(u) ? (isClientAdmin(u) ? companyProjects(u.companyId).length : userAccessibleProjectIds(u).length) : 0;
    var showProject = showCompany || clientProjCount > 1;
    var cq = companyId ? '&company=' + encodeURIComponent(companyId) : '';
    var pq = projectFilter ? '&project=' + encodeURIComponent(projectFilter) : '';

    var chips = filters.map(function (x) {
      var n = applyQueueFilter(all, u, x.f).length;
      return '<a class="chip' + (x.f === f ? ' active' : '') + '" href="04-ticket-list.html?f=' + x.f + cq + pq + '">' +
        esc(x.label) + ' <span class="chip-n">' + n + '</span></a>';
    }).join('');
    var projTag = companyId ? '<a class="chip proj" href="04-ticket-list.html?f=' + f + pq + '" title="Clear company filter">&#128193; ' + esc(company(companyId).name) + ' &#10005;</a>' : '';
    var projFilterTag = projectFilter ? '<a class="chip proj" href="04-ticket-list.html?f=' + f + cq + '" title="Clear project filter">&#128194; ' + esc(project(projectFilter).projectName || projectFilter) + ' &#10005;</a>' : '';

    // Build facet data
    var facetDefs = [
      { field: 'status', label: 'Status' },
      { field: 'severity', label: 'Severity' },
      { field: 'priority', label: 'Priority' },
      { field: 'type', label: 'Type' }
    ];
    if (showCompany) facetDefs.push({ field: 'company', label: 'Company' });
    if (showProject) facetDefs.push({ field: 'project', label: 'Project' });
    facetDefs.push({ field: 'assignee', label: 'Assignee' });

    var facetValues = {};
    facetDefs.forEach(function (fd) { facetValues[fd.field] = {}; });
    ts.forEach(function (t) {
      var sv = { status: t.status, severity: t.severity || 'Unset', priority: t.priority || 'Untriaged',
        type: t.ticketType === 'SERVICE_REQUEST' ? 'Service Request' : 'Incident',
        company: company(t.companyId).name || '?',
        project: project(t.projectId).projectName || '?',
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
      var projName = project(t.projectId).projectName || '\u2014';
      return '<tr data-status="' + esc(t.status) + '" data-severity="' + esc(t.severity || 'Unset') + '" data-priority="' + esc(t.priority || 'Untriaged') + '" data-type="' + esc(typeLabel) + '" data-company="' + esc(company(t.companyId).name) + '" data-project="' + esc(projName) + '" data-assignee="' + esc(asgAttr) + '">' +
        '<td><a class="ref" href="05-ticket-detail.html?id=' + t.id + '">' + t.ref + '</a></td>' +
        '<td>' + esc(t.subject) + '</td>' +
        '<td>' + typeBadge(t.ticketType) + '</td>' +
        (showCompany ? '<td>' + esc(company(t.companyId).name) + '</td>' : '') +
        (showProject ? '<td>' + esc(projName) + '</td>' : '') +
        '<td>' + sevBadge(t.severity) + '</td>' +
        '<td>' + prioBadge(t.priority) + '</td>' +
        '<td>' + statusBadge(t.status) + '</td>' +
        '<td>' + asgName + '</td>' +
        '<td class="muted">' + ageDays(t.createdAt) + '</td>' +
        '<td>' + slaBadge(t) + '</td>' +
        '</tr>';
    }).join('');
    if (!rows) {
      var colSpan = 9 + (showCompany ? 1 : 0) + (showProject ? 1 : 0);
      rows = '<tr><td colspan="' + colSpan + '" class="muted">No tickets visible to you.</td></tr>';
    }
    var actions = canCreate(u) ? '<a class="btn btn-primary" href="06-create-ticket.html' + (projectFilter ? '?project=' + encodeURIComponent(projectFilter) : '') + '">&#10133; New Ticket</a>' : '';
    window._facetState = {};

    var html = pageBar('Tickets / Queue', isClient(u) ? 'My Tickets' : 'Ticket Queue', actions) +
      '<div class="content"><div class="card" style="overflow:hidden;">' +
      '<div class="toolbar">' + chips + projTag + projFilterTag + '</div>' +
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
            (showProject ? '<th class="sortable">Project</th>' : '') +
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

    var assignBtn = '';
    if (canAssign(u, t)) {
      assignBtn = '<a class="btn" href="07-assign.html?id=' + t.id + '">&#128100; ' + (t.assignedTo ? 'Reassign' : 'Assign') + '</a>';
    }
    var selfAssignBtn = '';
    if (canSelfAssign(u, t)) {
      selfAssignBtn = '<button class="btn btn-primary" onclick="sd.selfAssign(\'' + t.id + '\')">&#9997; Self-Assign</button>';
    }
    var escalateBtn = '';
    if (canEscalate(u, t)) {
      escalateBtn = '<button class="btn btn-escalate" onclick="sd.showEscalate(\'' + t.id + '\')">&#9888; Escalate</button>';
    }
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
    var sla = slaTarget(t.projectId, t.severity);
    var slaInfo = sla ? 'SLA: ' + sla.resolutionDays + 'd resolution' : '';
    var actionsHtml = assignBtn + selfAssignBtn + escalateBtn + prioBtn + trs +
      '<a class="btn btn-primary" href="08-add-comment.html?id=' + t.id + '">&#128172; Comment</a>';

    // CSAT section (FR-27)
    var csatSection = '';
    if (t.status === 'Closed') {
      var canRate = isClient(u) && t.companyId === u.companyId && u.id === t.createdBy && !t.csatScore;
      csatSection = '<div class="field" style="margin-top:12px;"><label>Customer Satisfaction (CSAT)</label><div>' +
        csatStars(t.csatScore, canRate) + '</div></div>';
    }

    var main =
      pageBar('<a href="04-ticket-list.html">Queue</a> / ' + t.ref, t.subject, actionsHtml) +
      '<div class="content" style="display:grid;grid-template-columns:1fr 300px;gap:16px;">' +
        '<div><div class="card"><div class="card-hd">' + t.ref + ' ' + typeBadge(t.ticketType) + ' ' + statusBadge(t.status) + ' ' + sevBadge(t.severity) + ' ' + prioBadge(t.priority) + ' ' + slaBadge(t) + '</div>' +
          '<div class="card-bd"><p style="margin-top:0;">' + esc(t.description) + '</p>' +
          inlineAttachHtml(ticketAttachments(t.id).filter(function (a) { return !a.commentId; })) +
          '<div class="grid cols-4" style="gap:8px;margin-top:8px;">' +
            '<div><div class="muted" style="font-size:11.5px;">Category</div><div>' + esc(category(t.categoryId).name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Raised by</div><div>' + esc(cu.name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Company</div><div>' + esc(company(t.companyId).name) + '</div></div>' +
            '<div><div class="muted" style="font-size:11.5px;">Project</div><div>' + esc(project(t.projectId).projectName || '\u2014') + '</div></div>' +
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
            '<div class="field"><label>Project</label><input value="' + esc(project(t.projectId).projectName || '\u2014') + '" disabled></div>' +
            '<div class="field"><label>Department</label><input value="' + esc(department(t.departmentId).name || '\u2014') + '" disabled></div>' +
            '<div class="field"><label>SLA Due</label><input value="' + (t.slaDueDate ? new Date(t.slaDueDate).toLocaleDateString() : '\u2014') + '" disabled></div>' +
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

  var CREATE_SEC_STYLE = 'font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;';
  function renderCreate(u) {
    if (!canCreate(u)) { renderShell(u, 'queue', notFound('Only client users can raise tickets.'), ''); return; }
    pendingFiles = [];
    // Project selector for the user's company
    var userProjs = companyProjects(u.companyId);
    if (!isClientAdmin(u)) {
      var accessIds = userAccessibleProjectIds(u);
      userProjs = userProjs.filter(function (p) { return accessIds.indexOf(p.id) >= 0; });
    }
    // Never guess the project: pre-fill only from explicit ?project= context
    // (dashboard tile / filtered list) or when there is exactly one choice.
    // With 2+ projects and no context, force an explicit pick.
    var ctxProj = qs('project');
    if (ctxProj && !userProjs.some(function (p) { return p.id === ctxProj; })) ctxProj = null;
    // Single accessible project: no question at all — auto-select and lock (amends "no default").
    var singleProj = userProjs.length === 1;
    var defaultProjId = ctxProj || (singleProj ? userProjs[0].id : null);
    var projOpts = (defaultProjId ? '' : '<option value="" selected disabled>— Select —</option>') +
      userProjs.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === defaultProjId ? ' selected' : '') + '>' + esc(p.projectName) + '</option>';
      }).join('');
    // Plain-language picker: the project's description doubles as live feedback
    // (the JSM/Zendesk pattern: routing choice first, form reacts to it).
    var projField = singleProj
      ? '<div class="field full"><label>Project</label><select id="createProject" disabled>' + projOpts + '</select>' +
        '<span class="hint">' + esc(userProjs[0].description || '') + ' &mdash; your only project, so this ticket is filed there automatically.</span></div>'
      : '<div class="field full"><label>Project <span class="req">*</span></label><select id="createProject" onchange="sd.onCreateProjectChange()">' + projOpts + '</select>' +
        '<span class="hint" id="projHint">' + (defaultProjId ? esc(project(defaultProjId).description || '') : 'Pick the system or service this ticket concerns &mdash; it decides which support team, categories and SLA apply.') + '</span></div>';

    // Categories filtered by project; empty until a project is chosen
    var cats = defaultProjId ? DB.categories.filter(function (c) {
      if (c.status !== 'Active') return false;
      if (c.projectId && c.projectId !== defaultProjId) return false;
      if (c.companyId && c.companyId !== u.companyId) return false;
      return true;
    }).map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('')
      : '<option value="" selected disabled>— Select a project first —</option>';

    var sevs = (DB.severities || ['Critical', 'Major', 'Minor', 'Low']).map(function (s) {
      return '<option' + (s === 'Minor' ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    var typeOpts = (DB.ticketTypes || ['INCIDENT', 'SERVICE_REQUEST']).map(function (t) {
      return '<option value="' + t + '"' + (t === 'INCIDENT' ? ' selected' : '') + '>' + (t === 'SERVICE_REQUEST' ? 'Service Request' : 'Incident') + '</option>';
    }).join('');
    // Agent LOV: filter by agents covering the selected project (L1 only for clients)
    var agentPool = DB.users.filter(function (x) {
      return x.role === 'Support Agent' && agentCoversProject(x.id, defaultProjId) && (isClientAdmin(u) || agentTier(x.id, defaultProjId) === 'L1');
    });
    var agentOpts = '<option value="">\u2014 Unassigned \u2014</option>' + agentPool.map(function (a) {
      var load = DB.tickets.filter(function (x) { return x.assignedTo === a.id && x.status !== 'Closed'; }).length;
      var aTier = agentTier(a.id, defaultProjId);
      return '<option value="' + a.id + '">' + esc(a.name) + (aTier ? ' [' + aTier + ']' : '') + ' \u00b7 ' + load + ' open</option>';
    }).join('');
    var dept = department(u.departmentId);
    var bannerProj = defaultProjId ? ', project <b>' + esc(project(defaultProjId).projectName || '') + '</b>'
      : (userProjs.length > 1 ? ' — <b>choose a project below</b>' : '');
    var modal = '<div class="modal lg"><div class="m-hd"><h2>Raise a Ticket</h2><span class="x" onclick="location.href=\'04-ticket-list.html\'">&#10005;</span></div>' +
      '<div class="m-bd"><div class="tenant-banner" style="border-radius:4px;margin-bottom:16px;">&#128274; Filed under <b>' + esc(company(u.companyId).name) + '</b>' + (dept.name ? ' / <b>' + esc(dept.name) + '</b>' : '') + '<span id="bannerProj">' + bannerProj + '</span>.</div>' +
      '<div class="form-grid cols-2">' +
        '<div class="field full" style="margin-bottom:-8px;"><span style="' + CREATE_SEC_STYLE + '">1 &middot; Project &amp; type</span></div>' +
        projField +
        '<div class="field"><label>Ticket Type <span class="req">*</span></label><select id="ticketType">' + typeOpts + '</select>' +
          '<span class="hint">Incident = something is broken. Service Request = a standard request.</span></div>' +
        '<div class="field"><label>Category <span class="req">*</span></label><select id="cat">' + cats + '</select></div>' +
        '<div class="field full" style="margin-bottom:-8px;margin-top:4px;"><span style="' + CREATE_SEC_STYLE + '">2 &middot; Issue details</span></div>' +
        '<div class="field full"><label>Subject <span class="req">*</span></label><input id="subject" placeholder="Short summary"></div>' +
        '<div class="field full"><label>Description <span class="req">*</span></label><textarea id="desc" placeholder="Describe the issue\u2026"></textarea></div>' +
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
    // Decision J: For clients, only L1 agents covering this ticket's project
    var pool;
    if (isClient(u)) {
      pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && agentCoversProject(x.id, t.projectId) && agentTier(x.id, t.projectId) === 'L1'; });
    } else {
      pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && agentCoversProject(x.id, t.projectId); });
      if (!pool.length) pool = DB.users.filter(function (x) { return x.role === 'Support Agent'; });
    }
    var agents = pool.map(function (a) {
      var load = DB.tickets.filter(function (x) { return x.assignedTo === a.id && x.status !== 'Closed'; }).length;
      var aTier = agentTier(a.id, t.projectId);
      return '<option value="' + a.id + '"' + (t.assignedTo === a.id ? ' selected' : '') + '>' + esc(a.name) + (aTier ? ' [' + aTier + ']' : '') + ' &middot; ' + load + ' open</option>';
    }).join('');
    var modal = '<div class="modal"><div class="m-hd"><h2>Assign &middot; ' + t.ref + '</h2><span class="x" onclick="location.href=\'05-ticket-detail.html?id=' + t.id + '\'">&#10005;</span></div>' +
      '<div class="m-bd"><p class="muted mt-0">Put an agent on <b>' + esc(t.subject) + '</b> (' + esc(company(t.companyId).name) + ' / ' + esc(project(t.projectId).projectName || '') + ', ' + esc(t.severity) + ').</p>' +
      (isClient(u) ? '<div class="tenant-banner" style="border-radius:4px;margin-bottom:12px;">&#128274; Only agents assigned to project <b>' + esc(project(t.projectId).projectName || '') + '</b> are shown.</div>' : '') +
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
      var projCount = companyProjects(c.id).length;
      return '<tr><td><span class="ig-row-check"></span></td><td><b>' + esc(c.name) + '</b></td>' +
        '<td>' + projCount + '</td><td>' + tk + '</td><td>' + us + '</td>' +
        '<td><span class="' + (c.status === 'Active' ? 'tag-active' : 'tag-inactive') + '">&#9679; ' + c.status + '</span></td>' +
        '<td><a class="btn btn-sm btn-primary" href="17-company-detail.html?id=' + c.id + '">&#9881; Manage</a> ' +
        '<button class="btn btn-sm" onclick="sd.showEditCompany(\'' + c.id + '\')">&#9998; Edit</button></td></tr>';
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
      '<table class="t ig-table" id="ig-companies"><thead><tr><th style="width:30px;"></th><th class="sortable">Company</th><th class="sortable">Projects</th><th class="sortable">Tickets</th><th class="sortable">Users</th><th class="sortable">Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 9 \u2014 APEX Interactive Grid. FR-5: create/edit/deactivate companies.</p></div>';
    renderShell(u, 'companies', html, tenantBanner(u));
  }

  /* ---------- page: PROJECTS (Page 11 - projects) ---------- */
  function renderProjects(u) {
    var admin = isAdmin(u);
    var agentScope = isAgent(u) ? agentProjectIds(u) : null;
    var userScope = (isClient(u) && !isClientAdmin(u)) ? userAccessibleProjectIds(u) : null;
    var allProjects = (DB.projects || []).filter(function (p) {
      if (admin) return true;
      if (agentScope) return agentScope.indexOf(p.id) >= 0;
      if (userScope) return userScope.indexOf(p.id) >= 0;
      return p.companyId === u.companyId; // Client Admin
    });
    var showCompany = admin || isAgent(u); // agents span companies
    var companySelect = '<select id="proj-company-filter" class="ig-filter-select" onchange="sd.filterProjectsByCompany(this.value)">' +
      '<option value="all">All Companies</option>' +
      DB.companies.filter(function (c) { return c.status === 'Active'; }).map(function (c) {
        var count = allProjects.filter(function (p) { return p.companyId === c.id; }).length;
        return '<option value="' + c.id + '">' + esc(c.name) + ' (' + count + ')</option>';
      }).join('') + '</select>';

    var rows = allProjects.map(function (p) {
      var c = company(p.companyId);
      var tk = DB.tickets.filter(function (t) { return t.projectId === p.id; }).length;
      var agCount = (DB.agentProjects || []).filter(function (ap) { return ap.projectId === p.id; }).length;
      var statusClass = p.isActive ? 'tag-active' : 'tag-inactive';
      var visBadge = (p.visibility || 'OPEN') === 'RESTRICTED'
        ? '<span class="tag-inactive" title="Invitation-only (decision Q)">&#128274; Restricted</span>'
        : '<span class="tag-active" title="Visible to the whole company">&#127758; Open</span>';
      var actions = admin
        ? '<a class="btn btn-sm btn-primary" href="19-project-detail.html?id=' + p.id + '">&#9881; Manage</a> ' +
          '<button class="btn btn-sm" onclick="sd.showEditProject(\'' + p.id + '\')">&#9998; Edit</button>'
        : '<a class="btn btn-sm btn-primary" href="19-project-detail.html?id=' + p.id + '">&#128065; View</a>';
      return '<tr data-proj-company="' + esc(p.companyId) + '"><td><span class="ig-row-check"></span></td>' +
        '<td><b>' + esc(p.projectName) + '</b></td><td>' + esc(p.projectKey) + '</td>' +
        (showCompany ? '<td>' + esc(c.name) + '</td>' : '') +
        '<td class="muted" style="font-size:12px;">' + esc(p.description || '') + '</td>' +
        '<td>' + visBadge + '</td>' +
        '<td><span class="' + statusClass + '">&#9679; ' + (p.isActive ? 'Active' : 'Inactive') + '</span></td>' +
        '<td>' + tk + '</td><td>' + agCount + teamCoverageBadges(p.id) + '</td>' +
        '<td>' + actions + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="' + (showCompany ? 10 : 9) + '" class="muted">No projects yet.</td></tr>';
    var html = pageBar('Administration / Projects', 'Projects', '') +
      '<div class="content"><div class="card" style="overflow:hidden;" id="ig-projects-wrap">' +
      '<div class="ig-toolbar">' +
        (admin ? '<button class="ir-btn primary" onclick="sd.showAddProject()">+ Add Row</button>' : '') +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.igSearch(\'ig-projects\')"></div>' +
        (admin ? '<div style="margin-left:8px;display:flex;align-items:center;gap:6px;"><label style="font-size:12px;white-space:nowrap;">Company:</label>' + companySelect + '</div>' : '') +
        '<div class="ir-actions" style="margin-left:auto;">' +
          '<button class="ir-btn">Actions &#9662;</button>' +
          '<span class="ir-count" id="projects-row-count">' + allProjects.length + ' rows</span>' +
        '</div>' +
      '</div>' +
      '<table class="t ig-table" id="ig-projects"><thead><tr><th style="width:30px;"></th><th class="sortable">Project Name</th><th class="sortable">Key</th>' +
      (showCompany ? '<th class="sortable">Company</th>' : '') +
      '<th>Description</th><th class="sortable">Visibility</th><th class="sortable">Status</th><th class="sortable">Tickets</th><th class="sortable">Agents</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (admin
        ? '<p class="muted" style="font-size:11.5px;margin-top:12px;">Decision O \u2014 PROJECTS layer between COMPANIES and TICKETS. Decision Q \u2014 visibility: Open (whole company) vs Restricted (invitation-only). Manage opens the Project Detail hub (team, SLA, categories, access).</p>'
        : (isAgent(u)
          ? '<p class="muted" style="font-size:11.5px;margin-top:12px;">Your assigned projects (AGENT_PROJECTS, decision I) \u2014 View opens the read-only project hub: team, SLA targets, categories, access.</p>'
          : (isClientAdmin(u)
            ? '<p class="muted" style="font-size:11.5px;margin-top:12px;">Your company\u2019s service engagements. View opens the project hub \u2014 support team, SLA targets and categories are read-only; you manage <b>invitations</b> for Restricted projects there (decision Q).</p>'
            : '<p class="muted" style="font-size:11.5px;margin-top:12px;">Projects you can access (decision Q: Open projects + Restricted ones you\u2019re invited to) \u2014 View opens the read-only project hub.</p>'))) +
      '</div>';
    renderShell(u, 'projects', html, tenantBanner(u));
  }

  function renderUsers(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var ROLE_LABELS = { SYSTEM_ADMIN: 'System Admin', SUPPORT_AGENT: 'Support Agent', CLIENT_ADMIN: 'Client Admin', CLIENT_USER: 'Client User' };
    var rows = DB.users.map(function (x) {
      var dept = department(x.departmentId);
      var statusClass = (x.status || 'Active') === 'Active' ? 'tag-active' : 'tag-inactive';
      var lastLoginStr = x.lastLogin ? new Date(x.lastLogin).toLocaleDateString() : '<span class="muted">Never</span>';
      // Decision P: role chips \u2014 all roles held, landing role first/bold.
      // Decision Q: provider users always include CLIENT_USER (auto-granted).
      var held = (DB.userRoles || []).filter(function (r) { return r.userId === x.id; })
        .map(function (r) { return ROLE_LABELS[r.role] || r.role; });
      if (!held.length) held = [x.role];
      var roleChips = '<span class="role-pill">' + esc(x.role) + '</span>' +
        held.filter(function (r) { return r !== x.role; }).map(function (r) {
          return ' <span class="role-pill" style="opacity:.65;" title="Also holds this role (decision P) \u2014 switchable in the nav bar">' + esc(r) + '</span>';
        }).join('');
      return '<tr><td><span class="ig-row-check"></span></td><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.email) + '</td><td>' + roleChips + '</td>' +
        '<td>' + esc(company(x.companyId).name) + '</td>' +
        '<td>' + (dept.name ? esc(dept.name) : '<span class="muted">\u2014</span>') + '</td>' +
        '<td><span class="' + statusClass + '">&#9679; ' + (x.status || 'Active') + '</span></td>' +
        '<td>' + lastLoginStr + '</td>' +
        '<td><button class="btn btn-sm" onclick="sd.showEditUser(\'' + x.id + '\')">&#9998; Edit</button> ' +
        '<button class="btn btn-sm" onclick="sd.resetPassword(\'' + x.id + '\')" title="Reset the APEX account password">&#128273; Reset</button></td></tr>';
    }).join('');
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
      '<table class="t ig-table" id="ig-users"><thead><tr><th style="width:30px;"></th><th class="sortable">Name</th><th class="sortable">Email</th><th class="sortable">Role</th><th class="sortable">Company</th><th class="sortable">Dept</th><th class="sortable">Status</th><th class="sortable">Last Login</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 10 \u2014 APEX Interactive Grid. FR-6: create/edit/deactivate users (never delete \u2014 history keeps its authors) + password reset. Role chips = all roles held (decision P); provider users always include Client User (decision Q auto-grant). ISO \u00a76.6: access lifecycle.</p></div>';
    renderShell(u, 'users', html, tenantBanner(u));
  }
  function renderCategories(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var rows = DB.categories.map(function (c) {
      var n = DB.tickets.filter(function (t) { return t.categoryId === c.id && t.status !== 'Closed'; }).length;
      var scope = c.companyId ? esc(company(c.companyId).name) : '<span class="muted">Global</span>';
      var projScope = c.projectId ? '<b>' + esc(project(c.projectId).projectKey || '') + '</b> ' + esc(project(c.projectId).projectName || c.projectId) : '<span class="muted">All</span>';
      var statusClass = (c.status || 'Active') === 'Active' ? 'tag-active' : 'tag-inactive';
      return '<tr data-cat-company="' + esc(c.companyId || '') + '" data-cat-project="' + esc(c.projectId || '') + '"><td><b>' + esc(c.name) + '</b></td><td>' + scope + '</td><td>' + projScope + '</td><td class="muted" style="font-size:12px;">' + esc(c.description || '') + '</td><td>' + n + '</td>' +
        '<td><span class="' + statusClass + '">&#9679; ' + (c.status || 'Active') + '</span></td>' +
        '<td><button class="btn btn-sm" onclick="sd.showEditCategory(\'' + c.id + '\')">&#9998; Edit</button></td></tr>';
    }).join('');
    var catCompanySelect = '<select id="cats-company-filter" class="ig-filter-select" onchange="sd.filterCatsByCompany(this.value)">' +
      '<option value="all">All Companies</option>' +
      DB.companies.filter(function (c2) { return c2.status === 'Active'; }).map(function (c2) {
        return '<option value="' + c2.id + '">' + esc(c2.name) + '</option>';
      }).join('') + '</select>';
    var catProjectSelect = '<select id="cats-project-filter" class="ig-filter-select" onchange="sd.applyCatFilter()">' +
      '<option value="all">All Projects</option>' +
      (DB.projects || []).filter(function (p) { return p.isActive; }).map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.projectKey) + ' — ' + esc(p.projectName) + '</option>';
      }).join('') + '</select>';
    var html = pageBar('Administration / Categories', 'Categories, Severities & SLA', '') +
      '<div class="content"><div class="grid cols-3">' +
      '<div class="card" style="overflow:hidden;grid-column:span 2;" id="ig-cats-wrap"><div class="card-hd">Categories</div>' +
      '<div class="ig-toolbar">' +
        '<button class="ir-btn primary" onclick="sd.showAddCategory()">+ Add Row</button>' +
        '<button class="ir-btn">Actions &#9662;</button>' +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.igSearch(\'ig-cats\')"></div>' +
        '<div style="margin-left:8px;display:flex;align-items:center;gap:6px;" title="Project filter shows the effective set: project-specific + company-wide + global categories"><label for="cats-company-filter" style="font-size:12px;white-space:nowrap;">Company:</label>' + catCompanySelect +
        '<label for="cats-project-filter" style="font-size:12px;white-space:nowrap;">Project:</label>' + catProjectSelect + '</div>' +
        '<span class="ir-count" id="cats-row-count" style="margin-left:auto;">' + DB.categories.length + ' rows</span>' +
      '</div>' +
      '<table class="t" id="ig-cats"><thead><tr><th class="sortable">Category</th><th class="sortable">Company</th><th class="sortable">Project</th><th>Description</th><th class="sortable">Open</th><th class="sortable">Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div><div class="card" style="overflow:hidden;"><div class="card-hd">Severities (client-set)</div><table class="t"><thead><tr><th>Severity</th><th>Badge</th></tr></thead><tbody>' +
        (DB.severities || []).map(function (s) { return '<tr><td>' + s + '</td><td>' + sevBadge(s) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<div class="card-hd" style="border-top:1px solid var(--c-border-lt);margin-top:0;">Priorities (support-set)</div><table class="t"><thead><tr><th>Priority</th><th>Badge</th></tr></thead><tbody>' +
        (DB.priorities || []).map(function (p) { return '<tr><td>' + p + '</td><td>' + prioBadge(p) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '</div>' +
      '</div><p class="muted" style="font-size:11.5px;margin-top:12px;">Page 11 \u2014 FR-7: categories (hybrid model: global + company/project-specific).</p></div>';
    renderShell(u, 'categories', html, tenantBanner(u));
  }

  /* ---------- page: SLA TARGETS (Page 13) ---------- */
  function renderSlaTargets(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var allProjects = (DB.projects || []).filter(function (p) { return p.isActive; });

    // --- Section 1: named policies (the editing surface \u2014 a handful, regardless of project count) ---
    var policyCards = (DB.slaPolicies || []).map(function (sp) {
      var usedBy = slaPolicyProjects(sp.id);
      var approver = sp.approvedBy ? user(sp.approvedBy) : null;
      var rows = (sp.targets || []).map(function (t) {
        return '<tr><td>' + sevBadge(t.severity) + '</td><td>' + t.responseHours + 'h</td><td>' + t.resolutionDays + 'd</td><td>' + (t.escalationPct || 80) + '%</td></tr>';
      }).join('');
      var govHtml = '<div style="padding:8px 12px;font-size:11.5px;color:#666;border-top:1px solid var(--c-border-lt);display:flex;gap:16px;flex-wrap:wrap;">' +
        '<span>Effective: <b>' + esc(sp.effectiveFrom || '\u2014') + '</b></span>' +
        '<span>Approved by: <b>' + (approver ? esc(approver.name) : '\u2014') + '</b></span>' +
        (sp.notes ? '<span>Notes: ' + esc(sp.notes) + '</span>' : '') +
        '</div>';
      return '<div class="card" style="overflow:hidden;">' +
        '<div class="card-hd"><span style="display:flex;align-items:center;gap:8px;">' + esc(sp.name) +
        (sp.isDefault ? ' <span class="tag-active" title="Applies to projects with no policy assigned">Default</span>' : '') +
        ' <span class="muted" style="font-size:12px;font-weight:400;" title="Blast radius: editing this policy changes targets for all these projects">used by ' + usedBy.length + ' project' + (usedBy.length === 1 ? '' : 's') + '</span></span>' +
        '<button class="btn btn-sm" style="float:right;margin:-4px 0;" onclick="sd.showEditSlaPolicy(\'' + sp.id + '\')">&#9998; Edit</button></div>' +
        '<div style="padding:6px 12px 0;font-size:12px;color:#666;">' + esc(sp.description || '') + '</div>' +
        '<table class="t"><thead><tr><th>Severity</th><th>Response Time</th><th>Resolution Time</th><th>Escalation %</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        govHtml + '</div>';
    }).join('');

    // --- Section 2: read-only assignment rollup (which project runs on which policy) ---
    var companySelect = '<select id="sla-company-filter" class="ig-filter-select" onchange="sd.filterSlaByCompany(this.value)">' +
      '<option value="all">All Companies</option>' +
      DB.companies.filter(function (c) { return c.status === 'Active'; }).map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('') + '</select>';
    var assignRows = allProjects.map(function (p) {
      var c = company(p.companyId);
      var pol = slaPolicyFor(p.id);
      var explicit = !!p.slaPolicyId;
      var projTickets = DB.tickets.filter(function (t) { return t.projectId === p.id; });
      var openCount = projTickets.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
      var breachedCount = projTickets.filter(function (t) { return slaStatus(t) === 'breached'; }).length;
      return '<tr data-sla-company="' + esc(p.companyId) + '">' +
        '<td><b>' + esc(p.projectKey) + '</b> <span class="muted">' + esc(p.projectName) + '</span></td>' +
        '<td>' + esc(c.name || '') + '</td>' +
        '<td>' + (pol ? esc(pol.name) : '<span class="tag-inactive">&#9888; none</span>') +
        (pol && !explicit ? ' <span class="muted" style="font-size:11px;" title="No policy assigned \u2014 default policy applies">(default)</span>' : '') + '</td>' +
        '<td>' + openCount + '</td>' +
        '<td>' + (breachedCount ? '<span style="color:#b91c1c;">' + breachedCount + '</span>' : '0') + '</td>' +
        '<td><a class="btn btn-sm" href="19-project-detail.html?id=' + p.id + '" title="Policy assignment is changed on the project\u2019s SLA tab">&#9881; Manage</a></td></tr>';
    }).join('');

    var html = pageBar('Administration / SLA Policies', 'SLA Policies', '') +
      '<div class="content">' +
      '<div class="card" style="margin-bottom:16px;"><div class="card-bd">' +
      '<p style="margin:0;font-size:13px;"><b>Named policies, assigned to projects</b> (industry pattern \u2014 service tiers). ' +
      'Targets are defined once per policy; each project is assigned a policy on its SLA tab. ' +
      'Response = max time to first agent response \u00b7 Resolution = max time to resolve \u00b7 Escalation = % of SLA elapsed before auto-escalation (FR-35). ' +
      'Projects with no assignment use the <b>Default</b> policy.</p></div></div>' +
      '<div class="grid cols-2" style="margin-bottom:16px;">' + policyCards + '</div>' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd"><span>Project Assignments <span class="muted" style="font-size:12px;font-weight:400;">read-only \u2014 edit on each project\u2019s SLA tab</span></span></div>' +
      '<div class="ig-toolbar"><div style="display:flex;align-items:center;gap:6px;"><label for="sla-company-filter" style="font-size:12px;white-space:nowrap;">Company:</label>' + companySelect + '</div>' +
      '<span class="ir-count" style="margin-left:auto;">' + allProjects.length + ' projects</span></div>' +
      '<table class="t" id="sla-assign"><thead><tr><th>Project</th><th>Company</th><th>SLA Policy</th><th>Open</th><th>Breached</th><th>Actions</th></tr></thead><tbody>' + assignRows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 13 \u2014 System Admin only. FR-23: SLA per severity via named policies per project. ISO \u00a78.6.3: SLA governance. Pattern study 2026-07-03: Zendesk SLA policies / Autotask SLA templates / ServiceNow SLA definitions.</p></div>';
    renderShell(u, 'sla', html, tenantBanner(u));
  }

  /* ---------- page: AGENT-PROJECT MAPPING (Page 14) ----------
     Reshaped (admin-console spec 2026-07-03): grouped-by-project team cards with
     agent chips \u2014 makes the L1 gate and tier coverage visible per project.
     Same AGENT_PROJECTS table as the Project Detail "Support Team" tab (two doors). */
  function renderAgentProjects(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var activeProjects = (DB.projects || []).filter(function (p) { return p.isActive; });

    var companySelect = '<select id="ap-company-filter" class="ig-filter-select" onchange="sd.filterAgentMapByCompany(this.value)">' +
      '<option value="all">All Companies</option>' +
      DB.companies.filter(function (c) { return c.status === 'Active'; }).map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('') + '</select>';
    var apProjectSelect = '<select id="ap-project-filter" class="ig-filter-select" onchange="sd.applyAgentMapFilter()">' +
      '<option value="all">All Projects</option>' +
      activeProjects.map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.projectKey) + ' — ' + esc(p.projectName) + '</option>';
      }).join('') + '</select>';

    var issuesByProject = {};
    activeProjects.forEach(function (p) { issuesByProject[p.id] = projectCoverageIssues(p.id); });
    var attentionN = activeProjects.filter(function (p) { return issuesByProject[p.id].length > 0; }).length;
    function issueCount(key) {
      return activeProjects.filter(function (p) { return issuesByProject[p.id].indexOf(key) >= 0; }).length;
    }
    // Exceptions-first: open on the gaps; fall back to All when coverage is clean.
    var initialView = attentionN ? 'attention' : 'all';

    var cards = activeProjects.map(function (p) {
      var c = company(p.companyId);
      var team = projectTeam(p.id);
      var chips = team.map(function (a) {
        var openN = agentOpenCountInProject(a.id, p.id);
        return '<span class="cover-tag" title="' + esc(a.email) + ' \u2014 ' + openN + ' open ticket' + (openN === 1 ? '' : 's') + ' here">' +
          esc(a.name) + ' <b>(' + (a.tier || '\u2014') + ')</b></span>';
      }).join(' ');
      if (!chips) chips = '<span class="muted">No agents mapped</span>';
      return '<div class="card" data-ap-company="' + esc(p.companyId) + '" data-ap-project="' + esc(p.id) + '" data-ap-issues="' + issuesByProject[p.id].join(' ') + '" style="margin-bottom:12px;overflow:hidden;">' +
        '<div class="card-hd"><span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        esc(p.projectName) + ' <span class="muted" style="font-size:12px;font-weight:400;">' + esc(c.name || '') + ' &middot; ' + esc(p.projectKey) + '</span>' +
        teamCoverageBadges(p.id) + '</span>' +
        '<span style="float:right;display:flex;gap:8px;align-items:center;">' +
        '<a class="btn btn-sm" href="19-project-detail.html?id=' + p.id + '" title="Team changes happen on the project&rsquo;s Support Team tab — the project context is fixed there, so no wrong-company mistakes">&#9881; Manage Team</a></span></div>' +
        '<div class="card-bd" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' + chips + '</div>' +
        '</div>';
    }).join('');
    if (!cards) cards = '<p class="muted">No active projects.</p>';

    // Coverage KPI strip \u2014 each tile is a one-click filter on the card list below.
    var kpiTiles = [
      { view: 'all', n: activeProjects.length, label: 'Active projects', icon: '&#128193;', bg: '#e8f1fb', fg: '#045aa3', tip: 'Show every active project' },
      { view: 'no-l1', n: issueCount('no-l1'), label: 'Missing L1', icon: '&#9888;', bg: '#fde8e8', fg: '#b91c1c', tip: 'Clients can assign L1 agents only \u2014 these projects are broken for clients (FR-10)' },
      { view: 'no-agents', n: issueCount('no-agents'), label: 'No agents mapped', icon: '&#128683;', bg: '#fde8e8', fg: '#b91c1c', tip: 'Tickets in these projects have nobody to work them' },
      { view: 'no-l2', n: issueCount('no-l2'), label: 'No L2+ \u2014 escalation dead-end', icon: '&#128257;', bg: '#fdf6b2', fg: '#92740a', tip: 'Auto-escalation has no higher tier to go to (FR-35)' },
      { view: 'single', n: issueCount('single'), label: 'Single agent', icon: '&#128100;', bg: '#fdf6b2', fg: '#92740a', tip: 'One agent covers the whole project \u2014 single point of failure' }
    ].map(function (k) {
      var valStyle = (k.n && k.view !== 'all') ? ' style="color:' + k.fg + ';"' : '';
      return '<div class="kpi-badge ap-kpi" data-ap-view="' + k.view + '" onclick="sd.setAgentMapView(\'' + k.view + '\')" title="' + k.tip + '" style="flex:1;min-width:140px;max-width:280px;">' +
        '<div class="kpi-icon" style="background:' + k.bg + ';color:' + k.fg + ';">' + k.icon + '</div>' +
        '<div class="kpi-body"><div class="kpi-value"' + valStyle + '>' + k.n + '</div><div class="kpi-label">' + k.label + '</div></div></div>';
    }).join('');

    var viewToggle = '<div style="display:flex;gap:4px;">' +
      '<button class="btn btn-sm ap-view-btn" data-ap-view="attention" onclick="sd.setAgentMapView(\'attention\')">&#9888; Needs attention (' + attentionN + ')</button>' +
      '<button class="btn btn-sm ap-view-btn" data-ap-view="all" onclick="sd.setAgentMapView(\'all\')">All projects (' + activeProjects.length + ')</button></div>';

    var html = pageBar('Administration / Agent Mapping', 'Agent-Project Mapping', '') +
      '<div class="content">' +
      '<div class="card" style="margin-bottom:16px;"><div class="card-bd">' +
      '<p style="margin:0;font-size:13px;"><b>Who covers what</b> \u2014 read-only coverage overview, exceptions first: ' +
      'projects with coverage gaps show by default; switch to <b>All projects</b> to browse the full list. ' +
      'Team changes happen on each project&rsquo;s <b>Support Team</b> tab, where the project context is fixed (pattern study 2026-07-03: JSM project settings / PSA customer-360). ' +
      'An active project must keep <b>&ge;1 L1</b> (clients assign L1 only, FR-10); no L2+ means auto-escalation dead-ends (FR-35).</p></div></div>' +
      '<div style="margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap;">' + kpiTiles + '</div>' +
      '<div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' + viewToggle +
      '<label style="font-weight:600;font-size:13px;white-space:nowrap;">Company:</label>' + companySelect +
      '<label style="font-weight:600;font-size:13px;white-space:nowrap;">Project:</label>' + apProjectSelect +
      '<span class="ir-count" id="ap-visible-count" style="margin-left:auto;"></span></div>' +
      '<div id="ap-cards">' + cards + '</div>' +
      '<p id="ap-empty" class="muted" style="display:none;"></p>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 14 &mdash; AGENT_PROJECTS read-only rollup, exceptions-first (coverage KPIs are one-click filters; gaps show by default). Edits live on the Project Detail Support Team tab only &mdash; one door, one truth (pattern study 2026-07-03).</p></div>';
    renderShell(u, 'agent-projects', html, tenantBanner(u));
    sd.setAgentMapView(initialView);
  }

  /* ---------- page: COMPANY DETAIL (Page 17) ---------- */
  function renderCompanyDetail(u) {
    if (!isAdmin(u) && !isClient(u)) { renderShell(u, 'home', notFound('System Admin or client roles only.'), ''); return; }
    var admin = isAdmin(u);
    var cid = admin ? qs('id') : u.companyId; // client roles are locked to their own company
    if (!cid) { renderShell(u, 'companies', notFound('No company id in the URL — this page expects 17-company-detail.html?id=Cn. Open it via a Manage button on the Companies page.'), ''); return; }
    var c = DB.companies.find(function (x) { return x.id === cid; });
    if (!c) { renderShell(u, 'companies', notFound('Company "' + esc(cid) + '" is not in your demo data (stale localStorage?). Click "Reset demo" in the header and try again.'), ''); return; }
    if (c.status !== 'Active') { renderShell(u, 'companies', notFound('Company "' + esc(c.name) + '" is inactive — reactivate it from the Companies page to manage it.'), ''); return; }

    // --- Stats ---
    var accIds = (isClient(u) && !isClientAdmin(u)) ? userAccessibleProjectIds(u) : null;
    var companyTickets = DB.tickets.filter(function (t) { return t.companyId === cid && (!accIds || accIds.indexOf(t.projectId) >= 0); });
    var openCount = companyTickets.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
    var breachedCount = companyTickets.filter(function (t) { return slaStatus(t) === 'breached'; }).length;
    var companyUsers = DB.users.filter(function (x) { return x.companyId === cid; });
    var cProjs = companyProjects(cid).filter(function (p) { return !accIds || accIds.indexOf(p.id) >= 0; });
    var clientAdmins = companyUsers.filter(function (x) {
      return x.role === 'Client Admin' || userHoldsRole(x.id, 'CLIENT_ADMIN');
    });

    // --- Header ---
    var statusClass = c.status === 'Active' ? 'tag-active' : 'tag-inactive';
    var header = '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
      '<div><span style="font-size:13px;color:#666;">Company</span>' +
      '<h2 style="margin:0;">' + esc(c.name) + ' <span class="' + statusClass + '" style="font-size:13px;">&#9679; ' + c.status + '</span></h2></div>' +
      '<div style="margin-left:auto;display:flex;gap:16px;flex-wrap:wrap;">' +
      '<div class="stat-card" style="text-align:center;padding:8px 16px;"><div class="stat-val">' + openCount + '</div><div class="stat-lbl">Open Tickets</div></div>' +
      (breachedCount ? '<div class="stat-card" style="text-align:center;padding:8px 16px;border-color:#fecaca;"><div class="stat-val" style="color:#b91c1c;">' + breachedCount + '</div><div class="stat-lbl">SLA Breached</div></div>' : '') +
      '<div class="stat-card" style="text-align:center;padding:8px 16px;"><div class="stat-val">' + cProjs.length + '</div><div class="stat-lbl">Projects</div></div>' +
      '<div class="stat-card" style="text-align:center;padding:8px 16px;"><div class="stat-val">' + companyUsers.length + '</div><div class="stat-lbl">Users</div></div>' +
      '<div class="stat-card" style="text-align:center;padding:8px 16px;"><div class="stat-val">' + clientAdmins.length + '</div><div class="stat-lbl">Client Admins</div></div>' +
      '</div></div>';

    // --- Tabs ---
    var activeTab = window._companyDetailTab || 'projects';
    var tabs = '<div class="cd-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--c-border-lt);margin:16px 0 0 0;">' +
      '<button class="cd-tab' + (activeTab === 'projects' ? ' cd-tab-active' : '') + '" data-tab="projects" onclick="sd.companyTab(\'projects\')">&#128194; Projects</button>' +
      '<button class="cd-tab' + (activeTab === 'depts' ? ' cd-tab-active' : '') + '" data-tab="depts" onclick="sd.companyTab(\'depts\')">&#127970; Departments</button>' +
      '<button class="cd-tab' + (activeTab === 'admins' ? ' cd-tab-active' : '') + '" data-tab="admins" onclick="sd.companyTab(\'admins\')">&#128100; Client Admins</button>' +
      '</div>';

    // --- Projects tab (team/SLA/categories/invitations are per-project on the Project Detail hub) ---
    var projRows = cProjs.map(function (p) {
      var tk = DB.tickets.filter(function (t) { return t.projectId === p.id; }).length;
      var agCount = (DB.agentProjects || []).filter(function (ap) { return ap.projectId === p.id; }).length;
      var visBadge = (p.visibility || 'OPEN') === 'RESTRICTED'
        ? '<span class="tag-inactive" title="Invitation-only (decision Q)">&#128274; Restricted</span>'
        : '<span class="tag-active" title="Visible to the whole company">&#127758; Open</span>';
      return '<tr><td><b>' + esc(p.projectName) + '</b></td><td>' + esc(p.projectKey) + '</td>' +
        '<td>' + visBadge + '</td><td>' + tk + '</td><td>' + agCount + teamCoverageBadges(p.id) + '</td>' +
        '<td>' + (admin
          ? '<a class="btn btn-sm btn-primary" href="19-project-detail.html?id=' + p.id + '">&#9881; Manage</a> ' +
            '<button class="btn btn-sm" onclick="sd.showEditProject(\'' + p.id + '\')">&#9998; Edit</button>'
          : '<a class="btn btn-sm btn-primary" href="19-project-detail.html?id=' + p.id + '">&#128065; View</a>') + '</td></tr>';
    }).join('');
    if (!projRows) projRows = '<tr><td colspan="6" class="muted">No projects for this company.</td></tr>';
    var projectsPanel = '<div class="cd-panel" data-panel="projects"' + (activeTab !== 'projects' ? ' style="display:none;"' : '') + '>' +
      '<div class="card" style="overflow:hidden;">' +
      '<div class="card-hd"><span>Projects</span>' +
      (admin ? '<button class="btn btn-sm btn-primary" style="float:right;margin:-4px 0;" onclick="sd.showAddProjectCD(\'' + cid + '\')">+ Add Project</button>' : '') + '</div>' +
      '<table class="t"><thead><tr><th>Project Name</th><th>Key</th><th>Visibility</th><th>Tickets</th><th>Agents</th><th>Actions</th></tr></thead><tbody>' + projRows + '</tbody></table>' +
      '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">Support team, SLA policy, categories and invitations are configured per project &mdash; use <b>&#9881; Manage</b> (one door, one truth).</p>' +
      '</div></div>';

    // --- Departments tab (decision N: metadata only — routing/reporting, never visibility) ---
    var cDepts = (DB.departments || []).filter(function (d) { return d.companyId === cid; });
    var deptRows = cDepts.map(function (d) {
      var userCount = DB.users.filter(function (x) { return x.departmentId === d.id; }).length;
      return '<tr><td><b>' + esc(d.name) + '</b></td><td>' + userCount + '</td>' +
        (admin ? '<td><button class="btn btn-sm" onclick="sd.showEditDept(\'' + d.id + '\')">&#9998; Edit</button></td>' : '') + '</tr>';
    }).join('');
    if (!deptRows) deptRows = '<tr><td colspan="' + (admin ? 3 : 2) + '" class="muted">No departments yet — users and tickets can be filed without one.</td></tr>';
    var deptsPanel = '<div class="cd-panel" data-panel="depts"' + (activeTab !== 'depts' ? ' style="display:none;"' : '') + '>' +
      '<div class="card" style="overflow:hidden;">' +
      '<div class="card-hd"><span>Departments</span>' +
      (admin ? '<button class="btn btn-sm btn-primary" style="float:right;margin:-4px 0;" onclick="sd.showAddDeptCD(\'' + cid + '\')">+ Add Department</button>' : '') + '</div>' +
      '<table class="t"><thead><tr><th>Department</th><th>Users</th>' + (admin ? '<th>Actions</th>' : '') + '</tr></thead><tbody>' + deptRows + '</tbody></table>' +
      '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">Departments are <b>metadata only</b> (decision N) — stamped on users and tickets for routing/reporting, never a visibility filter. Set a user&rsquo;s department on the Users page (&#9998; Edit).</p>' +
      '</div></div>';

    // --- Client Admins tab (system-admin view: who runs this company's side of the desk) ---
    var adminRows = clientAdmins.map(function (x) {
      var stCls = (x.status || 'Active') === 'Active' ? 'tag-active' : 'tag-inactive';
      var last = x.lastLogin ? new Date(x.lastLogin).toLocaleString() : '—';
      return '<tr><td><span class="avatar-sm">' + initials(x.name) + '</span> <b>' + esc(x.name) + '</b></td>' +
        '<td>' + esc(x.email) + '</td>' +
        '<td><span class="' + stCls + '">&#9679; ' + (x.status || 'Active') + '</span></td>' +
        '<td>' + esc(last) + '</td></tr>';
    }).join('');
    if (!adminRows) adminRows = '<tr><td colspan="4"><span class="tag-inactive">&#9888; No Client Admin</span> <span class="muted" style="font-size:12px;">this company cannot manage its own users or Restricted-project invitations &mdash; assign the CLIENT_ADMIN role on the Users page.</span></td></tr>';
    var adminsPanel = '<div class="cd-panel" data-panel="admins"' + (activeTab !== 'admins' ? ' style="display:none;"' : '') + '>' +
      '<div class="card" style="overflow:hidden;">' +
      '<div class="card-hd"><span>Client Admins</span>' +
      (admin ? '<a class="btn btn-sm" style="float:right;margin:-4px 0;" href="10-users.html">Manage on Users page &rarr;</a>' : '') + '</div>' +
      '<table class="t"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Last Login</th></tr></thead><tbody>' + adminRows + '</tbody></table>' +
      '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">Client Admins see all company tickets, manage company users and Restricted-project invitations (decision Q), and can assign/reassign agents on any company ticket.</p>' +
      '</div></div>';

    var html = pageBar(admin ? 'Administration / Companies / ' + esc(c.name) : 'My Company / ' + esc(c.name), c.name,
      admin ? '<a class="btn btn-sm" href="09-companies.html">&larr; Back to Companies</a>' : '') +
      '<div class="content">' +
      '<div class="card" style="overflow:hidden;padding:16px;">' + header + '</div>' +
      tabs + projectsPanel + deptsPanel + adminsPanel +
      (admin
        ? '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 17 &mdash; Company-centric admin: projects (Decision O) + departments (decision N, metadata only) + Client Admin contacts. Team, SLA, categories and invitations are configured per project on the Project Detail hub.</p>'
        : '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 17 &mdash; My Company, read-only (spec 2026-07-04): your projects, departments (metadata, decision N) and Client Admin contacts. Changes go through your Client Admin or the service provider.</p>') + '</div>';
    renderShell(u, admin ? 'companies' : 'my-company', html, tenantBanner(u));
  }

  /* ---------- page: PROJECT DETAIL HUB (Page 19) ----------
     Admin-console spec (2026-07-03): flat pages browse, this hub configures.
     Tabs: Details | Support Team | SLA Targets | Categories | Invitations (Restricted only) */
  function userHoldsRole(uid, role) {
    return (DB.userRoles || []).some(function (r) { return r.userId === uid && r.role === role; });
  }
  function renderProjectDetail(u) {
    var admin = isAdmin(u);
    var pid = qs('id');
    if (!pid) { renderShell(u, 'projects', notFound('No project id in the URL — this page expects 19-project-detail.html?id=Pn. Open it via a Manage button on the Projects page.'), ''); return; }
    var p = (DB.projects || []).find(function (x) { return x.id === pid; });
    if (!p) { renderShell(u, 'projects', notFound('Project "' + esc(pid) + '" is not in your demo data (stale localStorage?). Click "Reset demo" in the header and try again.'), ''); return; }
    var canView = admin ||
      (isClientAdmin(u) && p.companyId === u.companyId) ||
      (isAgent(u) && agentCoversProject(u.id, pid)) ||
      (isClient(u) && !isClientAdmin(u) && userAccessibleProjectIds(u).indexOf(pid) >= 0);
    if (!canView) { renderShell(u, 'projects', notFound('Project "' + esc(pid) + '" not found.'), ''); return; }
    var canInvite = admin || (isClientAdmin(u) && p.companyId === u.companyId);
    var c = company(p.companyId);
    var isRestricted = (p.visibility || 'OPEN') === 'RESTRICTED';
    var activeTab = window._projectDetailTab || 'details';
    if (activeTab === 'invites') activeTab = 'access';

    // --- Stats ---
    var projTickets = DB.tickets.filter(function (t) { return t.projectId === pid; });
    var openCount = projTickets.filter(function (t) { return t.status !== 'Closed' && t.status !== 'Resolved'; }).length;
    var breachedCount = projTickets.filter(function (t) { return slaStatus(t) === 'breached'; }).length;
    var team = projectTeam(pid);
    var invited = (DB.userProjects || []).filter(function (r) { return r.projectId === pid; });

    // --- Header ---
    var visBadge = isRestricted
      ? '<span class="tag-inactive">&#128274; Restricted</span>'
      : '<span class="tag-active">&#127758; Open</span>';
    var statusClass = p.isActive ? 'tag-active' : 'tag-inactive';
    var header = '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
      '<div><span style="font-size:13px;color:#666;">' + esc(c.name || '') + ' / Project</span>' +
      '<h2 style="margin:0;">' + esc(p.projectName) + ' <span class="muted" style="font-size:13px;font-weight:400;">' + esc(p.projectKey) + '</span> ' +
      visBadge + ' <span class="' + statusClass + '" style="font-size:13px;">&#9679; ' + (p.isActive ? 'Active' : 'Inactive') + '</span></h2></div>' +
      '<div style="margin-left:auto;display:flex;gap:16px;flex-wrap:wrap;">' +
      '<div class="stat-card" style="text-align:center;padding:8px 16px;"><div class="stat-val">' + openCount + '</div><div class="stat-lbl">Open Tickets</div></div>' +
      (breachedCount ? '<div class="stat-card" style="text-align:center;padding:8px 16px;border-color:#fecaca;"><div class="stat-val" style="color:#b91c1c;">' + breachedCount + '</div><div class="stat-lbl">SLA Breached</div></div>' : '') +
      '<div class="stat-card" style="text-align:center;padding:8px 16px;"><div class="stat-val">' + team.length + '</div><div class="stat-lbl">Team Agents</div></div>' +
      (isRestricted ? '<div class="stat-card" style="text-align:center;padding:8px 16px;"><div class="stat-val">' + invited.length + '</div><div class="stat-lbl">Invited Users</div></div>' : '') +
      '</div></div>';

    // --- Tabs ---
    var tabs = '<div class="cd-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--c-border-lt);margin:16px 0 0 0;">' +
      '<button class="cd-tab' + (activeTab === 'details' ? ' cd-tab-active' : '') + '" data-tab="details" onclick="sd.projectTab(\'details\')">&#128196; Details</button>' +
      '<button class="cd-tab' + (activeTab === 'team' ? ' cd-tab-active' : '') + '" data-tab="team" onclick="sd.projectTab(\'team\')">&#128101; Support Team</button>' +
      '<button class="cd-tab' + (activeTab === 'sla' ? ' cd-tab-active' : '') + '" data-tab="sla" onclick="sd.projectTab(\'sla\')">&#9202; SLA Policy</button>' +
      '<button class="cd-tab' + (activeTab === 'cats' ? ' cd-tab-active' : '') + '" data-tab="cats" onclick="sd.projectTab(\'cats\')">&#127991;&#65039; Categories</button>' +
      '<button class="cd-tab' + (activeTab === 'access' ? ' cd-tab-active' : '') + '" data-tab="access" onclick="sd.projectTab(\'access\')">&#128101; Access</button>' +
      '</div>';

    // --- Details tab ---
    var detailsPanel = '<div class="cd-panel" data-panel="details"' + (activeTab !== 'details' ? ' style="display:none;"' : '') + '>' +
      '<div class="card"><div class="card-hd"><span>Project Details</span>' +
      (admin ? '<button class="btn btn-sm" style="float:right;margin:-4px 0;" onclick="sd.showEditProject(\'' + pid + '\')">&#9998; Edit</button>' : '') + '</div>' +
      '<div class="card-bd"><div class="form-grid cols-2">' +
      '<div class="field"><label>Project Name</label><input value="' + esc(p.projectName) + '" disabled></div>' +
      '<div class="field"><label>Key</label><input value="' + esc(p.projectKey) + '" disabled></div>' +
      '<div class="field"><label>Company</label><input value="' + esc(c.name || '') + '" disabled></div>' +
      '<div class="field"><label>Created</label><input value="' + esc((p.createdAt || '').slice(0, 10)) + '" disabled></div>' +
      '<div class="field" style="grid-column:span 2;"><label>Description</label><input value="' + esc(p.description || '') + '" disabled></div>' +
      '</div>' +
      (isRestricted
        ? '<p class="muted" style="font-size:12px;">&#128274; <b>Restricted</b> (decision Q): invisible to the company except invited users (Access tab). Flip to Open at go-live via Edit.'
        : '<p class="muted" style="font-size:12px;">&#127758; <b>Open</b> (decision Q): every ' + esc(c.name || '') + ' user sees this project and can raise tickets in it.') +
      '</p></div></div></div>';

    // --- Support Team tab ---
    var teamRows = team.map(function (a) {
      var openN = agentOpenCountInProject(a.id, pid);
      var totalProjects = (DB.agentProjects || []).filter(function (ap) { return ap.userId === a.id; }).length;
      var stCls = (a.status || 'Active') === 'Active' ? 'tag-active' : 'tag-inactive';
      return '<tr><td><span class="avatar-sm">' + initials(a.name) + '</span> <b>' + esc(a.name) + '</b></td>' +
        '<td>' + (a.tier || '<span class="muted">—</span>') + '</td>' +
        '<td><span class="' + stCls + '">&#9679; ' + (a.status || 'Active') + '</span></td>' +
        '<td>' + openN + '</td><td>' + totalProjects + '</td>' +
        (admin ? '<td><button class="btn btn-sm" style="color:#b91c1c;" onclick="sd.removeTeamAgent(\'' + pid + '\',\'' + a.id + '\')">&#10005; Remove</button></td>' : '') + '</tr>';
    }).join('');
    if (!teamRows) teamRows = '<tr><td colspan="' + (admin ? 6 : 5) + '" class="muted">No agents mapped — this project is in a broken state (FR-10).</td></tr>';
    var teamPanel = '<div class="cd-panel" data-panel="team"' + (activeTab !== 'team' ? ' style="display:none;"' : '') + '>' +
      '<div class="card" style="overflow:hidden;">' +
      '<div class="card-hd"><span>Support Team' + teamCoverageBadges(pid) + '</span>' +
      (admin ? '<button class="btn btn-sm btn-primary" style="float:right;margin:-4px 0;" onclick="sd.showAddTeamAgent(\'' + pid + '\')">+ Add Agent</button>' : '') + '</div>' +
      '<table class="t"><thead><tr><th>Agent</th><th>Tier</th><th>Status</th><th>Open here</th><th>Projects covered</th>' + (admin ? '<th>Actions</th>' : '') + '</tr></thead><tbody>' + teamRows + '</tbody></table>' +
      (admin
        ? '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">Flow 3/4 gates: an active project keeps &ge;1 L1 (clients assign L1 only, FR-10); removal is blocked while an agent holds open tickets here.</p>'
        : '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">The support team covering this engagement — tiers are per-project (decision M). Read-only: team changes are made by the service provider.</p>') +
      '</div></div>';

    // --- SLA tab (policy assignment — the ONE door for changing a project's SLA) ---
    var assignedPol = slaPolicyFor(pid);
    var polOptions = '<option value=""' + (!p.slaPolicyId ? ' selected' : '') + '>— Default policy (' + esc((defaultSlaPolicy() || {}).name || 'none') + ') —</option>' +
      (DB.slaPolicies || []).map(function (sp) {
        return '<option value="' + sp.id + '"' + (p.slaPolicyId === sp.id ? ' selected' : '') + '>' + esc(sp.name) + (sp.isDefault ? ' (default)' : '') + '</option>';
      }).join('');
    var polTargetRows = assignedPol ? (assignedPol.targets || []).map(function (t) {
      return '<tr><td>' + sevBadge(t.severity) + '</td><td>' + t.responseHours + 'h</td><td>' + t.resolutionDays + 'd</td><td>' + (t.escalationPct || 80) + '%</td></tr>';
    }).join('') : '<tr><td colspan="4" class="muted">No SLA policies defined.</td></tr>';
    var slaPanel = '<div class="cd-panel" data-panel="sla"' + (activeTab !== 'sla' ? ' style="display:none;"' : '') + '>' +
      '<div class="card" style="overflow:hidden;"><div class="card-hd">SLA Policy (FR-23)</div>' +
      '<div class="card-bd" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<label style="font-weight:600;font-size:13px;">Assigned policy for <b>' + esc(p.projectKey) + '</b> — ' + esc(c.name || '') + ':</label>' +
      (admin
        ? '<select class="ig-filter-select" onchange="sd.changeProjectSlaPolicy(\'' + pid + '\', this.value)">' + polOptions + '</select>' +
          '<a class="btn btn-sm" href="13-sla-targets.html">Manage policies &rarr;</a>'
        : '<b style="font-size:13px;">' + esc((assignedPol || {}).name || '—') + '</b>') + '</div>' +
      '<table class="t"><thead><tr><th>Severity</th><th>Response Time</th><th>Resolution Time</th><th>Escalation %</th></tr></thead><tbody>' + polTargetRows + '</tbody></table>' +
      (admin
        ? '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">Targets shown are the <b>' + esc((assignedPol || {}).name || '—') + '</b> policy&rsquo;s — edit them on the SLA Policies page (affects every project on that policy). New tickets stamp their due date from the policy at creation; existing tickets keep their stamped dates.</p>'
        : '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">Your contracted response/resolution targets per severity (FR-23). Tickets stamp their due date from these at creation.</p>') +
      '</div></div>';

    // --- Categories tab ---
    var ownCats = DB.categories.filter(function (x) { return x.projectId === pid; });
    var inheritedCats = DB.categories.filter(function (x) {
      return !x.projectId && (x.companyId === null || x.companyId === p.companyId) && (x.status || 'Active') === 'Active';
    });
    var catRows = ownCats.map(function (x) {
      var stCls = (x.status || 'Active') === 'Active' ? 'tag-active' : 'tag-inactive';
      return '<tr><td><b>' + esc(x.name) + '</b></td><td>Project-specific</td><td class="muted" style="font-size:12px;">' + esc(x.description || '') + '</td>' +
        '<td><span class="' + stCls + '">&#9679; ' + (x.status || 'Active') + '</span></td>' +
        '<td>' + (admin ? '<button class="btn btn-sm" onclick="sd.showEditCategory(\'' + x.id + '\')">&#9998; Edit</button>' : '<span class="muted" style="font-size:11px;">read-only</span>') + '</td></tr>';
    }).join('');
    catRows += inheritedCats.map(function (x) {
      return '<tr><td>' + esc(x.name) + '</td><td><span class="muted">' + (x.companyId ? 'Company-wide' : 'Global') + ' (inherited)</span></td>' +
        '<td class="muted" style="font-size:12px;">' + esc(x.description || '') + '</td>' +
        '<td><span class="tag-active">&#9679; Active</span></td><td><span class="muted" style="font-size:11px;">managed on Categories page</span></td></tr>';
    }).join('');
    if (!catRows) catRows = '<tr><td colspan="5" class="muted">No categories apply to this project.</td></tr>';
    var catsPanel = '<div class="cd-panel" data-panel="cats"' + (activeTab !== 'cats' ? ' style="display:none;"' : '') + '>' +
      '<div class="card" style="overflow:hidden;">' +
      '<div class="card-hd"><span>Categories (hybrid model — two doors, one table)</span>' +
      (admin ? '<button class="btn btn-sm btn-primary" style="float:right;margin:-4px 0;" onclick="sd.showAddCategoryPD(\'' + pid + '\')">+ Add Project Category</button>' : '') + '</div>' +
      '<table class="t"><thead><tr><th>Category</th><th>Scope</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + catRows + '</tbody></table>' +
      '</div></div>';

    // --- Access tab (decision Q, spec 2026-07-04): who can see this project ---
    var accessPanel;
    if (isRestricted) {
      var invRows = invited.map(function (r) {
        var x = user(r.userId);
        if (!x) return '';
        var dept = department(x.departmentId);
        return '<tr><td><span class="avatar-sm">' + initials(x.name) + '</span> <b>' + esc(x.name) + '</b></td><td>' + esc(x.email) + '</td>' +
          '<td>' + (dept.name ? esc(dept.name) : '<span class="muted">—</span>') + '</td>' +
          (canInvite ? '<td><button class="btn btn-sm" style="color:#b91c1c;" onclick="sd.revokeInvitePD(\'' + pid + '\',\'' + x.id + '\')">&#10005; Revoke</button></td>' : '') + '</tr>';
      }).join('');
      if (!invRows) invRows = '<tr><td colspan="' + (canInvite ? 4 : 3) + '" class="muted">Nobody invited yet — this project is invisible to all ' + esc(c.name || '') + ' users.</td></tr>';
      accessPanel = '<div class="cd-panel" data-panel="access"' + (activeTab !== 'access' ? ' style="display:none;"' : '') + '>' +
        '<div class="card" style="overflow:hidden;">' +
        '<div class="card-hd"><span>&#128274; Restricted — invited users only (USER_PROJECTS, decision Q)</span>' +
        (canInvite ? '<button class="btn btn-sm btn-primary" style="float:right;margin:-4px 0;" onclick="sd.showInvitePD(\'' + pid + '\')">+ Invite User</button>' : '') + '</div>' +
        '<table class="t"><thead><tr><th>User</th><th>Email</th><th>Department</th>' + (canInvite ? '<th>Actions</th>' : '') + '</tr></thead><tbody>' + invRows + '</tbody></table>' +
        '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">Only invited users see this Restricted project. ' + (admin ? 'Flip the project to Open (Details &rarr; Edit) at go-live — no per-user cleanup needed.' : 'Ask the service provider to flip it to Open at go-live — no per-user cleanup needed.') + '</p>' +
        '</div></div>';
    } else {
      var roster = DB.users.filter(function (x) { return x.companyId === p.companyId && x.status === 'Active'; });
      var rosterRows = roster.map(function (x) {
        var dept = department(x.departmentId);
        return '<tr><td><span class="avatar-sm">' + initials(x.name) + '</span> <b>' + esc(x.name) + '</b></td><td>' + esc(x.email) + '</td>' +
          '<td><span class="role-pill">' + esc(x.role) + '</span></td>' +
          '<td>' + (dept.name ? esc(dept.name) : '<span class="muted">—</span>') + '</td></tr>';
      }).join('');
      if (!rosterRows) rosterRows = '<tr><td colspan="4" class="muted">No active users at ' + esc(c.name || '') + '.</td></tr>';
      accessPanel = '<div class="cd-panel" data-panel="access"' + (activeTab !== 'access' ? ' style="display:none;"' : '') + '>' +
        '<div class="card" style="overflow:hidden;">' +
        '<div class="card-hd">&#127758; Open — visible to everyone at ' + esc(c.name || '') + ' (' + roster.length + ' users)</div>' +
        '<table class="t"><thead><tr><th>User</th><th>Email</th><th>Landing Role</th><th>Department</th></tr></thead><tbody>' + rosterRows + '</tbody></table>' +
        '<p class="muted" style="padding:8px 12px;font-size:11.5px;margin:0;">Open projects need no invitations (decision Q) — every active ' + esc(c.name || '') + ' user sees this project automatically. Read-only roster.</p>' +
        '</div></div>';
    }

    var html = pageBar((admin ? 'Administration' : (isAgent(u) ? 'My Projects' : 'My Company')) + ' / Projects / ' + esc(p.projectName), p.projectName, '<a class="btn btn-sm" href="11-projects.html">&larr; Back to Projects</a>') +
      '<div class="content">' +
      '<div class="card" style="overflow:hidden;padding:16px;">' + header + '</div>' +
      tabs + detailsPanel + teamPanel + slaPanel + catsPanel + accessPanel +
      (admin
        ? '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 19 &mdash; Project-centric admin hub (admin-console spec 2026-07-03). Flat pages browse; this hub configures: team (Flows 3/4), SLA (FR-23), categories (hybrid), access (decision Q).</p>'
        : (isClientAdmin(u)
          ? '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 19 &mdash; same hub, Client Admin view (spec 2026-07-04): team/SLA/categories read-only; you manage invitations on the Access tab (decision Q).</p>'
          : '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 19 &mdash; read-only project view (spec 2026-07-04): team, SLA targets, categories and access are information only.</p>')) + '</div>';
    renderShell(u, 'projects', html, tenantBanner(u));
  }

  /* ---------- page: AUDIT LOG (Page 16) ---------- */
  function renderAuditLog(u) {
    if (!isAdmin(u)) { renderShell(u, 'home', notFound('System Admin only.'), ''); return; }
    var logs = (DB.adminAuditLog || []).slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    var actions = {}; var entities = {};
    logs.forEach(function (l) { actions[l.action] = true; entities[l.entity] = true; });
    var actionOpts = '<option value="all">All Actions</option>' + Object.keys(actions).map(function (a) {
      return '<option value="' + esc(a) + '">' + esc(a) + '</option>';
    }).join('');
    var entityOpts = '<option value="all">All Entities</option>' + Object.keys(entities).map(function (e) {
      return '<option value="' + esc(e) + '">' + esc(e) + '</option>';
    }).join('');
    var rows = logs.map(function (l) {
      var au = user(l.userId);
      return '<tr data-audit-action="' + esc(l.action) + '" data-audit-entity="' + esc(l.entity) + '" data-audit-ts="' + esc(l.timestamp) + '">' +
        '<td class="audit-ts">' + esc(new Date(l.timestamp).toLocaleString()) + '</td>' +
        '<td>' + esc(au ? au.name : l.userId) + '</td>' +
        '<td><span class="audit-action">' + esc(l.action) + '</span></td>' +
        '<td class="audit-entity">' + esc(l.entity) + '</td>' +
        '<td>' + esc(l.record) + '</td>' +
        '<td class="muted">' + esc(l.oldValue || '\u2014') + '</td>' +
        '<td class="muted">' + esc(l.newValue || '\u2014') + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="7" class="muted">No admin actions logged yet. Try adding or editing a company or user.</td></tr>';
    var html = pageBar('Administration / Audit Log', 'Audit Log', '') +
      '<div class="content"><div class="card" style="overflow:hidden;" id="ig-audit-wrap">' +
      '<div class="ir-toolbar" style="flex-wrap:wrap;gap:8px;">' +
        '<div class="ir-search">&#128270; <input placeholder="Search\u2026" oninput="sd.filterAuditLog()"></div>' +
        '<div style="display:flex;align-items:center;gap:6px;"><label style="font-size:12px;white-space:nowrap;">Action:</label><select id="audit-action-filter" class="ig-filter-select" onchange="sd.filterAuditLog()">' + actionOpts + '</select></div>' +
        '<div style="display:flex;align-items:center;gap:6px;"><label style="font-size:12px;white-space:nowrap;">Entity:</label><select id="audit-entity-filter" class="ig-filter-select" onchange="sd.filterAuditLog()">' + entityOpts + '</select></div>' +
        '<div style="display:flex;align-items:center;gap:6px;"><label style="font-size:12px;white-space:nowrap;">From:</label><input id="audit-date-from" type="date" class="ig-filter-select" onchange="sd.filterAuditLog()"></div>' +
        '<div style="display:flex;align-items:center;gap:6px;"><label style="font-size:12px;white-space:nowrap;">To:</label><input id="audit-date-to" type="date" class="ig-filter-select" onchange="sd.filterAuditLog()"></div>' +
        '<div class="ir-actions" style="margin-left:auto;">' +
          '<button class="ir-btn" onclick="sd.clearAuditFilters()">Clear Filters</button>' +
          '<span class="ir-count" id="audit-row-count">' + logs.length + ' rows</span>' +
        '</div>' +
      '</div>' +
      '<table class="t" id="ig-audit"><thead><tr><th class="sortable">Timestamp</th><th class="sortable">User</th><th class="sortable">Action</th><th class="sortable">Entity</th><th class="sortable">Record</th><th>Old Value</th><th>New Value</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:12px;">Page 16 &mdash; APEX Interactive Report (read-only). ISO \u00a79.1: monitoring &amp; measurement.</p></div>';
    renderShell(u, 'audit-log', html, tenantBanner(u));
  }

  function renderProfile(u) {
    // Decision M revised: tier is per project mapping — show the full picture
    var myTiers = (DB.agentProjects || []).filter(function (m) { return m.userId === u.id; })
      .map(function (m) { return (project(m.projectId).projectKey || m.projectId) + ': ' + (m.tier || '—'); })
      .join(', ');
    var tierHtml = myTiers ? '<div class="field"><label>Tier (per project)</label><input value="' + esc(myTiers) + '" disabled></div>' : '';
    var html = pageBar('Account / Profile', 'My Profile', '') +
      '<div class="content" style="max-width:720px;"><div class="card"><div class="card-hd">Personal details</div><div class="card-bd">' +
      '<div style="display:flex;gap:16px;align-items:center;margin-bottom:18px;"><div class="avatar" style="width:60px;height:60px;font-size:22px;">' + initials(u.name) + '</div>' +
      '<div><div style="font-weight:600;font-size:16px;">' + esc(u.name) + '</div><div class="muted">' + esc(u.role) + ' &middot; ' + esc(company(u.companyId).name) + '</div></div></div>' +
      '<div class="form-grid cols-2">' +
        '<div class="field"><label>Full name</label><input value="' + esc(u.name) + '"></div>' +
        '<div class="field"><label>Email</label><input value="' + esc(u.email) + '" disabled></div>' +
        '<div class="field"><label>Role</label><input value="' + esc(u.role) + '" disabled></div>' +
        '<div class="field"><label>Company</label><input value="' + esc(company(u.companyId).name) + '" disabled></div>' +
        tierHtml +
      '</div></div></div></div>';
    renderShell(u, 'profile', html, '');
  }

  /* ---------- actions (exposed as window.sd) ---------- */
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
    filterDeptLov: function(companyId) {
      var deptSelect = document.getElementById('usrDept');
      if (!deptSelect) return;
      var currentVal = deptSelect.value;
      var opts = '<option value="">\u2014 None \u2014</option>' + (DB.departments || []).filter(function(d) {
        return d.companyId === companyId;
      }).map(function(d) {
        return '<option value="' + d.id + '"' + (d.id === currentVal ? ' selected' : '') + '>' + esc(d.name) + '</option>';
      }).join('');
      deptSelect.innerHTML = opts;
    },
    filterUsersByCompany: function(companyId) {
      var rows = document.querySelectorAll('#ig-users tbody tr');
      var visible = 0;
      rows.forEach(function(row) {
        var companyCell = row.children[4];
        if (!companyCell) return;
        var show = (companyId === 'all' || companyCell.textContent.trim() === (DB.companies.find(function(c){ return c.id === companyId; }) || {}).name);
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      var countEl = document.getElementById('users-row-count');
      if (countEl) countEl.textContent = visible + ' rows';
    },
    // Cascading Company → Project filter (Categories / SLA / Agent Mapping pages).
    // Mirrors APEX cascading LOVs: picking a company narrows the project list.
    cascadeProjectFilter: function(selectId, companyId) {
      var sel = document.getElementById(selectId);
      if (!sel) return;
      var projs = (DB.projects || []).filter(function (p) { return p.isActive && (companyId === 'all' || p.companyId === companyId); });
      sel.innerHTML = '<option value="all">All Projects</option>' +
        projs.map(function (p) { return '<option value="' + p.id + '">' + esc(p.projectKey) + ' — ' + esc(p.projectName) + '</option>'; }).join('');
    },
    filterCatsByCompany: function(companyId) {
      sd.cascadeProjectFilter('cats-project-filter', companyId);
      sd.applyCatFilter();
    },
    applyCatFilter: function() {
      var companyId = (document.getElementById('cats-company-filter') || {}).value || 'all';
      var projectId = (document.getElementById('cats-project-filter') || {}).value || 'all';
      var visible = 0;
      document.querySelectorAll('#ig-cats tbody tr').forEach(function (row) {
        var rc = row.getAttribute('data-cat-company'); // '' = global category
        var rp = row.getAttribute('data-cat-project'); // '' = all projects
        var show = (companyId === 'all' || !rc || rc === companyId) &&
                   (projectId === 'all' || !rp || rp === projectId);
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      var countEl = document.getElementById('cats-row-count');
      if (countEl) countEl.textContent = visible + ' rows';
    },
    filterSlaByCompany: function(companyId) {
      document.querySelectorAll('#sla-assign tbody tr').forEach(function(row) {
        row.style.display = (companyId === 'all' || row.getAttribute('data-sla-company') === companyId) ? '' : 'none';
      });
    },
    filterProjectsByCompany: function(companyId) {
      var rows = document.querySelectorAll('#ig-projects tbody tr');
      var visible = 0;
      rows.forEach(function(row) {
        var show = (companyId === 'all' || row.getAttribute('data-proj-company') === companyId);
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      var countEl = document.getElementById('projects-row-count');
      if (countEl) countEl.textContent = visible + ' rows';
    },
    // Create ticket: refresh LOVs when project changes
    onCreateProjectChange: function() {
      var projSel = document.getElementById('createProject');
      var projId = projSel ? projSel.value : null;
      var u = currentUser();
      // Keep the "Filed under" banner in sync with the chosen project
      var bp = document.getElementById('bannerProj');
      if (bp) bp.innerHTML = projId ? ', project <b>' + esc(project(projId).projectName || '') + '</b>' : ' — <b>choose a project below</b>';
      // Live feedback under the picker: show the chosen project's description
      var ph = document.getElementById('projHint');
      if (ph) ph.textContent = projId ? (project(projId).description || '')
        : 'Pick the system or service this ticket concerns — it decides which support team, categories and SLA apply.';
      // Refresh category LOV
      var catSel = document.getElementById('cat');
      if (catSel) {
        var cats = projId ? DB.categories.filter(function (c) {
          if (c.status !== 'Active') return false;
          if (c.projectId && c.projectId !== projId) return false;
          if (c.companyId && c.companyId !== u.companyId) return false;
          return true;
        }).map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('')
          : '<option value="" selected disabled>— Select a project first —</option>';
        catSel.innerHTML = cats;
      }
      // Refresh agent LOV
      var agentSel = document.getElementById('createAgent');
      if (agentSel) {
        var agentPool = DB.users.filter(function (x) {
          return x.role === 'Support Agent' && agentCoversProject(x.id, projId) && (isClientAdmin(u) || agentTier(x.id, projId) === 'L1');
        });
        agentSel.innerHTML = '<option value="">\u2014 Unassigned \u2014</option>' + agentPool.map(function (a) {
          var load = DB.tickets.filter(function (x) { return x.assignedTo === a.id && x.status !== 'Closed'; }).length;
          var aTier = agentTier(a.id, projId);
          return '<option value="' + a.id + '">' + esc(a.name) + (aTier ? ' [' + aTier + ']' : '') + ' \u00b7 ' + load + ' open</option>';
        }).join('');
      }
    },
    // Decision P: switch active role without re-login (re-stamps the session, like APP_ROLE)
    switchRole: function (role) {
      var s = getSession(); if (!s) return;
      var u = DB.users.find(function (x) { return x.id === s.userId; });
      if (!u) return;
      if (role === u.role) { delete s.activeRole; } else { s.activeRole = role; }
      localStorage.setItem(LS_SESSION, JSON.stringify(s));
      location.href = landingFor(currentUser());
    },
    logout: function () { localStorage.removeItem(LS_SESSION); location.href = '01-login.html'; },
    reset: function () { if (confirm('Reset all demo data and sign out?')) { localStorage.removeItem(LS_DATA); localStorage.removeItem(LS_SESSION); location.href = '01-login.html'; } },

    createTicket: function () {
      var u = currentUser();
      var projectId = document.getElementById('createProject').value;
      if (!projectId) { alert('Select a project first — it decides which support team and SLA apply to this ticket.'); return; }
      var subject = document.getElementById('subject').value.trim();
      var desc = document.getElementById('desc').value.trim();
      if (!subject || !desc) { alert('Subject and description are required.'); return; }
      var categoryId = document.getElementById('cat').value;
      if (!categoryId) { alert('Select a category.'); return; }
      var severity = document.getElementById('sev').value;
      var ticketType = document.getElementById('ticketType').value;
      var sla = slaTarget(projectId, severity);
      var slaDue = null;
      if (sla) {
        var d = new Date();
        d.setDate(d.getDate() + sla.resolutionDays);
        slaDue = d.toISOString();
      }
      var agentId = document.getElementById('createAgent').value || null;
      var r = nextRef();
      var initStatus = agentId ? 'Assigned' : 'New';
      var t = { id: 't' + r.n, ref: r.ref, companyId: u.companyId, projectId: projectId, departmentId: u.departmentId, subject: subject, description: desc,
        categoryId: categoryId, severity: severity, priority: null,
        status: initStatus, ticketType: ticketType, createdBy: u.id, assignedTo: agentId,
        createdAt: nowIso(), updatedAt: nowIso(), resolvedAt: null, closedAt: null,
        slaDueDate: slaDue, csatScore: null, firstResponseAt: null,
        resolutionCode: null, resolutionSummary: null, reopenCount: 0 };
      DB.tickets.push(t);
      pushHistory(t.id, u.id, 'STATUS_CHANGE', '', initStatus);
      if (agentId) pushHistory(t.id, u.id, 'ASSIGN', '', user(agentId).name);
      pendingFiles.forEach(function (f) {
        DB.attachments.push({ id: 'a' + NOW() + Math.floor(Math.random() * 1000), ticketId: t.id, companyId: u.companyId, commentId: null, fileName: f.name, mimeType: f.type, fileSize: f.size, uploadedBy: u.id, uploadedAt: nowIso() });
      });
      pendingFiles = [];
      save();
      sessionStorage.setItem('flash', '&#9989; Ticket ' + r.ref + ' created in <b>' + esc(project(projectId).projectName || '') + '</b>. &#128231; Auto-acknowledgement email sent (simulated).');
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
      var t = DB.tickets.find(function (x) { return x.id === id; });
      if (!t.firstResponseAt && (isAgent(u) || isAdmin(u))) {
        t.firstResponseAt = nowIso();
      }
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
      if (to === 'In Progress' && !t.priority) {
        alert('Priority must be set before starting work. Please set priority first (triage gate \u2014 FR-37).');
        return;
      }
      var old = t.status;
      if (to === 'In Progress' && old === 'Resolved') {
        t.reopenCount = (t.reopenCount || 0) + 1;
      }
      t.status = to; t.updatedAt = nowIso();
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

    // FR-26: Escalate
    showEscalate: function (id) {
      var t = DB.tickets.find(function (x) { return x.id === id; });
      var TIER_ORDER = { 'L1': 1, 'L2': 2, 'L3': 3, 'L4': 4 };
      var currentAssignee = t.assignedTo ? user(t.assignedTo) : null;
      // FR-26 + decision M revised: both sides compared on the TICKET'S project
      var currentTierVal = currentAssignee ? agentTier(currentAssignee.id, t.projectId) : null;
      var currentTierLevel = currentTierVal ? (TIER_ORDER[currentTierVal] || 0) : 0;
      var pool = DB.users.filter(function (x) {
        if (x.role !== 'Support Agent' || x.id === t.assignedTo) return false;
        if (!agentCoversProject(x.id, t.projectId)) return false;
        var xTier = agentTier(x.id, t.projectId);
        var xTierLevel = xTier ? (TIER_ORDER[xTier] || 0) : 0;
        return xTierLevel >= currentTierLevel;
      });
      if (!pool.length) pool = DB.users.filter(function (x) { return x.role === 'Support Agent' && x.id !== t.assignedTo; });
      var agents = pool.map(function (a) { var aTier = agentTier(a.id, t.projectId); return '<option value="' + a.id + '">' + esc(a.name) + (aTier ? ' [' + aTier + ']' : '') + '</option>'; }).join('');
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
      var oldPrio = t.priority || '\u2014';
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
      var oldPrio = t.priority || '\u2014';
      t.priority = newPrio;
      t.updatedAt = nowIso();
      pushHistory(id, u.id, 'PRIORITY_CHANGE', oldPrio, newPrio);
      save();
      sessionStorage.setItem('flash', 'Priority set to ' + newPrio + '.');
      sd.closeModal();
      renderDetail(u);
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // FR-36: Resolve dialog
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

    rateCsat: function (starEl) {
      var val = parseInt(starEl.getAttribute('data-val'));
      var u = currentUser();
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
      var status = document.getElementById('cmpStatus').value;
      var id = 'C' + Date.now();
      DB.companies.push({ id: id, name: name, status: status });
      // Create a default project for the new company — key auto-generated, globally unique
      var projId = 'P' + Date.now();
      var projKey = sd.makeProjectKey(name, 'IT');
      DB.projects.push({ id: projId, companyId: id, projectName: 'IT Support', projectKey: projKey, slaPolicyId: null, description: 'General IT support for ' + name, isActive: true, createdAt: nowIso() });
      auditLog(currentUser().id, 'CREATE', 'Company', name, '', status);
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'Company "' + name + '" created with default project ' + projKey + ' (Default SLA policy applies).');
      renderCompanies(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },
    showEditCompany: function(cid) {
      var c = DB.companies.find(function(x) { return x.id === cid; });
      if (!c) return;
      var modal = '<div class="modal"><div class="m-hd"><h2>Edit Company</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Company Name <span class="req">*</span></label><input id="cmpName" value="' + esc(c.name) + '"></div>' +
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
      var oldName = c.name; var oldStatus = c.status;
      c.name = name;
      c.status = document.getElementById('cmpStatus').value;
      var changes = [];
      if (oldName !== c.name) changes.push('name: ' + oldName + ' -> ' + c.name);
      if (oldStatus !== c.status) changes.push('status: ' + oldStatus + ' -> ' + c.status);
      if (changes.length) auditLog(currentUser().id, 'UPDATE', 'Company', c.name, oldName + ' / ' + oldStatus, c.name + ' / ' + c.status);
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'Company updated.');
      renderCompanies(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // Project CRUD
    showAddProject: function() {
      var companies = DB.companies.filter(function(c) { return c.status === 'Active'; }).map(function(c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>New Project</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Project Name <span class="req">*</span></label><input id="projName" placeholder="e.g. IT Support"></div>' +
        '<div class="field"><label>Project Key <span class="req">*</span></label><input id="projKey" placeholder="e.g. ITSUP" maxlength="10" style="text-transform:uppercase;"></div>' +
        '<div class="field"><label>Company <span class="req">*</span></label><select id="projCompany">' + companies + '</select></div>' +
        '<div class="field"><label>Description</label><input id="projDesc" placeholder="Brief description\u2026"></div>' +
        '<div class="field"><label>Visibility</label><select id="projVisibility"><option value="OPEN" selected>Open \u2014 whole company sees it</option><option value="RESTRICTED">Restricted \u2014 invitation-only</option></select><span class="hint">Restricted = for pilots/sensitive apps; invite users from the Project Detail page (decision Q)</span></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddProject()">&#10133; Create Project</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    showAddProjectCD: function(companyId) {
      var modal = '<div class="modal"><div class="m-hd"><h2>New Project \u2014 ' + esc(company(companyId).name) + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Project Name <span class="req">*</span></label><input id="projName" placeholder="e.g. ERP Systems"></div>' +
        '<div class="field"><label>Project Key <span class="req">*</span></label><input id="projKey" placeholder="e.g. ERP" maxlength="10" style="text-transform:uppercase;"></div>' +
        '<div class="field"><label>Description</label><input id="projDesc" placeholder="Brief description\u2026"></div>' +
        '<div class="field"><label>Visibility</label><select id="projVisibility"><option value="OPEN" selected>Open \u2014 whole company sees it</option><option value="RESTRICTED">Restricted \u2014 invitation-only</option></select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddProject(\'' + companyId + '\')">&#10133; Create Project</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddProject: function(fixedCompanyId) {
      var name = document.getElementById('projName').value.trim();
      var key = document.getElementById('projKey').value.trim().toUpperCase();
      if (!name || !key) { alert('Project name and key are required.'); return; }
      var companyId = fixedCompanyId || document.getElementById('projCompany').value;
      var desc = document.getElementById('projDesc').value.trim();
      var visEl = document.getElementById('projVisibility');
      var visibility = visEl ? visEl.value : 'OPEN';
      key = key.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if ((DB.projects || []).some(function (px) { return px.projectKey === key; })) {
        alert('Project key "' + key + '" is already in use by another project. Keys are globally unique (e.g. ACME-IT vs GLBX-IT) so same-named projects can never be confused across companies.');
        return;
      }
      var id = 'P' + Date.now();
      DB.projects.push({ id: id, companyId: companyId, projectName: name, projectKey: key, slaPolicyId: null, description: desc, visibility: visibility, isActive: true, createdAt: nowIso() });
      auditLog(currentUser().id, 'CREATE', 'Project', name + ' (' + company(companyId).name + ')', '', key);
      save();
      sd.closeModal();
      if (fixedCompanyId) {
        toast('Project "' + name + '" (' + key + ') created — Default SLA policy applies.');
        renderCompanyDetail(currentUser());
      } else {
        sessionStorage.setItem('flash', 'Project "' + name + '" (' + key + ') created — Default SLA policy applies.');
        renderProjects(currentUser());
        var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
      }
    },
    showEditProject: function(projId) {
      var p = (DB.projects || []).find(function(x) { return x.id === projId; });
      if (!p) return;
      var modal = '<div class="modal"><div class="m-hd"><h2>Edit Project</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Project Name <span class="req">*</span></label><input id="projName" value="' + esc(p.projectName) + '"></div>' +
        '<div class="field"><label>Project Key</label><input id="projKey" value="' + esc(p.projectKey) + '" disabled></div>' +
        '<div class="field"><label>Company</label><input value="' + esc(company(p.companyId).name || '') + '" disabled><span class="hint">Immutable — a project cannot move between tenants</span></div>' +
        '<div class="field"><label>Description</label><input id="projDesc" value="' + esc(p.description || '') + '"></div>' +
        '<div class="field"><label>Visibility</label><select id="projVisibility"><option value="OPEN"' + ((p.visibility || 'OPEN') === 'OPEN' ? ' selected' : '') + '>Open — whole company sees it</option><option value="RESTRICTED"' + (p.visibility === 'RESTRICTED' ? ' selected' : '') + '>Restricted — invitation-only</option></select></div>' +
        '<div class="field"><label>Status</label><select id="projStatus"><option value="true"' + (p.isActive ? ' selected' : '') + '>Active</option><option value="false"' + (!p.isActive ? ' selected' : '') + '>Inactive</option></select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doEditProject(\'' + projId + '\')">Save Changes</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doEditProject: function(projId) {
      var p = (DB.projects || []).find(function(x) { return x.id === projId; });
      if (!p) return;
      var name = document.getElementById('projName').value.trim();
      if (!name) { alert('Project name is required.'); return; }
      var oldName = p.projectName;
      var oldVis = p.visibility || 'OPEN';
      // companyId is intentionally NOT editable — a project never moves between tenants
      p.projectName = name;
      p.description = document.getElementById('projDesc').value.trim();
      p.visibility = document.getElementById('projVisibility').value;
      p.isActive = document.getElementById('projStatus').value === 'true';
      auditLog(currentUser().id, 'UPDATE', 'Project', p.projectName, oldName, p.projectName + ' (' + (p.isActive ? 'Active' : 'Inactive') + ')');
      if (oldVis !== p.visibility) {
        auditLog(currentUser().id, 'VISIBILITY_CHANGE', 'Project', p.projectName, oldVis, p.visibility);
      }
      save();
      sd.closeModal();
      toast('Project "' + p.projectName + '" updated.');
      // Re-render whichever page we're on
      var page = document.body.getAttribute('data-page');
      if (page === 'company-detail') {
        renderCompanyDetail(currentUser());
      } else if (page === 'project-detail') {
        renderProjectDetail(currentUser());
      } else {
        renderProjects(currentUser());
      }
    },

    // FR-6: User CRUD
    showAddUser: function() {
      var companies = DB.companies.map(function(c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
      var firstCompanyId = DB.companies.length ? DB.companies[0].id : '';
      var depts = '<option value="">\u2014 None \u2014</option>' + (DB.departments || []).filter(function(d) {
        return d.companyId === firstCompanyId;
      }).map(function(d) {
        return '<option value="' + d.id + '">' + esc(d.name) + '</option>';
      }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>New User</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid cols-2">' +
        '<div class="field"><label>Full Name <span class="req">*</span></label><input id="usrName" placeholder="e.g. Jane Smith"></div>' +
        '<div class="field"><label>Email <span class="req">*</span></label><input id="usrEmail" type="email" placeholder="jane@company.example"></div>' +
        '<div class="field"><label>Role <span class="req">*</span></label><select id="usrRole"><option value="Client User">Client User</option><option value="Client Admin">Client Admin</option><option value="Support Agent">Support Agent</option><option value="System Admin">System Admin</option></select><span class="hint">Agent tier (L1\u2013L4) is set per project on each project&rsquo;s Support Team tab (decision M revised)</span></div>' +
        '<div class="field"><label>Company <span class="req">*</span></label><select id="usrCompany" onchange="sd.filterDeptLov(this.value)">' + companies + '</select></div>' +
        '<div class="field"><label>Department</label><select id="usrDept">' + depts + '</select><span class="hint">For client users \u2014 filtered by company</span></div>' +
        '<div class="field"><label>Status</label><select id="usrStatus"><option value="Active" selected>Active</option><option value="Inactive">Inactive</option></select></div>' +
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
      var deptId = document.getElementById('usrDept').value || null;
      var status = document.getElementById('usrStatus').value;
      var id = 'u' + Date.now();
      DB.users.push({ id: id, name: name, email: email, password: 'demo', role: role, companyId: companyId, departmentId: deptId, status: status, lastLogin: null });
      // USER_ROLES rows (decision P) + decision Q auto-grant: every provider-company
      // (Northwind, C0) user silently gets CLIENT_USER — always a potential requester.
      var ROLE_ENUM = { 'System Admin': 'SYSTEM_ADMIN', 'Support Agent': 'SUPPORT_AGENT', 'Client Admin': 'CLIENT_ADMIN', 'Client User': 'CLIENT_USER' };
      if (!DB.userRoles) DB.userRoles = [];
      DB.userRoles.push({ userId: id, role: ROLE_ENUM[role] || 'CLIENT_USER' });
      var autoGranted = '';
      if (companyId === 'C0' && role !== 'Client User') {
        DB.userRoles.push({ userId: id, role: 'CLIENT_USER' });
        autoGranted = ' CLIENT_USER auto-granted (decision Q).';
      }
      auditLog(currentUser().id, 'CREATE', 'User', name + ' (' + email + ')', '', role + ' / ' + company(companyId).name + ' / ' + status + (autoGranted ? ' / +CLIENT_USER' : ''));
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'User "' + name + '" created with role ' + role + '.' + autoGranted + ' Password: demo.');
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
      var depts = '<option value="">\u2014 None \u2014</option>' + (DB.departments || []).filter(function(d) {
        return d.companyId === x.companyId;
      }).map(function(d) {
        return '<option value="' + d.id + '"' + (d.id===x.departmentId?' selected':'') + '>' + esc(d.name) + '</option>';
      }).join('');
      var userStatus = x.status || 'Active';
      var modal = '<div class="modal"><div class="m-hd"><h2>Edit User</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid cols-2">' +
        '<div class="field"><label>Full Name <span class="req">*</span></label><input id="usrName" value="' + esc(x.name) + '"></div>' +
        '<div class="field"><label>Email</label><input id="usrEmail" value="' + esc(x.email) + '" disabled><span class="hint">Cannot change email</span></div>' +
        '<div class="field"><label>Role <span class="req">*</span></label><select id="usrRole">' + roles + '</select></div>' +
        '<div class="field"><label>Company <span class="req">*</span></label><select id="usrCompany" onchange="sd.filterDeptLov(this.value)">' + companies + '</select></div>' +
        '<div class="field"><label>Department</label><select id="usrDept">' + depts + '</select><span class="hint">Filtered by company</span></div>' +
        '<div class="field"><label>Status</label><select id="usrStatus"><option value="Active"' + (userStatus==='Active'?' selected':'') + '>Active</option><option value="Inactive"' + (userStatus==='Inactive'?' selected':'') + '>Inactive</option></select><span class="hint">Agent tier is set per project (decision M revised) \u2014 see each project&rsquo;s Support Team tab</span></div>' +
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
      var oldRole = x.role; var oldCompany = x.companyId; var oldName = x.name; var oldStatus = x.status || 'Active';
      x.name = name;
      x.role = document.getElementById('usrRole').value;
      x.companyId = document.getElementById('usrCompany').value;
      x.departmentId = document.getElementById('usrDept').value || null;
      x.status = document.getElementById('usrStatus').value;
      auditLog(currentUser().id, 'UPDATE', 'User', x.name + ' (' + x.email + ')', oldName + ' / ' + oldRole + ' / ' + oldStatus, x.name + ' / ' + x.role + ' / ' + x.status);
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'User "' + name + '" updated.');
      renderUsers(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // Agent-Project Mapping CRUD
    // FR-6 / admin-console spec: reset the (simulated) APEX account password
    resetPassword: function(uid) {
      var x = DB.users.find(function (y) { return y.id === uid; });
      if (!x) return;
      if (!confirm('Reset password for ' + x.name + '? (Demo: password becomes "demo" again; real build calls APEX_UTIL.RESET_PW.)')) return;
      x.password = 'demo';
      auditLog(currentUser().id, 'RESET_PASSWORD', 'User', x.name + ' (' + x.email + ')', '', 'password reset');
      save();
      toast('Password reset for ' + x.name + ' — they must change it at next login.');
    },

    // Agent-Project Mapping page: per-project cards use the guarded team actions
    // (sd.showAddTeamAgent / sd.removeTeamAgent — Flow 3/4 gates). The old ungated
    // flat-grid add/remove actions were removed with the reshape (admin-console spec).
    filterAgentMapByCompany: function(companyId) {
      sd.cascadeProjectFilter('ap-project-filter', companyId);
      sd.applyAgentMapFilter();
    },
    // view: 'attention' (any gap) | 'all' | a single issue key ('no-l1', 'no-agents', 'no-l2', 'single')
    setAgentMapView: function(view) {
      window._apView = view;
      document.querySelectorAll('.ap-view-btn, .ap-kpi').forEach(function(el) {
        el.classList.toggle('ap-view-active', el.getAttribute('data-ap-view') === view);
      });
      sd.applyAgentMapFilter();
    },
    applyAgentMapFilter: function() {
      var view = window._apView || 'all';
      var companyId = (document.getElementById('ap-company-filter') || {}).value || 'all';
      var projectId = (document.getElementById('ap-project-filter') || {}).value || 'all';
      var visible = 0;
      document.querySelectorAll('#ap-cards .card').forEach(function(cardEl) {
        var issues = (cardEl.getAttribute('data-ap-issues') || '').split(' ').filter(Boolean);
        var viewOk = view === 'all' || (view === 'attention' ? issues.length > 0 : issues.indexOf(view) >= 0);
        var show = viewOk &&
                   (companyId === 'all' || cardEl.getAttribute('data-ap-company') === companyId) &&
                   (projectId === 'all' || cardEl.getAttribute('data-ap-project') === projectId);
        cardEl.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      var count = document.getElementById('ap-visible-count');
      if (count) count.textContent = visible + ' project' + (visible === 1 ? '' : 's') + ' shown';
      var empty = document.getElementById('ap-empty');
      if (empty) {
        empty.style.display = visible ? 'none' : '';
        empty.innerHTML = (view !== 'all' && companyId === 'all' && projectId === 'all')
          ? '&#10003; No coverage gaps — every active project passes this check.'
          : 'No projects match the current filters.';
      }
    },

    // Department CRUD
    // Company-hub door (Page 17): company is fixed, no select
    showAddDeptCD: function(companyId) {
      var c = company(companyId);
      var modal = '<div class="modal"><div class="m-hd"><h2>New Department</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Department Name <span class="req">*</span></label><input id="deptName" placeholder="e.g. Finance"></div>' +
        '<div class="field"><label>Company</label><input value="' + esc(c.name || '') + '" disabled></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddDept(\'' + companyId + '\')">&#10133; Create Department</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddDept: function(companyId) {
      var name = document.getElementById('deptName').value.trim();
      if (!name) { alert('Department name is required.'); return; }
      var id = 'dep' + Date.now();
      DB.departments.push({ id: id, companyId: companyId, name: name });
      auditLog(currentUser().id, 'CREATE', 'Department', name + ' (' + company(companyId).name + ')', '', '');
      save();
      sd.closeModal();
      toast('Department "' + name + '" created under ' + company(companyId).name + '.');
      renderCompanyDetail(currentUser());
    },
    showEditDept: function(deptId) {
      var d = (DB.departments || []).find(function(x) { return x.id === deptId; });
      if (!d) return;
      var clientCompanies = DB.companies.filter(function(c) { return c.status === 'Active'; });
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
      toast('Department updated.');
      renderCompanyDetail(currentUser());
    },
    // Category CRUD
    showAddCategory: function() {
      var companyOpts = '<option value="">Global (all companies)</option>' +
        DB.companies.filter(function(c) { return c.status === 'Active'; }).map(function(c) {
          return '<option value="' + c.id + '">' + esc(c.name) + ' only</option>';
        }).join('');
      var projOpts = '<option value="">All projects</option>' +
        (DB.projects || []).filter(function(p) { return p.isActive; }).map(function(p) {
          return '<option value="' + p.id + '">' + esc(p.projectName) + ' (' + esc(company(p.companyId).name) + ')</option>';
        }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>New Category</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Category Name <span class="req">*</span></label><input id="catName" placeholder="e.g. Database"></div>' +
        '<div class="field"><label>Company Scope</label><select id="catCompany">' + companyOpts + '</select><span class="hint">Global = visible to all; company = only that client</span></div>' +
        '<div class="field"><label>Project Scope</label><select id="catProject">' + projOpts + '</select><span class="hint">Restrict to a specific project</span></div>' +
        '<div class="field"><label>Description</label><input id="catDesc" placeholder="Guidance text shown in LOV\u2026"></div>' +
        '<div class="field"><label>Status</label><select id="catStatus"><option value="Active" selected>Active</option><option value="Inactive">Inactive</option></select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddCategory()">&#10133; Create Category</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddCategory: function() {
      var name = document.getElementById('catName').value.trim();
      if (!name) { alert('Category name is required.'); return; }
      var companyId = document.getElementById('catCompany').value || null;
      var projectId = document.getElementById('catProject').value || null;
      var desc = document.getElementById('catDesc').value.trim();
      var status = document.getElementById('catStatus').value;
      var id = 'cat' + Date.now();
      DB.categories.push({ id: id, name: name, companyId: companyId, projectId: projectId, description: desc, status: status });
      auditLog(currentUser().id, 'CREATE', 'Category', name, '', (companyId ? company(companyId).name : 'Global') + ' / ' + status);
      save();
      sd.closeModal();
      sessionStorage.setItem('flash', 'Category "' + name + '" created (' + (companyId ? company(companyId).name : 'Global') + ').');
      renderCategories(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },
    showEditCategory: function(catId) {
      var c = DB.categories.find(function(x) { return x.id === catId; });
      if (!c) return;
      var companyOpts = '<option value="">Global (all companies)</option>' +
        DB.companies.filter(function(co) { return co.status === 'Active'; }).map(function(co) {
          return '<option value="' + co.id + '"' + (co.id === c.companyId ? ' selected' : '') + '>' + esc(co.name) + ' only</option>';
        }).join('');
      var projOpts = '<option value="">All projects</option>' +
        (DB.projects || []).filter(function(p) { return p.isActive; }).map(function(p) {
          return '<option value="' + p.id + '"' + (p.id === c.projectId ? ' selected' : '') + '>' + esc(p.projectName) + ' (' + esc(company(p.companyId).name) + ')</option>';
        }).join('');
      var modal = '<div class="modal"><div class="m-hd"><h2>Edit Category</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Category Name <span class="req">*</span></label><input id="catName" value="' + esc(c.name) + '"></div>' +
        '<div class="field"><label>Company Scope</label><select id="catCompany">' + companyOpts + '</select></div>' +
        '<div class="field"><label>Project Scope</label><select id="catProject">' + projOpts + '</select></div>' +
        '<div class="field"><label>Description</label><input id="catDesc" value="' + esc(c.description || '') + '"></div>' +
        '<div class="field"><label>Status</label><select id="catStatus"><option value="Active"' + ((c.status||'Active')==='Active'?' selected':'') + '>Active</option><option value="Inactive"' + ((c.status||'Active')==='Inactive'?' selected':'') + '>Inactive</option></select></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doEditCategory(\'' + catId + '\')">Save Changes</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doEditCategory: function(catId) {
      var c = DB.categories.find(function(x) { return x.id === catId; });
      if (!c) return;
      var name = document.getElementById('catName').value.trim();
      if (!name) { alert('Category name is required.'); return; }
      var oldName = c.name; var oldStatus = c.status || 'Active';
      c.name = name;
      c.companyId = document.getElementById('catCompany').value || null;
      c.projectId = document.getElementById('catProject').value || null;
      c.description = document.getElementById('catDesc').value.trim();
      c.status = document.getElementById('catStatus').value;
      auditLog(currentUser().id, 'UPDATE', 'Category', c.name, oldName + ' / ' + oldStatus, c.name + ' / ' + c.status);
      save();
      sd.closeModal();
      if (document.body.getAttribute('data-page') === 'project-detail') {
        toast('Category "' + c.name + '" updated.');
        window._projectDetailTab = 'cats';
        renderProjectDetail(currentUser());
        return;
      }
      sessionStorage.setItem('flash', 'Category "' + c.name + '" updated.');
      renderCategories(currentUser());
      var f = sessionStorage.getItem('flash'); if (f) { toast(f); sessionStorage.removeItem('flash'); }
    },

    // Project Detail hub (Page 19) — tabs + team + invitations + categories
    projectTab: function(tab) {
      window._projectDetailTab = tab;
      document.querySelectorAll('.cd-panel').forEach(function (p) {
        p.style.display = (p.getAttribute('data-panel') === tab) ? '' : 'none';
      });
      document.querySelectorAll('.cd-tab').forEach(function (t) {
        t.classList.toggle('cd-tab-active', t.getAttribute('data-tab') === tab);
      });
    },
    // Company Detail hub (Page 17) — tabs: Projects | Client Admins
    companyTab: function(tab) {
      window._companyDetailTab = tab;
      document.querySelectorAll('.cd-panel').forEach(function (p) {
        p.style.display = (p.getAttribute('data-panel') === tab) ? '' : 'none';
      });
      document.querySelectorAll('.cd-tab').forEach(function (t) {
        t.classList.toggle('cd-tab-active', t.getAttribute('data-tab') === tab);
      });
    },
    showAddTeamAgent: function(pid) {
      var team = projectTeam(pid).map(function (a) { return a.id; });
      var candidates = DB.users.filter(function (x) {
        return x.role === 'Support Agent' && x.status === 'Active' && team.indexOf(x.id) < 0;
      });
      if (!candidates.length) { alert('All active agents are already on this team.'); return; }
      var opts = candidates.map(function (a) {
        var load = DB.tickets.filter(function (t) { return t.assignedTo === a.id && t.status !== 'Resolved' && t.status !== 'Closed'; }).length;
        var elsewhere = agentTierSummary(a.id);
        return '<option value="' + a.id + '" data-default-tier="' + defaultTierFor(a.id) + '">' + esc(a.name) + (elsewhere ? ' (' + elsewhere + ' on other projects)' : ' (new agent)') + ' — ' + load + ' open ticket' + (load === 1 ? '' : 's') + '</option>';
      }).join('');
      var apProj = project(pid);
      var firstTier = defaultTierFor(candidates[0].id);
      var tierSel = ['L1', 'L2', 'L3', 'L4'].map(function (t) {
        return '<option' + (t === firstTier ? ' selected' : '') + '>' + t + '</option>';
      }).join('');
      var modal = '<div class="modal" style="max-width:440px;"><div class="m-hd"><h2>Add Agent — ' + esc(apProj.projectKey || '') + ' ' + esc(apProj.projectName || '') + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div style="padding:8px 20px 0;font-size:12.5px;color:#666;">Granting access to <b>' + esc(company(apProj.companyId).name || '') + '</b>&rsquo;s ' + esc(apProj.projectName || '') + ' queue.</div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Agent <span class="req">*</span></label><select id="teamAgent" onchange="var o=this.options[this.selectedIndex];document.getElementById(\'teamTier\').value=o.getAttribute(\'data-default-tier\')||\'L1\';">' + opts + '</select><span class="hint">Current workload shown (FR-33)</span></div>' +
        '<div class="field"><label>Tier on this project <span class="req">*</span></label><select id="teamTier">' + tierSel + '</select><span class="hint">Per-project tier (decision M revised) — the agent&rsquo;s support line on this engagement; defaults to their usual tier</span></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddTeamAgent(\'' + pid + '\')">&#10133; Add to Team</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddTeamAgent: function(pid) {
      var uid = document.getElementById('teamAgent').value;
      var a = DB.users.find(function (x) { return x.id === uid; });
      if (!a) return;
      var tierEl = document.getElementById('teamTier');
      var tier = (tierEl && tierEl.value) || 'L1';
      DB.agentProjects.push({ userId: uid, projectId: pid, tier: tier });
      var p = project(pid);
      auditLog(currentUser().id, 'TEAM_ADD', 'Agent-Project', a.name + ' -> ' + (p.projectName || pid), '', tier);
      save();
      sd.closeModal();
      toast(a.name + ' added to ' + (p.projectName || 'project') + ' as ' + tier + ' — notification sent (Flow 4).');
      sd._rerenderTeamContext();
    },
    removeTeamAgent: function(pid, uid) {
      var block = teamRemovalBlock(uid, pid);
      if (block) { alert(block); return; }
      var a = DB.users.find(function (x) { return x.id === uid; });
      var p = project(pid);
      if (!confirm('Remove ' + (a ? a.name : uid) + ' from ' + (p.projectName || 'this project') + '?')) return;
      var idx = (DB.agentProjects || []).findIndex(function (ap) { return ap.userId === uid && ap.projectId === pid; });
      var removedTier = idx >= 0 ? (DB.agentProjects[idx].tier || '') : '';
      if (idx >= 0) DB.agentProjects.splice(idx, 1);
      auditLog(currentUser().id, 'TEAM_REMOVE', 'Agent-Project', (a ? a.name : uid) + ' -> ' + (p.projectName || pid), removedTier, '');
      save();
      toast((a ? a.name : 'Agent') + ' removed from ' + (p.projectName || 'project') + '.');
      sd._rerenderTeamContext();
    },
    _rerenderTeamContext: function() {
      var page = document.body.getAttribute('data-page');
      if (page === 'project-detail') {
        window._projectDetailTab = 'team';
        renderProjectDetail(currentUser());
      } else if (page === 'company-detail') {
        renderCompanyDetail(currentUser());
      } else {
        renderAgentProjects(currentUser());
      }
    },
    showInvitePD: function(pid) {
      var p = project(pid);
      var invited = (DB.userProjects || []).filter(function (r) { return r.projectId === pid; }).map(function (r) { return r.userId; });
      var candidates = DB.users.filter(function (x) {
        return x.companyId === p.companyId && x.status === 'Active' && invited.indexOf(x.id) < 0 &&
          (userHoldsRole(x.id, 'CLIENT_USER') || x.role === 'Client User');
      });
      if (!candidates.length) { alert('Every eligible ' + (company(p.companyId).name || 'company') + ' user is already invited.'); return; }
      var opts = candidates.map(function (x) {
        var dept = department(x.departmentId);
        return '<option value="' + x.id + '">' + esc(x.name) + (dept.name ? ' — ' + esc(dept.name) : '') + (x.role !== 'Client User' ? ' (' + esc(x.role) + ')' : '') + '</option>';
      }).join('');
      var modal = '<div class="modal" style="max-width:440px;"><div class="m-hd"><h2>Invite User — ' + esc(p.projectName || '') + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>User <span class="req">*</span></label><select id="inviteUser">' + opts + '</select><span class="hint">Anyone at ' + esc(company(p.companyId).name || '') + ' holding the Client User role — incl. agents (decision Q auto-grant)</span></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doInvitePD(\'' + pid + '\')">&#9993;&#65039; Invite</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doInvitePD: function(pid) {
      var uid = document.getElementById('inviteUser').value;
      var x = DB.users.find(function (y) { return y.id === uid; });
      if (!x) return;
      if (!DB.userProjects) DB.userProjects = [];
      DB.userProjects.push({ userId: uid, projectId: pid });
      var p = project(pid);
      auditLog(currentUser().id, 'INVITE', 'User-Project', x.name + ' -> ' + (p.projectName || pid), '', 'invited');
      save();
      sd.closeModal();
      toast(x.name + ' invited to ' + (p.projectName || 'project') + '.');
      window._projectDetailTab = 'access';
      renderProjectDetail(currentUser());
    },
    revokeInvitePD: function(pid, uid) {
      var x = DB.users.find(function (y) { return y.id === uid; });
      var p = project(pid);
      if (!confirm('Revoke ' + (x ? x.name : uid) + '’s access to ' + (p.projectName || 'this project') + '?')) return;
      var idx = (DB.userProjects || []).findIndex(function (r) { return r.userId === uid && r.projectId === pid; });
      if (idx >= 0) DB.userProjects.splice(idx, 1);
      auditLog(currentUser().id, 'REVOKE', 'User-Project', (x ? x.name : uid) + ' -> ' + (p.projectName || pid), 'invited', '');
      save();
      toast('Invitation revoked.');
      window._projectDetailTab = 'access';
      renderProjectDetail(currentUser());
    },
    showAddCategoryPD: function(pid) {
      var p = project(pid);
      var modal = '<div class="modal" style="max-width:460px;"><div class="m-hd"><h2>New Category — ' + esc(p.projectName || '') + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd"><div class="form-grid">' +
        '<div class="field"><label>Category Name <span class="req">*</span></label><input id="catName" placeholder="e.g. Payroll Run"></div>' +
        '<div class="field"><label>Description</label><input id="catDesc" placeholder="Guidance text shown in LOV…"></div>' +
        '</div><p class="muted" style="font-size:12px;">Scoped to ' + esc(p.projectName || '') + ' (' + esc(company(p.companyId).name || '') + ') — same CATEGORIES table as the global registry.</p>' +
        '</div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doAddCategoryPD(\'' + pid + '\')">&#10133; Create Category</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doAddCategoryPD: function(pid) {
      var name = document.getElementById('catName').value.trim();
      if (!name) { alert('Category name is required.'); return; }
      var p = project(pid);
      var desc = document.getElementById('catDesc').value.trim();
      DB.categories.push({ id: 'cat' + Date.now(), name: name, companyId: p.companyId, projectId: pid, description: desc, status: 'Active' });
      auditLog(currentUser().id, 'CREATE', 'Category', name, '', (p.projectName || pid) + ' (project-specific)');
      save();
      sd.closeModal();
      toast('Category "' + name + '" created for ' + (p.projectName || 'project') + '.');
      window._projectDetailTab = 'cats';
      renderProjectDetail(currentUser());
    },

    // SLA policy editing (all four severity rows in one modal; blast radius shown up front)
    showEditSlaPolicy: function(policyId) {
      var sp = (DB.slaPolicies || []).find(function (x) { return x.id === policyId; });
      if (!sp) return;
      var usedBy = slaPolicyProjects(sp.id);
      var targetFields = (sp.targets || []).map(function (t) {
        return '<tr><td style="white-space:nowrap;">' + sevBadge(t.severity) + '</td>' +
          '<td><input id="slaResp-' + t.severity + '" type="number" min="1" style="width:70px;" value="' + t.responseHours + '"> h</td>' +
          '<td><input id="slaRes-' + t.severity + '" type="number" min="1" style="width:70px;" value="' + t.resolutionDays + '"> d</td>' +
          '<td><input id="slaEsc-' + t.severity + '" type="number" min="1" max="100" style="width:70px;" value="' + (t.escalationPct || 80) + '"> %</td></tr>';
      }).join('');
      var modal = '<div class="modal" style="max-width:560px;"><div class="m-hd"><h2>Edit SLA Policy \u2014 ' + esc(sp.name) + '</h2><span class="x" onclick="sd.closeModal()">&#10005;</span></div>' +
        '<div class="m-bd">' +
        '<p class="mt-0" style="font-size:12.5px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:4px;padding:6px 10px;">&#9888; Used by <b>' + usedBy.length + ' project' + (usedBy.length === 1 ? '' : 's') + '</b>' +
        (usedBy.length ? ' (' + usedBy.map(function (p) { return esc(p.projectKey); }).join(', ') + ')' : '') +
        ' \u2014 changes apply to all of them for newly created tickets.</p>' +
        '<table class="t"><thead><tr><th>Severity</th><th>Response</th><th>Resolution</th><th>Escalation</th></tr></thead><tbody>' + targetFields + '</tbody></table>' +
        '<div class="form-grid" style="margin-top:10px;">' +
        '<div class="field"><label>Effective From</label><input id="slaEffective" type="date" value="' + (sp.effectiveFrom || '') + '"></div>' +
        '<div class="field"><label>Notes</label><input id="slaNotes" value="' + esc(sp.notes || '') + '" placeholder="Contract reference, amendment notes\u2026"></div>' +
        '</div></div><div class="m-ft"><button class="btn" onclick="sd.closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="sd.doEditSlaPolicy(\'' + sp.id + '\')">Save Changes</button></div></div>';
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = modal;
      document.body.appendChild(wrap);
    },
    doEditSlaPolicy: function(policyId) {
      var sp = (DB.slaPolicies || []).find(function (x) { return x.id === policyId; });
      if (!sp) return;
      var newTargets = [];
      for (var i = 0; i < (sp.targets || []).length; i++) {
        var t = sp.targets[i];
        var resp = parseInt(document.getElementById('slaResp-' + t.severity).value);
        var res = parseInt(document.getElementById('slaRes-' + t.severity).value);
        var esc2 = parseInt(document.getElementById('slaEsc-' + t.severity).value);
        if (!resp || !res || !esc2 || resp < 1 || res < 1 || esc2 < 1 || esc2 > 100) { alert(t.severity + ': all fields must be valid positive numbers (escalation 1-100%).'); return; }
        newTargets.push({ severity: t.severity, responseHours: resp, resolutionDays: res, escalationPct: esc2 });
      }
      var summarize = function (targets) {
        return targets.map(function (t) { return t.severity.charAt(0) + ':' + t.responseHours + 'h/' + t.resolutionDays + 'd/' + t.escalationPct + '%'; }).join(' ');
      };
      var oldVal = summarize(sp.targets || []);
      sp.targets = newTargets;
      sp.effectiveFrom = document.getElementById('slaEffective').value || sp.effectiveFrom;
      sp.notes = document.getElementById('slaNotes').value;
      sp.approvedBy = currentUser().id;
      auditLog(currentUser().id, 'UPDATE', 'SLA Policy', sp.name + ' (' + slaPolicyProjects(sp.id).length + ' projects)', oldVal, summarize(newTargets));
      save();
      sd.closeModal();
      toast('SLA policy "' + sp.name + '" updated.');
      renderSlaTargets(currentUser());
    },
    // Change which policy a project runs on (Project Detail SLA tab \u2014 the one door)
    changeProjectSlaPolicy: function(pid, policyId) {
      var p = project(pid);
      if (!p) return;
      var oldPol = slaPolicyFor(pid);
      p.slaPolicyId = policyId || null;
      var newPol = slaPolicyFor(pid);
      auditLog(currentUser().id, 'UPDATE', 'Project SLA Policy', p.projectKey + ' (' + company(p.companyId).name + ')',
        (oldPol ? oldPol.name : '\u2014'), (newPol ? newPol.name : '\u2014') + (p.slaPolicyId ? '' : ' (default)'));
      save();
      toast(p.projectKey + ' now runs on the ' + (newPol ? newPol.name : '\u2014') + ' policy (new tickets only).');
      window._projectDetailTab = 'sla';
      renderProjectDetail(currentUser());
    },
    // Globally unique, company-prefixed project key (Jira/ConnectWise pattern)
    makeProjectKey: function(companyName, base) {
      var code = (companyName || '').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/)[0].toUpperCase().slice(0, 4) || 'PRJ';
      var key = code + '-' + base, n = 2;
      while ((DB.projects || []).some(function (p) { return p.projectKey === key; })) { key = code + n + '-' + base; n++; }
      return key;
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
    filterAuditLog: function() {
      var searchInp = document.querySelector('#ig-audit-wrap .ir-search input');
      var term = searchInp ? searchInp.value.toLowerCase() : '';
      var actionFilter = document.getElementById('audit-action-filter');
      var entityFilter = document.getElementById('audit-entity-filter');
      var dateFrom = document.getElementById('audit-date-from');
      var dateTo = document.getElementById('audit-date-to');
      var action = actionFilter ? actionFilter.value : 'all';
      var entity = entityFilter ? entityFilter.value : 'all';
      var from = dateFrom && dateFrom.value ? new Date(dateFrom.value + 'T00:00:00').getTime() : 0;
      var to = dateTo && dateTo.value ? new Date(dateTo.value + 'T23:59:59').getTime() : Infinity;
      var rows = document.querySelectorAll('#ig-audit tbody tr'), shown = 0;
      rows.forEach(function (r) {
        var rAction = r.getAttribute('data-audit-action') || '';
        var rEntity = r.getAttribute('data-audit-entity') || '';
        var rTs = r.getAttribute('data-audit-ts') || '';
        var tsMs = rTs ? new Date(rTs).getTime() : 0;
        var matchAction = (action === 'all' || rAction === action);
        var matchEntity = (entity === 'all' || rEntity === entity);
        var matchDate = (tsMs >= from && tsMs <= to);
        var matchText = !term || r.textContent.toLowerCase().indexOf(term) >= 0;
        var show = matchAction && matchEntity && matchDate && matchText;
        r.style.display = show ? '' : 'none';
        if (show) shown++;
      });
      var countEl = document.getElementById('audit-row-count');
      if (countEl) countEl.textContent = shown + ' rows';
    },
    clearAuditFilters: function() {
      var searchInp = document.querySelector('#ig-audit-wrap .ir-search input');
      if (searchInp) searchInp.value = '';
      var actionFilter = document.getElementById('audit-action-filter');
      if (actionFilter) actionFilter.value = 'all';
      var entityFilter = document.getElementById('audit-entity-filter');
      if (entityFilter) entityFilter.value = 'all';
      var dateFrom = document.getElementById('audit-date-from');
      if (dateFrom) dateFrom.value = '';
      var dateTo = document.getElementById('audit-date-to');
      if (dateTo) dateTo.value = '';
      sd.filterAuditLog();
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
      case 'projects': renderProjects(u); break;
      case 'users': renderUsers(u); break;
      case 'categories': renderCategories(u); break;
      case 'sla-targets': renderSlaTargets(u); break;
      case 'agent-companies': renderAgentProjects(u); break;
      case 'company-detail': renderCompanyDetail(u); break;
      case 'project-detail': renderProjectDetail(u); break;
      case 'audit-log': renderAuditLog(u); break;
      case 'profile': renderProfile(u); break;
      default: renderHome(u);
    }
    var f = sessionStorage.getItem('flash');
    if (f) { toast(f); sessionStorage.removeItem('flash'); }
  }
  // Never leave a silent blank page: paint any boot error where the user can see it.
  function bootSafe() {
    try { boot(); }
    catch (e) {
      document.body.innerHTML =
        '<div style="max-width:720px;margin:60px auto;padding:24px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;font:14px/1.5 sans-serif;">' +
        '<h2 style="margin-top:0;color:#b91c1c;">Demo failed to render</h2>' +
        '<p><b>' + esc(e.message || String(e)) + '</b></p>' +
        '<pre style="white-space:pre-wrap;font-size:11px;color:#666;">' + esc(e.stack || '') + '</pre>' +
        '<p>Try a hard refresh (<b>Ctrl+F5</b>). If that does not help, ' +
        '<a href="#" onclick="localStorage.clear();location.href=\'01-login.html\';return false;">reset the demo data</a>.</p></div>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootSafe); else bootSafe();
})();
