/* =========================================================================
   demo-data.js — seed dataset for the ServiceDesk interactive demo.
   This is a CLIENT-SIDE simulation for demonstrating the workflow only.
   It is NOT real data and NOT real security. Real auth + tenant isolation
   are built in Oracle APEX (application items + WHERE company_id filters
   + authorization schemes).
   ========================================================================= */
window.DEMO_SEED = {
  companies: [
    { id: 'C0', name: 'Northwind IT',  type: 'VENDOR', status: 'Active' },
    { id: 'C1', name: 'Acme Corp',     type: 'CLIENT', status: 'Active' },
    { id: 'C2', name: 'Globex Ltd',    type: 'CLIENT', status: 'Active' },
    { id: 'C3', name: 'Initech',       type: 'CLIENT', status: 'Active' },
    { id: 'C4', name: 'Umbrella Inc',  type: 'CLIENT', status: 'Inactive' }
  ],

  // password is 'demo' for every account (prefilled on the login screen)
  users: [
    { id: 'u1', name: 'Sara Admin',   email: 'sara@northwind.example',  password: 'demo', role: 'System Admin',  companyId: 'C0' },
    { id: 'u2', name: 'Mike Ops',     email: 'mike@northwind.example',  password: 'demo', role: 'Support Agent', companyId: 'C0' },
    { id: 'u3', name: 'Lee Tech',     email: 'lee@northwind.example',   password: 'demo', role: 'Support Agent', companyId: 'C0' },
    { id: 'u4', name: 'Anna Nguyen',  email: 'anna@acme.example',       password: 'demo', role: 'Client User',   companyId: 'C1' },
    { id: 'u5', name: 'Bob Reyes',    email: 'bob@acme.example',        password: 'demo', role: 'Client Admin',  companyId: 'C1' },
    { id: 'u6', name: 'Carla Vidal',  email: 'carla@globex.example',    password: 'demo', role: 'Client Admin',  companyId: 'C2' },
    { id: 'u7', name: 'Dan Yu',       email: 'dan@globex.example',      password: 'demo', role: 'Client User',   companyId: 'C2' },
    { id: 'u8', name: 'Eve Park',     email: 'eve@initech.example',     password: 'demo', role: 'Client User',   companyId: 'C3' }
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
    { userId: 'u3', companyId: 'C3' }    // Lee covers Initech (not Globex)
  ],

  categories: [
    { id: 'cat1', name: 'Network' },
    { id: 'cat2', name: 'Hardware' },
    { id: 'cat3', name: 'Software' },
    { id: 'cat4', name: 'Access / Account' },
    { id: 'cat5', name: 'Request' }
  ],

  priorities: ['Low', 'Medium', 'High', 'Critical'],
  statuses:   ['New', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed'],

  // createdAt/updatedAt are ISO strings; relative time is computed at runtime.
  tickets: [
    { id:'t51', ref:'TKT-00051', companyId:'C1', subject:'Production DB connection pool exhausted', description:'The ERP is throwing connection errors during peak hours. Finance cannot post invoices.', categoryId:'cat3', priority:'Critical', status:'New', createdBy:'u4', assignedTo:null, createdAt:'2026-06-30T08:55:00', updatedAt:'2026-06-30T08:55:00' },
    { id:'t50', ref:'TKT-00050', companyId:'C2', subject:'SSO login fails for new staff', description:'Three new Globex employees cannot sign in via SSO. Existing users are fine.', categoryId:'cat4', priority:'High', status:'Assigned', createdBy:'u7', assignedTo:'u2', createdAt:'2026-06-30T08:38:00', updatedAt:'2026-06-30T08:40:00' },
    { id:'t48', ref:'TKT-00048', companyId:'C3', subject:'Invoice PDF shows wrong currency', description:'Exported invoices show USD instead of MYR for Initech accounts.', categoryId:'cat3', priority:'High', status:'In Progress', createdBy:'u8', assignedTo:'u3', createdAt:'2026-06-29T15:10:00', updatedAt:'2026-06-30T07:30:00' },
    { id:'t42', ref:'TKT-00042', companyId:'C1', subject:'VPN disconnects every few minutes', description:'Finance team on the Acme network reports the VPN dropping every 3-5 minutes since this morning.', categoryId:'cat1', priority:'Medium', status:'In Progress', createdBy:'u4', assignedTo:'u2', createdAt:'2026-06-30T01:14:00', updatedAt:'2026-06-30T01:38:00' },
    { id:'t41', ref:'TKT-00041', companyId:'C1', subject:'Request: provision 5 new mailboxes', description:'Need 5 new email mailboxes for incoming Acme interns.', categoryId:'cat5', priority:'Low', status:'New', createdBy:'u5', assignedTo:null, createdAt:'2026-06-29T22:00:00', updatedAt:'2026-06-29T22:00:00' },
    { id:'t39', ref:'TKT-00039', companyId:'C1', subject:'Cannot export monthly report to PDF', description:'The export button spins forever and never produces a PDF.', categoryId:'cat3', priority:'Medium', status:'Resolved', createdBy:'u4', assignedTo:'u3', createdAt:'2026-06-28T09:00:00', updatedAt:'2026-06-29T16:00:00' },
    { id:'t38', ref:'TKT-00038', companyId:'C2', subject:'Printer on 3rd floor offline', description:'Shared printer GLOBEX-P3 is not reachable.', categoryId:'cat2', priority:'Low', status:'On Hold', createdBy:'u7', assignedTo:'u2', createdAt:'2026-06-27T11:20:00', updatedAt:'2026-06-29T10:00:00' },
    { id:'t35', ref:'TKT-00035', companyId:'C1', subject:'New laptop setup for finance hire', description:'Provision and image a laptop for a new Acme finance staff member.', categoryId:'cat2', priority:'Medium', status:'Closed', createdBy:'u5', assignedTo:'u2', createdAt:'2026-06-24T08:00:00', updatedAt:'2026-06-26T14:00:00' },
    { id:'t31', ref:'TKT-00031', companyId:'C1', subject:'Add new user license', description:'Please add one more licensed seat for the analytics tool.', categoryId:'cat5', priority:'Low', status:'Closed', createdBy:'u4', assignedTo:'u2', createdAt:'2026-06-20T10:00:00', updatedAt:'2026-06-22T09:00:00' },
    { id:'t28', ref:'TKT-00028', companyId:'C3', subject:'Email going to spam', description:'Outbound email from Initech domain is landing in client spam folders.', categoryId:'cat1', priority:'High', status:'In Progress', createdBy:'u8', assignedTo:'u3', createdAt:'2026-06-26T13:00:00', updatedAt:'2026-06-30T06:00:00' },
    { id:'t24', ref:'TKT-00024', companyId:'C2', subject:'Password reset not arriving', description:'Reset emails are delayed by 20+ minutes.', categoryId:'cat4', priority:'Medium', status:'Resolved', createdBy:'u6', assignedTo:'u2', createdAt:'2026-06-25T09:30:00', updatedAt:'2026-06-28T12:00:00' },
    { id:'t19', ref:'TKT-00019', companyId:'C1', subject:'Shared drive missing files', description:'A folder on the X: drive appears empty after the weekend.', categoryId:'cat3', priority:'High', status:'Assigned', createdBy:'u5', assignedTo:'u3', createdAt:'2026-06-29T18:00:00', updatedAt:'2026-06-29T18:30:00' }
  ],

  comments: [
    { id:'c1', ticketId:'t42', userId:'u4', text:'It started this morning. Finance team can’t reach the ERP.', isInternal:false, createdAt:'2026-06-30T01:14:00' },
    { id:'c2', ticketId:'t42', userId:'u2', text:'Looking into it — checking the VPN concentrator logs now.', isInternal:false, createdAt:'2026-06-30T01:40:00' },
    { id:'c3', ticketId:'t42', userId:'u2', text:'Concentrator showing MTU mismatch after last firmware push.', isInternal:true, createdAt:'2026-06-30T01:42:00' },
    { id:'c4', ticketId:'t48', userId:'u3', text:'Reproduced — currency code is hardcoded in the report template.', isInternal:true, createdAt:'2026-06-30T07:30:00' },
    { id:'c5', ticketId:'t39', userId:'u3', text:'Fixed the export timeout. Please confirm it works for you now.', isInternal:false, createdAt:'2026-06-29T16:00:00' }
  ],

  history: [
    { id:'h1', ticketId:'t42', userId:'u4', action:'Raised ticket',  oldValue:'',         newValue:'New',         createdAt:'2026-06-30T01:14:00' },
    { id:'h2', ticketId:'t42', userId:'u1', action:'Assigned agent', oldValue:'New',      newValue:'Assigned',    createdAt:'2026-06-30T01:30:00' },
    { id:'h3', ticketId:'t42', userId:'u2', action:'Started work',   oldValue:'Assigned', newValue:'In Progress', createdAt:'2026-06-30T01:38:00' },
    { id:'h4', ticketId:'t50', userId:'u7', action:'Raised ticket',  oldValue:'',         newValue:'New',         createdAt:'2026-06-30T08:38:00' },
    { id:'h5', ticketId:'t50', userId:'u1', action:'Assigned agent', oldValue:'New',      newValue:'Assigned',    createdAt:'2026-06-30T08:40:00' },
    { id:'h6', ticketId:'t39', userId:'u4', action:'Raised ticket',  oldValue:'',         newValue:'New',         createdAt:'2026-06-28T09:00:00' },
    { id:'h7', ticketId:'t39', userId:'u3', action:'Resolved',       oldValue:'In Progress', newValue:'Resolved', createdAt:'2026-06-29T16:00:00' }
  ],

  seq: 51 // last ticket number used; next created ticket = 52
};
