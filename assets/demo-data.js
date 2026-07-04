/* =========================================================================
   demo-data.js — seed dataset for the ServiceDesk interactive demo.
   This is a CLIENT-SIDE simulation for demonstrating the workflow only.
   It is NOT real data and NOT real security. Real auth + tenant isolation
   are built in Oracle APEX (application items + WHERE company_id filters
   + authorization schemes).

   Updated to match the latest brief (2026-07-04):
   - Decision O: PROJECTS layer between COMPANIES and TICKETS
   - Decision M revised 2026-07-04: tier is per agent-project mapping (AGENT_PROJECTS.tier)
   - Decision N revised: project-scoped client visibility (not department-scoped)
   - Decision P: multi-role support (userRoles array)
   - AGENT_PROJECTS replaces AGENT_COMPANIES (maps agents to projects, not companies)
   - USER_PROJECTS for client access control (empty = all company projects)
   - SLA targets keyed on projectId (not companyId)
   - Severity (client-set) vs Priority (support-set, nullable) — Decision K
   - Severity values: Critical/Major/Minor/Low
   - Ticket type INCIDENT / SERVICE_REQUEST — FR-30
   - Per-project SLA targets with escalationPct — FR-23 / FR-35
   - First-response tracking (firstResponseAt) — FR-31
   - Resolution code + summary on resolve — FR-36
   - Reopen count tracking
   - CSAT score field (FR-27)
   ========================================================================= */
window.DEMO_SEED = {
  companies: [
    { id: 'C0', name: 'Northwind IT',  status: 'Active' },
    { id: 'C1', name: 'Acme Corp',     status: 'Active' },
    { id: 'C2', name: 'Globex Ltd',    status: 'Active' },
    { id: 'C3', name: 'Initech',       status: 'Active' },
    { id: 'C4', name: 'Umbrella Inc',  status: 'Inactive' }
  ],

  // Decision O: PROJECTS layer between COMPANIES and TICKETS.
  // Each company has one or more service-engagement projects.
  // Tickets, SLA targets, agent mappings, and client access are all scoped to projects.
  // Decision Q: visibility = 'OPEN' (whole company sees it) or 'RESTRICTED'
  // (invitation-only via userProjects — e.g. an app still in testing, or HR/payroll).
  projects: [
    // projectKey is GLOBALLY UNIQUE and company-prefixed (Jira/ConnectWise pattern) —
    // it disambiguates same-named projects across companies in every LOV/report.
    // slaPolicyId assigns a named SLA policy (see slaPolicies below); null = default policy.
    { id: 'P1', companyId: 'C1', projectName: 'IT Support',      projectKey: 'ACME-IT',  slaPolicyId: 'SLP2', description: 'General IT support for Acme Corp',              visibility: 'OPEN',       isActive: true, createdAt: '2026-01-15T00:00:00' },
    { id: 'P2', companyId: 'C1', projectName: 'ERP Systems',     projectKey: 'ACME-ERP', slaPolicyId: 'SLP1', description: 'ERP platform maintenance and support',          visibility: 'OPEN',       isActive: true, createdAt: '2026-03-01T00:00:00' },
    { id: 'P3', companyId: 'C2', projectName: 'IT Support',      projectKey: 'GLBX-IT',  slaPolicyId: 'SLP3', description: 'General IT support for Globex Ltd',              visibility: 'OPEN',       isActive: true, createdAt: '2026-03-15T00:00:00' },
    { id: 'P4', companyId: 'C2', projectName: 'CRM Platform',    projectKey: 'GLBX-CRM', slaPolicyId: 'SLP3', description: 'CRM integration and support',                   visibility: 'OPEN',       isActive: true, createdAt: '2026-04-01T00:00:00' },
    { id: 'P5', companyId: 'C3', projectName: 'IT Support',      projectKey: 'INIT-IT',  slaPolicyId: 'SLP2', description: 'General IT support for Initech',                 visibility: 'OPEN',       isActive: true, createdAt: '2026-06-01T00:00:00' },
    { id: 'P6', companyId: 'C0', projectName: 'Internal Apps',   projectKey: 'NW-APPS',  slaPolicyId: 'SLP4', description: 'Internal application support for Northwind IT',  visibility: 'OPEN',       isActive: true, createdAt: '2026-01-01T00:00:00' },
    { id: 'P7', companyId: 'C0', projectName: 'Infrastructure',  projectKey: 'NW-INFRA', slaPolicyId: 'SLP4', description: 'Network and server infrastructure',              visibility: 'OPEN',       isActive: true, createdAt: '2026-01-01T00:00:00' },
    { id: 'P8', companyId: 'C0', projectName: 'HR System Pilot', projectKey: 'NW-HR',    slaPolicyId: null,   description: 'New HR platform — pilot phase, invited testers only', visibility: 'RESTRICTED', isActive: true, createdAt: '2026-06-20T00:00:00' }
  ],

  // Decision N: departments per company (metadata only — not a visibility filter)
  departments: [
    { id: 'dep0', companyId: 'C0', name: 'Internal Systems' },
    { id: 'dep1', companyId: 'C1', name: 'Finance' },
    { id: 'dep2', companyId: 'C1', name: 'IT' },
    { id: 'dep3', companyId: 'C2', name: 'Operations' },
    { id: 'dep4', companyId: 'C2', name: 'HR' },
    { id: 'dep5', companyId: 'C3', name: 'Engineering' },
    { id: 'dep6', companyId: 'C3', name: 'Support' }
  ],

  // password is 'demo' for every account (prefilled on the login screen)
  // Decision M revised 2026-07-04: tier is NOT here — it lives on each
  //   agentProjects mapping (per-project proficiency).
  // Decision P: role is the user's default/landing role. Full role list in userRoles[].
  // departmentId: links client users to their department (metadata), null for vendor users
  // status: Active/Inactive — FR-6 deactivation support
  // lastLogin: ISO timestamp of last login — ISO §6.6 access review
  users: [
    { id: 'u1', name: 'Sara Admin',   email: 'sara@northwind.example',  password: 'demo', role: 'System Admin',  companyId: 'C0', departmentId: null,   status: 'Active', lastLogin: '2026-07-03T08:15:00' },
    { id: 'u2', name: 'Mike Ops',     email: 'mike@northwind.example',  password: 'demo', role: 'Support Agent', companyId: 'C0', departmentId: null,   status: 'Active', lastLogin: '2026-07-03T07:50:00' },
    { id: 'u3', name: 'Lee Tech',     email: 'lee@northwind.example',   password: 'demo', role: 'Support Agent', companyId: 'C0', departmentId: null,   status: 'Active', lastLogin: '2026-07-02T16:30:00' },
    { id: 'u4', name: 'Anna Nguyen',  email: 'anna@acme.example',       password: 'demo', role: 'Client User',   companyId: 'C1', departmentId: 'dep1', status: 'Active', lastLogin: '2026-07-03T09:00:00' },
    { id: 'u5', name: 'Bob Reyes',    email: 'bob@acme.example',        password: 'demo', role: 'Client Admin',  companyId: 'C1', departmentId: 'dep2', status: 'Active', lastLogin: '2026-07-02T14:20:00' },
    { id: 'u6', name: 'Carla Vidal',  email: 'carla@globex.example',    password: 'demo', role: 'Client Admin',  companyId: 'C2', departmentId: 'dep3', status: 'Active', lastLogin: '2026-07-01T11:00:00' },
    { id: 'u7', name: 'Dan Yu',       email: 'dan@globex.example',      password: 'demo', role: 'Client User',   companyId: 'C2', departmentId: 'dep4', status: 'Active', lastLogin: '2026-07-03T08:45:00' },
    { id: 'u8', name: 'Eve Park',     email: 'eve@initech.example',     password: 'demo', role: 'Client User',   companyId: 'C3', departmentId: 'dep5', status: 'Active', lastLogin: '2026-06-30T10:15:00' },
    { id: 'u9',  name: 'Nora Syed',    email: 'nora@northwind.example',  password: 'demo', role: 'Support Agent', companyId: 'C0', departmentId: null,   status: 'Active', lastLogin: '2026-07-03T08:00:00' },
    { id: 'u10', name: 'Raj Patel',    email: 'raj@northwind.example',   password: 'demo', role: 'Support Agent', companyId: 'C0', departmentId: null,   status: 'Active', lastLogin: '2026-07-02T17:00:00' },
    { id: 'u11', name: 'Kim Tanaka',   email: 'kim@northwind.example',   password: 'demo', role: 'Support Agent', companyId: 'C0', departmentId: null,   status: 'Active', lastLogin: '2026-07-01T09:30:00' },
    { id: 'u12', name: 'Omar Hassan',  email: 'omar@northwind.example',  password: 'demo', role: 'Support Agent', companyId: 'C0', departmentId: null,   status: 'Active', lastLogin: '2026-06-28T15:00:00' },
    { id: 'u13', name: 'Fay Wong',     email: 'fay@acme.example',        password: 'demo', role: 'Client User',   companyId: 'C1', departmentId: 'dep2', status: 'Active', lastLogin: '2026-07-02T09:45:00' },
    { id: 'u14', name: 'Tom Grant',    email: 'tom@globex.example',      password: 'demo', role: 'Client User',   companyId: 'C2', departmentId: 'dep3', status: 'Inactive', lastLogin: '2026-06-15T10:00:00' },
    { id: 'u15', name: 'Lily Chen',    email: 'lily@initech.example',    password: 'demo', role: 'Client Admin',  companyId: 'C3', departmentId: 'dep5', status: 'Active', lastLogin: '2026-07-03T07:30:00' },
    { id: 'u16', name: 'Zack Osman',   email: 'zack@initech.example',    password: 'demo', role: 'Client User',   companyId: 'C3', departmentId: 'dep6', status: 'Active', lastLogin: '2026-06-29T14:00:00' },
    { id: 'u17', name: 'Nora Syed (Int)',  email: 'nora-int@northwind.example', password: 'demo', role: 'Client Admin',  companyId: 'C0', departmentId: 'dep0', status: 'Active', lastLogin: '2026-07-03T08:00:00' },
    { id: 'u18', name: 'Nick Farrow',      email: 'nick@northwind.example',     password: 'demo', role: 'Client User',   companyId: 'C0', departmentId: 'dep0', status: 'Active', lastLogin: '2026-07-02T16:00:00' }
  ],

  // Decision P: multi-role support. Each user can hold multiple roles.
  // Decision Q: every Northwind (provider) user is auto-granted CLIENT_USER at
  // creation — every employee is a potential internal requester. That's why all
  // Northwind agents (and Sara) carry CLIENT_USER alongside their work role.
  // The user's `role` field above is the default/landing role at login;
  // the nav-bar role-switcher uses this array to offer alternatives.
  userRoles: [
    { userId: 'u1',  role: 'SYSTEM_ADMIN' },
    { userId: 'u1',  role: 'CLIENT_USER' },
    { userId: 'u2',  role: 'SUPPORT_AGENT' },
    { userId: 'u2',  role: 'CLIENT_USER' },
    { userId: 'u3',  role: 'SUPPORT_AGENT' },
    { userId: 'u3',  role: 'CLIENT_USER' },
    { userId: 'u4',  role: 'CLIENT_USER' },
    { userId: 'u5',  role: 'CLIENT_ADMIN' },
    { userId: 'u6',  role: 'CLIENT_ADMIN' },
    { userId: 'u7',  role: 'CLIENT_USER' },
    { userId: 'u8',  role: 'CLIENT_USER' },
    { userId: 'u9',  role: 'SUPPORT_AGENT' },
    { userId: 'u9',  role: 'CLIENT_USER' },
    { userId: 'u10', role: 'SUPPORT_AGENT' },
    { userId: 'u10', role: 'CLIENT_USER' },
    { userId: 'u11', role: 'SUPPORT_AGENT' },
    { userId: 'u11', role: 'CLIENT_USER' },
    { userId: 'u12', role: 'SUPPORT_AGENT' },
    { userId: 'u12', role: 'CLIENT_USER' },
    { userId: 'u13', role: 'CLIENT_USER' },
    { userId: 'u14', role: 'CLIENT_USER' },
    { userId: 'u15', role: 'CLIENT_ADMIN' },
    { userId: 'u16', role: 'CLIENT_USER' },
    { userId: 'u17', role: 'CLIENT_ADMIN' },
    { userId: 'u18', role: 'CLIENT_USER' }
  ],

  // Which projects each Support Agent covers, and at what tier (Decision O +
  // Decision I revised + Decision M revised 2026-07-04: tier is PER MAPPING —
  // per-project proficiency, so one agent can be L3 on one project, L2 on another).
  // System Admin is intentionally absent: admins see every project by role.
  // In APEX this is a join table (AGENT_PROJECTS: user_id + project_id + tier).
  agentProjects: [
    { userId: 'u2',  projectId: 'P1', tier: 'L2' },   // Mike covers Acme IT Support
    { userId: 'u2',  projectId: 'P3', tier: 'L2' },   // Mike covers Globex IT Support
    { userId: 'u2',  projectId: 'P6', tier: 'L2' },   // Mike covers Northwind Internal Apps
    { userId: 'u3',  projectId: 'P1', tier: 'L2' },   // Lee covers Acme IT Support
    { userId: 'u3',  projectId: 'P2', tier: 'L2' },   // Lee covers Acme ERP
    { userId: 'u3',  projectId: 'P5', tier: 'L2' },   // Lee covers Initech IT Support
    { userId: 'u3',  projectId: 'P6', tier: 'L2' },   // Lee covers Northwind Internal Apps
    { userId: 'u9',  projectId: 'P1', tier: 'L1' },   // Nora covers Acme IT Support
    { userId: 'u9',  projectId: 'P2', tier: 'L1' },   // Nora (L1) — first-line on Acme ERP (L1 gate, Flow 3)
    { userId: 'u9',  projectId: 'P3', tier: 'L1' },   // Nora (L1) — first-line on Globex IT Support
    { userId: 'u9',  projectId: 'P5', tier: 'L1' },   // Nora covers Initech IT Support
    { userId: 'u9',  projectId: 'P6', tier: 'L1' },   // Nora (L1) — first-line on Northwind Internal Apps
    { userId: 'u9',  projectId: 'P7', tier: 'L1' },   // Nora (L1) — first-line on Northwind Infrastructure
    // NOTE: P4 (Globex CRM) deliberately has NO L1 — demos the red "no L1" gate badge
    { userId: 'u10', projectId: 'P3', tier: 'L2' },   // Raj covers Globex IT Support
    { userId: 'u10', projectId: 'P4', tier: 'L2' },   // Raj covers Globex CRM
    { userId: 'u10', projectId: 'P5', tier: 'L3' },   // Raj covers Initech IT Support — SENIOR here (per-project tier demo: L2 elsewhere)
    { userId: 'u11', projectId: 'P1', tier: 'L3' },   // Kim covers Acme IT Support
    { userId: 'u11', projectId: 'P3', tier: 'L3' },   // Kim covers Globex IT Support
    { userId: 'u11', projectId: 'P5', tier: 'L3' },   // Kim covers Initech IT Support
    { userId: 'u12', projectId: 'P1', tier: 'L4' },   // Omar covers Acme (all projects)
    { userId: 'u12', projectId: 'P2', tier: 'L4' },
    { userId: 'u12', projectId: 'P3', tier: 'L4' },   // Omar covers Globex (all projects)
    { userId: 'u12', projectId: 'P4', tier: 'L4' },
    { userId: 'u12', projectId: 'P5', tier: 'L4' },   // Omar covers Initech
    { userId: 'u2',  projectId: 'P7', tier: 'L2' },   // Mike covers Northwind Infrastructure
    { userId: 'u3',  projectId: 'P7', tier: 'L2' },   // Lee covers Northwind Infrastructure
    { userId: 'u9',  projectId: 'P8', tier: 'L1' }    // Nora (L1) covers the HR System Pilot (L1 gate — Flow 3)
  ],

  // Decision Q: USER_PROJECTS is an INVITATION list (semantic flip from decision N).
  // A client-side user sees all OPEN projects of their company automatically,
  // plus any RESTRICTED projects they have a row for here. Rows GRANT access
  // (never restrict). Managed by the Client Admin.
  // Nick is an invited tester on the restricted HR System Pilot (P8);
  // Northwind agents are NOT invited — in client mode they can't see it.
  userProjects: [
    { userId: 'u18', projectId: 'P8' }
  ],

  // Categories: companyId null = global, set = company-specific (hybrid model per brief §5)
  // projectId: null = available to all projects in that company (or globally); set = project-specific
  // description = guidance text shown in the LOV
  categories: [
    { id: 'cat1', name: 'Network',          companyId: null, projectId: null, description: 'Network connectivity, DNS, VPN, firewall issues', status: 'Active' },
    { id: 'cat2', name: 'Hardware',          companyId: null, projectId: null, description: 'Physical device faults — laptops, printers, peripherals', status: 'Active' },
    { id: 'cat3', name: 'Software',          companyId: null, projectId: null, description: 'Application errors, crashes, bugs, license issues', status: 'Active' },
    { id: 'cat4', name: 'Access / Account',  companyId: null, projectId: null, description: 'Password resets, permission changes, account provisioning', status: 'Active' },
    { id: 'cat5', name: 'Request',           companyId: null, projectId: null, description: 'General service requests not covered by other categories', status: 'Active' },
    { id: 'cat6', name: 'ERP / Finance',     companyId: 'C1', projectId: 'P2', description: 'Acme-specific ERP and financial system issues', status: 'Active' },
    { id: 'cat7', name: 'CRM Integration',   companyId: 'C2', projectId: 'P4', description: 'Globex CRM platform and integration issues', status: 'Active' }
  ],

  // Decision K: severity (client-set, business impact) vs priority (support-set, work order)
  severities: ['Critical', 'Major', 'Minor', 'Low'],
  priorities: ['P1', 'P2', 'P3', 'P4'],
  statuses:   ['New', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed'],

  // FR-30: ITIL ticket type distinction
  ticketTypes: ['INCIDENT', 'SERVICE_REQUEST'],

  // FR-36: Resolution codes for resolved/closed tickets
  resolutionCodes: ['FIXED', 'WORKAROUND', 'KNOWN_ERROR', 'CANNOT_REPRODUCE', 'DUPLICATE', 'USER_EDUCATION', 'NOT_AN_INCIDENT'],

  // FR-23: Named SLA policies (industry pattern: Zendesk SLA policies, Autotask/Halo
  // SLA templates, ServiceNow SLA definitions). A policy carries per-severity targets;
  // projects are ASSIGNED a policy (PROJECTS.slaPolicyId) instead of owning target rows.
  // isDefault marks the fallback for projects with no assignment (e.g. P8).
  // sla_due_date = created_at + resolutionDays; escalationPct = FR-35 threshold.
  slaPolicies: [
    { id: 'SLP1', name: 'Gold', isDefault: false, description: 'Premium contract tier — tightest resolution for business-critical systems',
      effectiveFrom: '2026-03-01', approvedBy: 'u1', notes: 'Acme ERP contract addendum #2',
      targets: [
        { severity: 'Critical', responseHours: 1,  resolutionDays: 1,  escalationPct: 75 },
        { severity: 'Major',    responseHours: 4,  resolutionDays: 2,  escalationPct: 75 },
        { severity: 'Minor',    responseHours: 8,  resolutionDays: 5,  escalationPct: 80 },
        { severity: 'Low',      responseHours: 24, resolutionDays: 14, escalationPct: 80 }
      ] },
    { id: 'SLP2', name: 'Standard', isDefault: true, description: 'Default service tier — applies when a project has no policy assigned',
      effectiveFrom: '2026-01-01', approvedBy: 'u1', notes: '',
      targets: [
        { severity: 'Critical', responseHours: 1,  resolutionDays: 1,  escalationPct: 80 },
        { severity: 'Major',    responseHours: 4,  resolutionDays: 3,  escalationPct: 80 },
        { severity: 'Minor',    responseHours: 8,  resolutionDays: 7,  escalationPct: 80 },
        { severity: 'Low',      responseHours: 24, resolutionDays: 14, escalationPct: 80 }
      ] },
    { id: 'SLP3', name: 'Bronze', isDefault: false, description: 'Relaxed tier for lower-urgency engagements',
      effectiveFrom: '2026-03-15', approvedBy: 'u1', notes: 'Globex master services agreement',
      targets: [
        { severity: 'Critical', responseHours: 2,  resolutionDays: 1,  escalationPct: 75 },
        { severity: 'Major',    responseHours: 8,  resolutionDays: 5,  escalationPct: 75 },
        { severity: 'Minor',    responseHours: 16, resolutionDays: 10, escalationPct: 75 },
        { severity: 'Low',      responseHours: 48, resolutionDays: 21, escalationPct: 75 }
      ] },
    { id: 'SLP4', name: 'Internal', isDefault: false, description: 'Northwind internal systems — early escalation, no contractual penalty',
      effectiveFrom: '2026-01-01', approvedBy: 'u1', notes: 'Internal OLA, not a customer SLA',
      targets: [
        { severity: 'Critical', responseHours: 1,  resolutionDays: 1,  escalationPct: 90 },
        { severity: 'Major',    responseHours: 4,  resolutionDays: 3,  escalationPct: 90 },
        { severity: 'Minor',    responseHours: 8,  resolutionDays: 7,  escalationPct: 90 },
        { severity: 'Low',      responseHours: 24, resolutionDays: 14, escalationPct: 90 }
      ] }
  ],

  // createdAt/updatedAt are ISO strings; relative time is computed at runtime.
  // severity = client-set (required at creation); priority = support-set (nullable until triaged)
  // projectId = scopes ticket to a service engagement (Decision O)
  // slaDueDate = stamped at creation from SLA_TARGETS based on severity + project
  // csatScore = null until requester rates after closure (FR-27)
  // ticketType = INCIDENT or SERVICE_REQUEST (FR-30)
  // firstResponseAt = timestamp of first agent response (FR-31), null if no response yet
  // resolutionCode + resolutionSummary = required on resolve (FR-36), null until resolved
  // reopenCount = number of times ticket was reopened
  // departmentId = stamped from creator's department (metadata, Decision N)
  tickets: [
    { id:'t51', ref:'TKT-00051', companyId:'C1', projectId:'P2', departmentId:'dep1', subject:'Production DB connection pool exhausted', description:'The ERP is throwing connection errors during peak hours. Finance cannot post invoices.', categoryId:'cat3', severity:'Critical', priority:null, status:'New', ticketType:'INCIDENT', createdBy:'u4', assignedTo:null, createdAt:'2026-06-30T08:55:00', updatedAt:'2026-06-30T08:55:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-01T08:55:00', csatScore:null, firstResponseAt:null, resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t50', ref:'TKT-00050', companyId:'C2', projectId:'P3', departmentId:'dep4', subject:'SSO login fails for new staff', description:'Three new Globex employees cannot sign in via SSO. Existing users are fine.', categoryId:'cat4', severity:'Major', priority:'P2', status:'Assigned', ticketType:'INCIDENT', createdBy:'u7', assignedTo:'u2', createdAt:'2026-06-30T08:38:00', updatedAt:'2026-06-30T08:40:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-03T08:38:00', csatScore:null, firstResponseAt:null, resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t48', ref:'TKT-00048', companyId:'C3', projectId:'P5', departmentId:'dep5', subject:'Invoice PDF shows wrong currency', description:'Exported invoices show USD instead of MYR for Initech accounts.', categoryId:'cat3', severity:'Major', priority:'P2', status:'In Progress', ticketType:'INCIDENT', createdBy:'u8', assignedTo:'u3', createdAt:'2026-06-29T15:10:00', updatedAt:'2026-06-30T07:30:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-02T15:10:00', csatScore:null, firstResponseAt:'2026-06-30T07:30:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t42', ref:'TKT-00042', companyId:'C1', projectId:'P1', departmentId:'dep1', subject:'VPN disconnects every few minutes', description:'Finance team on the Acme network reports the VPN dropping every 3-5 minutes since this morning.', categoryId:'cat1', severity:'Major', priority:'P3', status:'In Progress', ticketType:'INCIDENT', createdBy:'u4', assignedTo:'u2', createdAt:'2026-06-30T01:14:00', updatedAt:'2026-06-30T01:38:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-03T01:14:00', csatScore:null, firstResponseAt:'2026-06-30T01:40:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t41', ref:'TKT-00041', companyId:'C1', projectId:'P1', departmentId:'dep2', subject:'Request: provision 5 new mailboxes', description:'Need 5 new email mailboxes for incoming Acme interns.', categoryId:'cat5', severity:'Minor', priority:null, status:'New', ticketType:'SERVICE_REQUEST', createdBy:'u5', assignedTo:null, createdAt:'2026-06-29T22:00:00', updatedAt:'2026-06-29T22:00:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-06T22:00:00', csatScore:null, firstResponseAt:null, resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t39', ref:'TKT-00039', companyId:'C1', projectId:'P2', departmentId:'dep1', subject:'Cannot export monthly report to PDF', description:'The export button spins forever and never produces a PDF.', categoryId:'cat3', severity:'Minor', priority:'P3', status:'Resolved', ticketType:'INCIDENT', createdBy:'u4', assignedTo:'u3', createdAt:'2026-06-28T09:00:00', updatedAt:'2026-06-29T16:00:00', resolvedAt:'2026-06-29T16:00:00', closedAt:null, slaDueDate:'2026-06-28T17:00:00', csatScore:null, firstResponseAt:'2026-06-29T16:00:00', resolutionCode:'FIXED', resolutionSummary:'Fixed the PDF export timeout by increasing the server-side report generation limit.', reopenCount:0 },
    { id:'t38', ref:'TKT-00038', companyId:'C2', projectId:'P3', departmentId:'dep4', subject:'Printer on 3rd floor offline', description:'Shared printer GLOBEX-P3 is not reachable.', categoryId:'cat2', severity:'Low', priority:'P4', status:'On Hold', ticketType:'INCIDENT', createdBy:'u7', assignedTo:'u2', createdAt:'2026-06-27T11:20:00', updatedAt:'2026-06-29T10:00:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-11T11:20:00', csatScore:null, firstResponseAt:'2026-06-29T10:00:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t35', ref:'TKT-00035', companyId:'C1', projectId:'P1', departmentId:'dep2', subject:'New laptop setup for finance hire', description:'Provision and image a laptop for a new Acme finance staff member.', categoryId:'cat2', severity:'Minor', priority:'P3', status:'Closed', ticketType:'SERVICE_REQUEST', createdBy:'u5', assignedTo:'u2', createdAt:'2026-06-24T08:00:00', updatedAt:'2026-06-26T14:00:00', resolvedAt:'2026-06-25T16:00:00', closedAt:'2026-06-26T14:00:00', slaDueDate:'2026-07-01T08:00:00', csatScore:4, firstResponseAt:'2026-06-25T10:00:00', resolutionCode:'FIXED', resolutionSummary:'Laptop provisioned, imaged with standard SOE, and delivered to the new hire.', reopenCount:0 },
    { id:'t31', ref:'TKT-00031', companyId:'C1', projectId:'P1', departmentId:'dep1', subject:'Add new user license', description:'Please add one more licensed seat for the analytics tool.', categoryId:'cat5', severity:'Low', priority:'P4', status:'Closed', ticketType:'SERVICE_REQUEST', createdBy:'u4', assignedTo:'u2', createdAt:'2026-06-20T10:00:00', updatedAt:'2026-06-22T09:00:00', resolvedAt:'2026-06-21T14:00:00', closedAt:'2026-06-22T09:00:00', slaDueDate:'2026-07-04T10:00:00', csatScore:5, firstResponseAt:'2026-06-21T09:00:00', resolutionCode:'FIXED', resolutionSummary:'License seat added to the analytics tool subscription.', reopenCount:0 },
    { id:'t28', ref:'TKT-00028', companyId:'C3', projectId:'P5', departmentId:'dep5', subject:'Email going to spam', description:'Outbound email from Initech domain is landing in client spam folders.', categoryId:'cat1', severity:'Major', priority:'P2', status:'In Progress', ticketType:'INCIDENT', createdBy:'u8', assignedTo:'u3', createdAt:'2026-06-26T13:00:00', updatedAt:'2026-06-30T06:00:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-06-29T13:00:00', csatScore:null, firstResponseAt:'2026-06-27T10:00:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t24', ref:'TKT-00024', companyId:'C2', projectId:'P3', departmentId:'dep3', subject:'Password reset not arriving', description:'Reset emails are delayed by 20+ minutes.', categoryId:'cat4', severity:'Minor', priority:'P3', status:'Resolved', ticketType:'INCIDENT', createdBy:'u6', assignedTo:'u2', createdAt:'2026-06-25T09:30:00', updatedAt:'2026-06-28T12:00:00', resolvedAt:'2026-06-28T12:00:00', closedAt:null, slaDueDate:'2026-06-27T09:30:00', csatScore:null, firstResponseAt:'2026-06-26T14:00:00', resolutionCode:'FIXED', resolutionSummary:'Investigated mail relay configuration — password reset emails were queuing behind bulk marketing sends. Adjusted priority routing rules.', reopenCount:0 },
    { id:'t19', ref:'TKT-00019', companyId:'C1', projectId:'P1', departmentId:'dep2', subject:'Shared drive missing files', description:'A folder on the X: drive appears empty after the weekend.', categoryId:'cat3', severity:'Critical', priority:'P1', status:'Assigned', ticketType:'INCIDENT', createdBy:'u5', assignedTo:'u3', createdAt:'2026-06-29T18:00:00', updatedAt:'2026-06-29T18:30:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-06-30T18:00:00', csatScore:null, firstResponseAt:'2026-06-29T18:30:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t52', ref:'TKT-00052', companyId:'C0', projectId:'P6', departmentId:'dep0', subject:'Internal wiki search broken', description:'The Northwind internal wiki search returns no results for any query since yesterday.', categoryId:'cat3', severity:'Major', priority:null, status:'New', ticketType:'INCIDENT', createdBy:'u18', assignedTo:null, createdAt:'2026-07-02T10:30:00', updatedAt:'2026-07-02T10:30:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-05T10:30:00', csatScore:null, firstResponseAt:null, resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t53', ref:'TKT-00053', companyId:'C0', projectId:'P6', departmentId:'dep0', subject:'Request: new dev environment for QA team', description:'Need a new staging environment provisioned for the QA team internal project.', categoryId:'cat5', severity:'Minor', priority:'P3', status:'In Progress', ticketType:'SERVICE_REQUEST', createdBy:'u17', assignedTo:'u2', createdAt:'2026-07-01T09:00:00', updatedAt:'2026-07-02T14:00:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-08T09:00:00', csatScore:null, firstResponseAt:'2026-07-01T11:00:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 }
  ],

  comments: [
    { id:'c1', ticketId:'t42', userId:'u4', text:'It started this morning. Finance team can\'t reach the ERP.', isInternal:false, createdAt:'2026-06-30T01:14:00' },
    { id:'c2', ticketId:'t42', userId:'u2', text:'Looking into it — checking the VPN concentrator logs now.', isInternal:false, createdAt:'2026-06-30T01:40:00' },
    { id:'c3', ticketId:'t42', userId:'u2', text:'Concentrator showing MTU mismatch after last firmware push.', isInternal:true, createdAt:'2026-06-30T01:42:00' },
    { id:'c4', ticketId:'t48', userId:'u3', text:'Reproduced — currency code is hardcoded in the report template.', isInternal:true, createdAt:'2026-06-30T07:30:00' },
    { id:'c5', ticketId:'t39', userId:'u3', text:'Fixed the export timeout. Please confirm it works for you now.', isInternal:false, createdAt:'2026-06-29T16:00:00' }
  ],

  history: [
    { id:'h1', ticketId:'t42', userId:'u4', action:'STATUS_CHANGE',  oldValue:'',         newValue:'New',         createdAt:'2026-06-30T01:14:00' },
    { id:'h2', ticketId:'t42', userId:'u1', action:'ASSIGN',         oldValue:'',          newValue:'Mike Ops',    createdAt:'2026-06-30T01:30:00' },
    { id:'h3', ticketId:'t42', userId:'u2', action:'STATUS_CHANGE',  oldValue:'Assigned',  newValue:'In Progress', createdAt:'2026-06-30T01:38:00' },
    { id:'h4', ticketId:'t50', userId:'u7', action:'STATUS_CHANGE',  oldValue:'',          newValue:'New',         createdAt:'2026-06-30T08:38:00' },
    { id:'h5', ticketId:'t50', userId:'u1', action:'ASSIGN',         oldValue:'',          newValue:'Mike Ops',    createdAt:'2026-06-30T08:40:00' },
    { id:'h6', ticketId:'t39', userId:'u4', action:'STATUS_CHANGE',  oldValue:'',          newValue:'New',         createdAt:'2026-06-28T09:00:00' },
    { id:'h7', ticketId:'t39', userId:'u3', action:'STATUS_CHANGE',  oldValue:'In Progress', newValue:'Resolved',  createdAt:'2026-06-29T16:00:00' },
    { id:'h8', ticketId:'t42', userId:'u1', action:'PRIORITY_CHANGE', oldValue:'',         newValue:'P3',          createdAt:'2026-06-30T01:32:00' }
  ],

  // FR-25: File/screenshot attachments on tickets and comments (COULD — tenant-scoped).
  // commentId = null means ticket-level; non-null = attached to that comment.
  attachments: [
    { id:'a1', ticketId:'t42', companyId:'C1', commentId:null,  fileName:'vpn-error-log.txt',      mimeType:'text/plain',       fileSize:4200,   uploadedBy:'u4', uploadedAt:'2026-06-30T01:15:00' },
    { id:'a2', ticketId:'t42', companyId:'C1', commentId:null,  fileName:'vpn-disconnect-screenshot.png', mimeType:'image/png', fileSize:184000, uploadedBy:'u4', uploadedAt:'2026-06-30T01:15:00' },
    { id:'a3', ticketId:'t42', companyId:'C1', commentId:'c3',  fileName:'concentrator-mtu-log.pdf', mimeType:'application/pdf', fileSize:62000,  uploadedBy:'u2', uploadedAt:'2026-06-30T01:42:00' },
    { id:'a4', ticketId:'t48', companyId:'C3', commentId:null,  fileName:'invoice-wrong-currency.png', mimeType:'image/png',    fileSize:210000, uploadedBy:'u8', uploadedAt:'2026-06-29T15:12:00' },
    { id:'a5', ticketId:'t19', companyId:'C1', commentId:null,  fileName:'shared-drive-empty-folder.png', mimeType:'image/png', fileSize:95000,  uploadedBy:'u5', uploadedAt:'2026-06-29T18:05:00' }
  ],

  seq: 53 // last ticket number used; next created ticket = 54
};
