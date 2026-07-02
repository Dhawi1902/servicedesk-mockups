/* =========================================================================
   demo-data.js — seed dataset for the ServiceDesk interactive demo.
   This is a CLIENT-SIDE simulation for demonstrating the workflow only.
   It is NOT real data and NOT real security. Real auth + tenant isolation
   are built in Oracle APEX (application items + WHERE company_id filters
   + authorization schemes).

   Updated to match the latest brief (2026-07-02):
   - Severity (client-set) vs Priority (support-set, nullable) — Decision K
   - Severity values: Critical/Major/Minor/Low (was Cosmetic → Low)
   - Agent tiers L1–L4 — Decision M
   - Departments per company — Decision N
   - Ticket type INCIDENT / SERVICE_REQUEST — FR-30
   - Per-company SLA targets with escalationPct — FR-23
   - First-response tracking (firstResponseAt) — FR-31
   - Resolution code + summary on resolve — FR-36
   - Reopen count tracking
   - CSAT score field (FR-27)
   ========================================================================= */
window.DEMO_SEED = {
  companies: [
    { id: 'C0', name: 'Northwind IT',  type: 'VENDOR', status: 'Active' },
    { id: 'C1', name: 'Acme Corp',     type: 'CLIENT', status: 'Active' },
    { id: 'C2', name: 'Globex Ltd',    type: 'CLIENT', status: 'Active' },
    { id: 'C3', name: 'Initech',       type: 'CLIENT', status: 'Active' },
    { id: 'C4', name: 'Umbrella Inc',  type: 'CLIENT', status: 'Inactive' }
  ],

  // Decision N: departments per company
  departments: [
    { id: 'dep1', companyId: 'C1', name: 'Finance' },
    { id: 'dep2', companyId: 'C1', name: 'IT' },
    { id: 'dep3', companyId: 'C2', name: 'Operations' },
    { id: 'dep4', companyId: 'C2', name: 'HR' },
    { id: 'dep5', companyId: 'C3', name: 'Engineering' },
    { id: 'dep6', companyId: 'C3', name: 'Support' }
  ],

  // password is 'demo' for every account (prefilled on the login screen)
  // tier: L1–L4 for Support Agents (Decision M), null for non-agents
  // departmentId: links client users to their department (Decision N), null for vendor users
  users: [
    { id: 'u1', name: 'Sara Admin',   email: 'sara@northwind.example',  password: 'demo', role: 'System Admin',  companyId: 'C0', tier: null, departmentId: null },
    { id: 'u2', name: 'Mike Ops',     email: 'mike@northwind.example',  password: 'demo', role: 'Support Agent', companyId: 'C0', tier: 'L1', departmentId: null },
    { id: 'u3', name: 'Lee Tech',     email: 'lee@northwind.example',   password: 'demo', role: 'Support Agent', companyId: 'C0', tier: 'L2', departmentId: null },
    { id: 'u4', name: 'Anna Nguyen',  email: 'anna@acme.example',       password: 'demo', role: 'Client User',   companyId: 'C1', tier: null, departmentId: 'dep1' },
    { id: 'u5', name: 'Bob Reyes',    email: 'bob@acme.example',        password: 'demo', role: 'Client Admin',  companyId: 'C1', tier: null, departmentId: 'dep2' },
    { id: 'u6', name: 'Carla Vidal',  email: 'carla@globex.example',    password: 'demo', role: 'Client Admin',  companyId: 'C2', tier: null, departmentId: 'dep3' },
    { id: 'u7', name: 'Dan Yu',       email: 'dan@globex.example',      password: 'demo', role: 'Client User',   companyId: 'C2', tier: null, departmentId: 'dep4' },
    { id: 'u8', name: 'Eve Park',     email: 'eve@initech.example',     password: 'demo', role: 'Client User',   companyId: 'C3', tier: null, departmentId: 'dep5' },
    { id: 'u9',  name: 'Nora Syed',    email: 'nora@northwind.example',  password: 'demo', role: 'Support Agent', companyId: 'C0', tier: 'L1', departmentId: null },
    { id: 'u10', name: 'Raj Patel',    email: 'raj@northwind.example',   password: 'demo', role: 'Support Agent', companyId: 'C0', tier: 'L2', departmentId: null },
    { id: 'u11', name: 'Kim Tanaka',   email: 'kim@northwind.example',   password: 'demo', role: 'Support Agent', companyId: 'C0', tier: 'L3', departmentId: null },
    { id: 'u12', name: 'Omar Hassan',  email: 'omar@northwind.example',  password: 'demo', role: 'Support Agent', companyId: 'C0', tier: 'L4', departmentId: null },
    { id: 'u13', name: 'Fay Wong',     email: 'fay@acme.example',        password: 'demo', role: 'Client User',   companyId: 'C1', tier: null, departmentId: 'dep2' },
    { id: 'u14', name: 'Tom Grant',    email: 'tom@globex.example',      password: 'demo', role: 'Client User',   companyId: 'C2', tier: null, departmentId: 'dep3' },
    { id: 'u15', name: 'Lily Chen',    email: 'lily@initech.example',    password: 'demo', role: 'Client Admin',  companyId: 'C3', tier: null, departmentId: 'dep5' },
    { id: 'u16', name: 'Zack Osman',   email: 'zack@initech.example',    password: 'demo', role: 'Client User',   companyId: 'C3', tier: null, departmentId: 'dep6' }
  ],

  // Which CLIENT companies (projects) each Support Agent covers.
  // Agents only see tickets for their assigned projects — this kills the
  // cross-project "noise" (an agent never sees clients they're not on).
  // System Admin is intentionally absent: admins see every company by role.
  // In APEX this is a small join table (AGENT_COMPANIES: user_id + company_id).
  agentCompanies: [
    { userId: 'u2', companyId: 'C1' },   // Mike covers Acme
    { userId: 'u2', companyId: 'C2' },   // Mike covers Globex
    { userId: 'u3', companyId: 'C1' },   // Lee covers Acme
    { userId: 'u3', companyId: 'C3' },   // Lee covers Initech (not Globex)
    { userId: 'u9',  companyId: 'C1' },   // Nora L1 covers Acme
    { userId: 'u9',  companyId: 'C3' },   // Nora L1 covers Initech
    { userId: 'u10', companyId: 'C2' },   // Raj L2 covers Globex
    { userId: 'u10', companyId: 'C3' },   // Raj L2 covers Initech
    { userId: 'u11', companyId: 'C1' },   // Kim L3 covers Acme
    { userId: 'u11', companyId: 'C2' },   // Kim L3 covers Globex
    { userId: 'u11', companyId: 'C3' },   // Kim L3 covers Initech
    { userId: 'u12', companyId: 'C1' },   // Omar L4 covers Acme
    { userId: 'u12', companyId: 'C2' },   // Omar L4 covers Globex
    { userId: 'u12', companyId: 'C3' }    // Omar L4 covers Initech
  ],

  categories: [
    { id: 'cat1', name: 'Network' },
    { id: 'cat2', name: 'Hardware' },
    { id: 'cat3', name: 'Software' },
    { id: 'cat4', name: 'Access / Account' },
    { id: 'cat5', name: 'Request' }
  ],

  // Decision K: severity (client-set, business impact) vs priority (support-set, work order)
  severities: ['Critical', 'Major', 'Minor', 'Low'],
  priorities: ['P1', 'P2', 'P3', 'P4'],
  statuses:   ['New', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed'],

  // FR-30: ITIL ticket type distinction
  ticketTypes: ['INCIDENT', 'SERVICE_REQUEST'],

  // FR-36: Resolution codes for resolved/closed tickets
  resolutionCodes: ['FIXED', 'WORKAROUND', 'KNOWN_ERROR', 'CANNOT_REPRODUCE', 'DUPLICATE', 'USER_EDUCATION', 'NOT_AN_INCIDENT'],

  // FR-23: Per-company SLA targets per severity (vendor-managed).
  // sla_due_date = created_at + resolution_days.
  // escalationPct = auto-escalation threshold percentage (FR-35).
  slaTargets: [
    { companyId: 'C1', severity: 'Critical', responseHours: 1,  resolutionDays: 1,  escalationPct: 80 },
    { companyId: 'C1', severity: 'Major',    responseHours: 4,  resolutionDays: 3,  escalationPct: 80 },
    { companyId: 'C1', severity: 'Minor',    responseHours: 8,  resolutionDays: 7,  escalationPct: 80 },
    { companyId: 'C1', severity: 'Low',      responseHours: 24, resolutionDays: 14, escalationPct: 80 },
    { companyId: 'C2', severity: 'Critical', responseHours: 2,  resolutionDays: 1,  escalationPct: 75 },
    { companyId: 'C2', severity: 'Major',    responseHours: 8,  resolutionDays: 5,  escalationPct: 75 },
    { companyId: 'C2', severity: 'Minor',    responseHours: 16, resolutionDays: 10, escalationPct: 75 },
    { companyId: 'C2', severity: 'Low',      responseHours: 48, resolutionDays: 21, escalationPct: 75 },
    { companyId: 'C3', severity: 'Critical', responseHours: 1,  resolutionDays: 1,  escalationPct: 80 },
    { companyId: 'C3', severity: 'Major',    responseHours: 4,  resolutionDays: 3,  escalationPct: 80 },
    { companyId: 'C3', severity: 'Minor',    responseHours: 8,  resolutionDays: 7,  escalationPct: 80 },
    { companyId: 'C3', severity: 'Low',      responseHours: 24, resolutionDays: 14, escalationPct: 80 }
  ],

  // createdAt/updatedAt are ISO strings; relative time is computed at runtime.
  // severity = client-set (required at creation); priority = support-set (nullable until triaged)
  // slaDueDate = stamped at creation from SLA_TARGETS based on severity
  // csatScore = null until requester rates after closure (FR-27)
  // ticketType = INCIDENT or SERVICE_REQUEST (FR-30)
  // firstResponseAt = timestamp of first agent response (FR-31), null if no response yet
  // resolutionCode + resolutionSummary = required on resolve (FR-36), null until resolved
  // reopenCount = number of times ticket was reopened
  // departmentId = stamped from creator's department (Decision N)
  tickets: [
    { id:'t51', ref:'TKT-00051', companyId:'C1', departmentId:'dep1', subject:'Production DB connection pool exhausted', description:'The ERP is throwing connection errors during peak hours. Finance cannot post invoices.', categoryId:'cat3', severity:'Critical', priority:null, status:'New', ticketType:'INCIDENT', createdBy:'u4', assignedTo:null, createdAt:'2026-06-30T08:55:00', updatedAt:'2026-06-30T08:55:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-01T08:55:00', csatScore:null, firstResponseAt:null, resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t50', ref:'TKT-00050', companyId:'C2', departmentId:'dep4', subject:'SSO login fails for new staff', description:'Three new Globex employees cannot sign in via SSO. Existing users are fine.', categoryId:'cat4', severity:'Major', priority:'P2', status:'Assigned', ticketType:'INCIDENT', createdBy:'u7', assignedTo:'u2', createdAt:'2026-06-30T08:38:00', updatedAt:'2026-06-30T08:40:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-03T08:38:00', csatScore:null, firstResponseAt:null, resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t48', ref:'TKT-00048', companyId:'C3', departmentId:'dep5', subject:'Invoice PDF shows wrong currency', description:'Exported invoices show USD instead of MYR for Initech accounts.', categoryId:'cat3', severity:'Major', priority:'P2', status:'In Progress', ticketType:'INCIDENT', createdBy:'u8', assignedTo:'u3', createdAt:'2026-06-29T15:10:00', updatedAt:'2026-06-30T07:30:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-02T15:10:00', csatScore:null, firstResponseAt:'2026-06-30T07:30:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t42', ref:'TKT-00042', companyId:'C1', departmentId:'dep1', subject:'VPN disconnects every few minutes', description:'Finance team on the Acme network reports the VPN dropping every 3-5 minutes since this morning.', categoryId:'cat1', severity:'Major', priority:'P3', status:'In Progress', ticketType:'INCIDENT', createdBy:'u4', assignedTo:'u2', createdAt:'2026-06-30T01:14:00', updatedAt:'2026-06-30T01:38:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-03T01:14:00', csatScore:null, firstResponseAt:'2026-06-30T01:40:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t41', ref:'TKT-00041', companyId:'C1', departmentId:'dep2', subject:'Request: provision 5 new mailboxes', description:'Need 5 new email mailboxes for incoming Acme interns.', categoryId:'cat5', severity:'Minor', priority:null, status:'New', ticketType:'SERVICE_REQUEST', createdBy:'u5', assignedTo:null, createdAt:'2026-06-29T22:00:00', updatedAt:'2026-06-29T22:00:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-06T22:00:00', csatScore:null, firstResponseAt:null, resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t39', ref:'TKT-00039', companyId:'C1', departmentId:'dep1', subject:'Cannot export monthly report to PDF', description:'The export button spins forever and never produces a PDF.', categoryId:'cat3', severity:'Minor', priority:'P3', status:'Resolved', ticketType:'INCIDENT', createdBy:'u4', assignedTo:'u3', createdAt:'2026-06-28T09:00:00', updatedAt:'2026-06-29T16:00:00', resolvedAt:'2026-06-29T16:00:00', closedAt:null, slaDueDate:'2026-07-05T09:00:00', csatScore:null, firstResponseAt:'2026-06-29T16:00:00', resolutionCode:'FIXED', resolutionSummary:'Fixed the PDF export timeout by increasing the server-side report generation limit.', reopenCount:0 },
    { id:'t38', ref:'TKT-00038', companyId:'C2', departmentId:'dep4', subject:'Printer on 3rd floor offline', description:'Shared printer GLOBEX-P3 is not reachable.', categoryId:'cat2', severity:'Low', priority:'P4', status:'On Hold', ticketType:'INCIDENT', createdBy:'u7', assignedTo:'u2', createdAt:'2026-06-27T11:20:00', updatedAt:'2026-06-29T10:00:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-07-11T11:20:00', csatScore:null, firstResponseAt:'2026-06-29T10:00:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t35', ref:'TKT-00035', companyId:'C1', departmentId:'dep2', subject:'New laptop setup for finance hire', description:'Provision and image a laptop for a new Acme finance staff member.', categoryId:'cat2', severity:'Minor', priority:'P3', status:'Closed', ticketType:'SERVICE_REQUEST', createdBy:'u5', assignedTo:'u2', createdAt:'2026-06-24T08:00:00', updatedAt:'2026-06-26T14:00:00', resolvedAt:'2026-06-25T16:00:00', closedAt:'2026-06-26T14:00:00', slaDueDate:'2026-07-01T08:00:00', csatScore:4, firstResponseAt:'2026-06-25T10:00:00', resolutionCode:'FIXED', resolutionSummary:'Laptop provisioned, imaged with standard SOE, and delivered to the new hire.', reopenCount:0 },
    { id:'t31', ref:'TKT-00031', companyId:'C1', departmentId:'dep1', subject:'Add new user license', description:'Please add one more licensed seat for the analytics tool.', categoryId:'cat5', severity:'Low', priority:'P4', status:'Closed', ticketType:'SERVICE_REQUEST', createdBy:'u4', assignedTo:'u2', createdAt:'2026-06-20T10:00:00', updatedAt:'2026-06-22T09:00:00', resolvedAt:'2026-06-21T14:00:00', closedAt:'2026-06-22T09:00:00', slaDueDate:'2026-07-04T10:00:00', csatScore:5, firstResponseAt:'2026-06-21T09:00:00', resolutionCode:'FIXED', resolutionSummary:'License seat added to the analytics tool subscription.', reopenCount:0 },
    { id:'t28', ref:'TKT-00028', companyId:'C3', departmentId:'dep5', subject:'Email going to spam', description:'Outbound email from Initech domain is landing in client spam folders.', categoryId:'cat1', severity:'Major', priority:'P2', status:'In Progress', ticketType:'INCIDENT', createdBy:'u8', assignedTo:'u3', createdAt:'2026-06-26T13:00:00', updatedAt:'2026-06-30T06:00:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-06-29T13:00:00', csatScore:null, firstResponseAt:'2026-06-27T10:00:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t24', ref:'TKT-00024', companyId:'C2', departmentId:'dep3', subject:'Password reset not arriving', description:'Reset emails are delayed by 20+ minutes.', categoryId:'cat4', severity:'Minor', priority:'P3', status:'Resolved', ticketType:'INCIDENT', createdBy:'u6', assignedTo:'u2', createdAt:'2026-06-25T09:30:00', updatedAt:'2026-06-28T12:00:00', resolvedAt:'2026-06-28T12:00:00', closedAt:null, slaDueDate:'2026-07-02T09:30:00', csatScore:null, firstResponseAt:'2026-06-26T14:00:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 },
    { id:'t19', ref:'TKT-00019', companyId:'C1', departmentId:'dep2', subject:'Shared drive missing files', description:'A folder on the X: drive appears empty after the weekend.', categoryId:'cat3', severity:'Critical', priority:'P1', status:'Assigned', ticketType:'INCIDENT', createdBy:'u5', assignedTo:'u3', createdAt:'2026-06-29T18:00:00', updatedAt:'2026-06-29T18:30:00', resolvedAt:null, closedAt:null, slaDueDate:'2026-06-30T18:00:00', csatScore:null, firstResponseAt:'2026-06-29T18:30:00', resolutionCode:null, resolutionSummary:null, reopenCount:0 }
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

  seq: 51 // last ticket number used; next created ticket = 52
};
