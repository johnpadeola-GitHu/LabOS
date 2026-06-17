/* ============================================================
   LabOS — Role-Based Access Control (RBAC)
   A single source of truth for what each role can do, plus
   enforcement helpers used by navigation and action buttons.

   This is real enforcement, not a display table: navigate()
   blocks unauthorised routes, the sidebar hides items the role
   can't reach, and action buttons call can() before mutating.
   ============================================================ */

/* ── Canonical permission keys ──────────────────────────────────
   Keep these stable — they are referenced across the app and map
   to the columns shown in the Staff & Roles matrix.
   ────────────────────────────────────────────────────────────── */
window.RBAC_PERMISSIONS = [
  'patients.view', 'patients.edit',
  'requests.view', 'requests.create',
  'samples.collect',
  'results.enter', 'results.validate', 'results.release',
  'renal.manage',
  'imaging.manage',
  'histopath.manage',
  'molecular.manage',
  'billing.view', 'billing.manage',
  'inventory.manage',
  'qc.manage',
  'reports.view',
  'staff.manage',
  'audit.view',
  'settings.manage',
  'subscription.manage',
  'privacy.manage',
  'platform.admin'
];

/* ── Roles ───────────────────────────────────────────────────────
   Canonical role codes. Display names are derived or mapped.
   ────────────────────────────────────────────────────────────── */
window.RBAC_ROLES = {
  PLATFORM_SUPER_ADMIN: { label:'Platform Super Admin', rank:100 },
  TENANT_ADMIN:         { label:'Tenant Administrator',  rank:90 },
  LAB_DIRECTOR:         { label:'Laboratory Director',   rank:80 },
  PATHOLOGIST:          { label:'Pathologist',           rank:70 },
  RENAL_SPECIALIST:     { label:'Renal Specialist',      rank:65 },
  LAB_SCIENTIST:        { label:'Medical Laboratory Scientist', rank:60 },
  RADIOLOGIST:          { label:'Radiologist',           rank:60 },
  NURSE:                { label:'Nurse',                 rank:50 },
  PHLEBOTOMIST:         { label:'Phlebotomist',          rank:45 },
  FRONT_DESK:           { label:'Front Desk Officer',    rank:40 },
  CASHIER:              { label:'Cashier',               rank:40 },
  INVENTORY_OFFICER:    { label:'Inventory Officer',     rank:40 },
  ACCOUNTANT:           { label:'Accountant',            rank:50 },
  BRANCH_MANAGER:       { label:'Branch Manager',        rank:70 },
  REFERRAL_CLINICIAN:   { label:'Referring Clinician',   rank:10 }
};

/* ── The matrix: role → set of permissions ──────────────────────
   '*' grants everything. This is the enforced source of truth.
   ────────────────────────────────────────────────────────────── */
window.RBAC_MATRIX = {
  PLATFORM_SUPER_ADMIN: ['*'],

  TENANT_ADMIN: ['*'], // full control within their tenant

  LAB_DIRECTOR: [
    'patients.view','patients.edit','requests.view','requests.create','samples.collect',
    'results.enter','results.validate','results.release','renal.manage','imaging.manage',
    'histopath.manage','molecular.manage','billing.view','billing.manage','inventory.manage',
    'qc.manage','reports.view','staff.manage','audit.view','settings.manage','privacy.manage'
  ],

  PATHOLOGIST: [
    'patients.view','requests.view','requests.create','results.enter','results.validate',
    'results.release','histopath.manage','molecular.manage','qc.manage','reports.view','audit.view'
  ],

  RENAL_SPECIALIST: [
    'patients.view','requests.view','requests.create','samples.collect','results.enter',
    'results.validate','renal.manage','qc.manage','reports.view'
  ],

  LAB_SCIENTIST: [
    'patients.view','requests.view','requests.create','samples.collect','results.enter',
    'inventory.manage','qc.manage'
  ],

  RADIOLOGIST: [
    'patients.view','requests.view','imaging.manage','results.enter','results.validate',
    'results.release','reports.view'
  ],

  NURSE: [
    'patients.view','patients.edit','requests.view','requests.create','samples.collect'
  ],

  PHLEBOTOMIST: [
    'patients.view','requests.view','samples.collect'
  ],

  FRONT_DESK: [
    'patients.view','patients.edit','requests.view','requests.create','billing.view'
  ],

  CASHIER: [
    'patients.view','billing.view','billing.manage'
  ],

  INVENTORY_OFFICER: [
    'inventory.manage','reports.view'
  ],

  ACCOUNTANT: [
    'billing.view','billing.manage','reports.view','audit.view'
  ],

  BRANCH_MANAGER: [
    'patients.view','patients.edit','requests.view','requests.create','samples.collect',
    'billing.view','billing.manage','inventory.manage','reports.view','staff.manage','audit.view'
  ],

  REFERRAL_CLINICIAN: [
    'results.view.referred' // special scoped permission, handled in referral mode
  ]
};

/* ── Route → required permission ────────────────────────────────
   A route with no entry here is considered universally accessible
   (e.g. dashboard, help). platform.admin routes are guarded too.
   ────────────────────────────────────────────────────────────── */
window.RBAC_ROUTE_PERMISSIONS = {
  patients:        'patients.view',
  requests:        'requests.view',
  samples:         'samples.collect',
  results:         'results.enter',
  renal:           'renal.manage',
  radiology:       'imaging.manage',
  ultrasound:      'imaging.manage',
  ctscan:          'imaging.manage',
  mri:             'imaging.manage',
  ecg:             'imaging.manage',
  echo:            'imaging.manage',
  imaging:         'imaging.manage',
  diagnosticReporting: 'imaging.manage',
  histopath:       'histopath.manage',
  molecular:       'molecular.manage',
  dna:             'molecular.manage',
  billing:         'billing.view',
  pricing:         'billing.manage',
  inventory:       'inventory.manage',
  qualityControl:  'qc.manage',
  analytics:       'reports.view',
  reports:         'reports.view',
  staff:           'staff.manage',
  audit:           'audit.view',
  settings:        'settings.manage',
  security:        'settings.manage',
  backup:          'settings.manage',
  subscription:    'subscription.manage',
  privacy:         'privacy.manage',
  // Instrument Gateway — admin only
  gatewayDashboard: 'settings.manage',
  analyzers:        'settings.manage',
  testMapping:      'settings.manage',
  sampleMatching:   'results.validate',
  resultValidation: 'results.validate',
  gatewayLogs:      'audit.view'
};

/* ── Normalise free-text role labels to canonical codes ─────────
   Seed data uses display strings ("Laboratory Director"); map them.
   ────────────────────────────────────────────────────────────── */
window.rbacNormaliseRole = function(role){
  if(!role) return 'FRONT_DESK';
  if(window.RBAC_MATRIX[role]) return role; // already canonical
  const map = {
    'super admin':'TENANT_ADMIN',
    'platform super admin':'PLATFORM_SUPER_ADMIN',
    'tenant administrator':'TENANT_ADMIN',
    'tenant admin':'TENANT_ADMIN',
    'laboratory director':'LAB_DIRECTOR',
    'lab director':'LAB_DIRECTOR',
    'pathologist':'PATHOLOGIST',
    'renal specialist':'RENAL_SPECIALIST',
    'medical laboratory scientist':'LAB_SCIENTIST',
    'med lab scientist':'LAB_SCIENTIST',
    'lab scientist':'LAB_SCIENTIST',
    'radiologist':'RADIOLOGIST',
    'nurse':'NURSE',
    'nurse / phlebotomist':'NURSE',
    'phlebotomist':'PHLEBOTOMIST',
    'front desk':'FRONT_DESK',
    'front desk officer':'FRONT_DESK',
    'cashier':'CASHIER',
    'inventory':'INVENTORY_OFFICER',
    'inventory officer':'INVENTORY_OFFICER',
    'accountant':'ACCOUNTANT',
    'branch mgr':'BRANCH_MANAGER',
    'branch manager':'BRANCH_MANAGER',
    'referral clinician':'REFERRAL_CLINICIAN',
    'referring clinician':'REFERRAL_CLINICIAN'
  };
  return map[String(role).toLowerCase()] || 'FRONT_DESK';
};

/* ── can(permission): the core enforcement check ────────────────
   Reads the current session role and tests it against the matrix.
   ────────────────────────────────────────────────────────────── */
window.can = function(permission){
  try {
    const sess = (typeof S === 'function') ? S() : (window.APP_STATE && APP_STATE.session);
    if(!sess) return false;
    // Platform mode is all-powerful within platform scope.
    if(sess.mode === 'platform') return true;
    const role = window.rbacNormaliseRole(sess.userRole);
    const perms = window.RBAC_MATRIX[role] || [];
    if(perms.includes('*')) return true;
    return perms.includes(permission);
  } catch(e) {
    return false;
  }
};

/* canAccessRoute(route): used by navigate() and the sidebar. */
window.canAccessRoute = function(route){
  const required = window.RBAC_ROUTE_PERMISSIONS[route];
  if(!required) return true;            // unguarded route
  return window.can(required);
};

/* requirePermission(permission, actionLabel): guard for action
   handlers. Returns true if allowed; otherwise toasts and returns
   false so the caller can abort. */
window.requirePermission = function(permission, actionLabel){
  if(window.can(permission)) return true;
  if(typeof toast === 'function'){
    toast(
      `Your role does not have permission to ${actionLabel || 'perform this action'}. Contact your administrator.`,
      { type:'error', title:'Access denied', duration:5000 }
    );
  }
  return false;
};

/* Returns the canonical permission list for a role (for the matrix UI). */
window.rbacPermsForRole = function(roleCode){
  const perms = window.RBAC_MATRIX[roleCode] || [];
  if(perms.includes('*')) return window.RBAC_PERMISSIONS.slice();
  return perms;
};
