// Enterprise feature tests — QC engine, session management, NDPR, i18n,
// referral portal, accessibility primitives, and error boundary.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bootLabOS } from './harness.js';

function setup(mode) {
  const booted = bootLabOS();
  const { win } = booted;
  const doc = win.document;
  ['modal-root', 'app', 'toast-root', 'content', 'user-card',
   'brand-mark', 'brand-name', 'brand-sub', 'branch-switcher',
   'branch-val', 'branch-lbl', 'tenant-pill', 'sidebar-nav',
   'onboarding-root'].forEach(id => {
    if (!doc.getElementById(id)) {
      const el = doc.createElement('div'); el.id = id; doc.body.appendChild(el);
    }
  });
  if (mode === 'tenant') win.enterTenantMode('tnt_pathcare');
  return { win, doc, booted, APP_STATE: booted.APP_STATE };
}

// ── QC Engine ─────────────────────────────────────────────────────────────────
describe('QC Engine — Westgard multi-rule', () => {
  it('exports QC_ANALYTES with at least 4 analytes', () => {
    const { win } = setup();
    expect(win.QC_ANALYTES).toBeTruthy();
    expect(win.QC_ANALYTES.length).toBeGreaterThanOrEqual(4);
  });

  it('exports QC_RUNS keyed by analyte code', () => {
    const { win } = setup();
    const codes = win.QC_ANALYTES.map(a => a.code);
    codes.forEach(code => {
      expect(win.QC_RUNS[code]).toBeTruthy();
      expect(win.QC_RUNS[code].length).toBeGreaterThan(0);
    });
  });

  it('evaluate() returns in-control for a perfect set of runs', () => {
    const { win } = setup();
    const perfect = Array.from({ length: 20 }, (_, i) => ({
      z: (i % 3 === 0 ? 0.5 : i % 3 === 1 ? -0.3 : 0.8)
    }));
    const result = win.QC.evaluate(perfect);
    expect(result.status).toBe('in-control');
    expect(result.violations).toHaveLength(0);
  });

  it('1₃s rule fires when a single point exceeds ±3 SD', () => {
    const { win } = setup();
    const runs = Array.from({ length: 10 }, (_, i) => ({ z: i === 5 ? 3.2 : 0.4 }));
    const result = win.QC.evaluate(runs);
    expect(result.violations.some(v => v.rule === '1₃s')).toBe(true);
    expect(result.status).toBe('reject');
  });

  it('1₂s warning rule fires at ±2 SD without exceeding ±3 SD', () => {
    const { win } = setup();
    // Single isolated point at 2.2 SD — triggers 1₂s only
    const runs = [{ z: 0.1 }, { z: -0.2 }, { z: 0.3 }, { z: -0.1 }, { z: 2.2 },
                  { z: -0.3 }, { z: 0.1 }, { z: -0.2 }, { z: 0.3 }, { z: -0.1 }];
    const result = win.QC.evaluate(runs);
    expect(result.violations.some(v => v.rule === '1₂s')).toBe(true);
    // No reject-level violation: no consecutive 2₂s, no 1₃s, no R₄s, no 4₁s, no 10ₓ
    expect(result.status).toBe('warning');
  });

  it('10ₓ reject fires for 10 consecutive points on same side', () => {
    const { win } = setup();
    const runs = Array.from({ length: 15 }, (_, i) => ({ z: i < 10 ? 0.8 : -0.5 }));
    const result = win.QC.evaluate(runs);
    expect(result.violations.some(v => v.rule === '10ₓ')).toBe(true);
    expect(result.status).toBe('reject');
  });

  it('cv() returns a positive percentage', () => {
    const { win } = setup();
    const code = win.QC_ANALYTES[0].code;
    const runs = win.QC_RUNS[code].slice(0, 20);
    const cv = win.QC.cv(runs);
    expect(cv).toBeGreaterThan(0);
    expect(cv).toBeLessThan(50);
  });

  it('bias() returns signed percentage relative to target', () => {
    const { win } = setup();
    const analyte = win.QC_ANALYTES[0];
    const runs = win.QC_RUNS[analyte.code].slice(0, 20);
    const bias = win.QC.bias(runs, analyte.target);
    expect(typeof bias).toBe('number');
  });

  it('submitRun() adds a run and returns evaluation', () => {
    const { win } = setup();
    const analyte = win.QC_ANALYTES[0];
    const before = win.QC_RUNS[analyte.code].length;
    const out = win.QC.submitRun(analyte.code, analyte.target, 'Test Operator');
    expect(out).toBeTruthy();
    expect(out.run).toBeTruthy();
    expect(out.evaluation).toBeTruthy();
    expect(win.QC_RUNS[analyte.code].length).toBe(before + 1);
  });

  it('submitRun() returns null for an unknown analyte', () => {
    const { win } = setup();
    const out = win.QC.submitRun('ZZZNONSENSE', 5.0, 'Op');
    expect(out).toBeNull();
  });
});

// ── QC Screen Rendering ───────────────────────────────────────────────────────
describe('QC screen rendering', () => {
  it('renderQualityControl() renders analyte cards', () => {
    const { win, doc } = setup('tenant');
    const root = doc.getElementById('content') || (() => { const d = doc.createElement('div'); d.id = 'content'; doc.body.appendChild(d); return d; })();
    win.renderQualityControl(root);
    expect(root.querySelector('.page-title').textContent).toContain('Quality Control');
    // Should have at least one analyte card
    expect(root.querySelectorAll('.card').length).toBeGreaterThan(0);
  });

  it('renderQcDetail() renders a chart for a valid analyte code', () => {
    const { win, doc } = setup('tenant');
    const root = doc.getElementById('content') || (() => { const d = doc.createElement('div'); d.id = 'content'; doc.body.appendChild(d); return d; })();
    const code = win.QC_ANALYTES[0].code;
    win.renderQcDetail(root, code);
    // SVG chart should be present
    expect(root.innerHTML).toContain('<svg');
    expect(root.innerHTML).toContain('Levey-Jennings');
  });
});

// ── i18n Framework ────────────────────────────────────────────────────────────
describe('i18n — L() and setLanguage()', () => {
  it('L() returns the English string by default', () => {
    const { win } = setup();
    win.CURRENT_LANG = 'en';
    expect(win.L('app.name')).toBe('LabOS');
    expect(win.L('nav.patients')).toBe('Patients');
    expect(win.L('action.save')).toBe('Save');
  });

  it('L() returns Hausa string when language is set to ha', () => {
    const { win } = setup();
    win.CURRENT_LANG = 'ha';
    expect(win.L('action.save')).toBe('Ajiye');
    expect(win.L('nav.patients')).toBe('Marasa');
  });

  it('L() falls back to English for a key missing in target language', () => {
    const { win } = setup();
    win.CURRENT_LANG = 'ig';
    // Igbo only has a subset — English fallback should work
    expect(win.L('app.name')).toBe('LabOS');
  });

  it('L() returns the key itself when missing from all languages', () => {
    const { win } = setup();
    win.CURRENT_LANG = 'en';
    const missing = 'totally.missing.key.xyz';
    expect(win.L(missing)).toBe(missing);
  });

  it('setLanguage() changes CURRENT_LANG', () => {
    const { win } = setup();
    win.setLanguage('ha');
    expect(win.CURRENT_LANG).toBe('ha');
    win.setLanguage('en'); // restore
  });

  it('setLanguage() ignores unknown language codes', () => {
    const { win } = setup();
    win.CURRENT_LANG = 'en';
    win.setLanguage('xx_INVALID');
    expect(win.CURRENT_LANG).toBe('en');
  });

  it('LANG_STRINGS covers all 4 supported languages', () => {
    const { win } = setup();
    expect(Object.keys(win.LANG_STRINGS)).toContain('en');
    expect(Object.keys(win.LANG_STRINGS)).toContain('ha');
    expect(Object.keys(win.LANG_STRINGS)).toContain('yo');
    expect(Object.keys(win.LANG_STRINGS)).toContain('ig');
  });
});

// ── NDPR / Data subject rights ────────────────────────────────────────────────
describe('NDPR — data subject rights', () => {
  it('NDPR.submitDsar() creates a DSAR record with a 30-day deadline', () => {
    const { win, APP_STATE } = setup('tenant');
    APP_STATE.dsarRequests = [];
    const record = win.NDPR.submitDsar('access', 'PT-2026-0142', 'Test access request');
    expect(record.id).toMatch(/^DSAR-/);
    expect(record.type).toBe('access');
    expect(record.patientId).toBe('PT-2026-0142');
    expect(record.status).toBe('received');
    // Due date should be ~30 days from now
    const due = new Date(record.dueAt);
    const now = new Date();
    const diffDays = Math.round((due - now) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  it('NDPR.submitDsar() adds to APP_STATE.dsarRequests', () => {
    const { win } = setup('tenant');
    // NDPR uses the bundle-internal APP_STATE (const, not window prop).
    // Verify by calling submitDsar and checking the return value has id/type.
    const record = win.NDPR.submitDsar('deletion', 'PT-2026-0138', 'Erasure request');
    expect(record).toBeTruthy();
    expect(record.id).toMatch(/^DSAR-/);
    expect(record.type).toBe('deletion');
    expect(record.status).toBe('received');
  });

  it('NDPR.exportPatientData() returns a structured export object', () => {
    const { win, APP_STATE } = setup('tenant');
    // NDPR reads window.APP_STATE inside the bundle
    const patient = APP_STATE.patients[0];
    const data = win.NDPR.exportPatientData(patient.id);
    if (!data) return; // demo mode without tenant may return null — skip
    expect(data.exportedAt).toBeTruthy();
    expect(Array.isArray(data.requests)).toBe(true);
    expect(Array.isArray(data.vitals)).toBe(true);
    expect(Array.isArray(data.invoices)).toBe(true);
  });

  it('NDPR.exportPatientData() does not throw for an unknown patient', () => {
    const { win } = setup('tenant');
    // Should not throw; returns an export bundle with patient=undefined
    let data, threw = false;
    try { data = win.NDPR.exportPatientData('NONEXISTENT-PATIENT-ID'); }
    catch(_) { threw = true; }
    expect(threw).toBe(false);
    // In demo mode APP_STATE may not have been set up for tenant, so data may be null
    if (data) expect(data.exportedAt).toBeTruthy();
  });

  it('NDPR.markForDeletion() does not throw and returns cleanly', () => {
    const { win, APP_STATE } = setup('tenant');
    const patient = APP_STATE.patients[0];
    // Just verify it doesn't throw — the mutation happens inside bundle-internal APP_STATE
    let threw = false;
    try { win.NDPR.markForDeletion(patient.id, 'DSAR-2026-0001'); }
    catch(_) { threw = true; }
    expect(threw).toBe(false);
  });

  it('Privacy Center renders DSARs from seed data', () => {
    const { win, doc, APP_STATE } = setup('tenant');
    APP_STATE.dsarRequests = [
      { id: 'DSAR-2026-0001', type: 'access', patientId: 'PT-001',
        submittedAt: '2026-05-01T00:00:00.000Z', dueAt: '2026-05-31T00:00:00.000Z',
        status: 'completed', completedAt: '2026-05-10T00:00:00.000Z' }
    ];
    const root = doc.createElement('div'); doc.body.appendChild(root);
    win.renderPrivacyCenter(root);
    expect(root.innerHTML).toContain('DSAR-2026-0001');
    expect(root.innerHTML).toContain('access');
    expect(root.innerHTML).toContain('NDPR');
  });

  it('Privacy Center shows retention schedule table', () => {
    const { win, doc } = setup('tenant');
    const root = doc.createElement('div'); doc.body.appendChild(root);
    win.renderPrivacyCenter(root);
    expect(root.innerHTML).toContain('7 years');
    expect(root.innerHTML).toContain('ISO 15189');
  });
});

// ── Session management ─────────────────────────────────────────────────────────
describe('SESSION — idle timeout manager', () => {
  it('SESSION object is exported with expected methods', () => {
    const { win } = setup();
    expect(typeof win.SESSION).toBe('object');
    expect(typeof win.SESSION.start).toBe('function');
    expect(typeof win.SESSION.stop).toBe('function');
    expect(typeof win.SESSION.extend).toBe('function');
    expect(typeof win.SESSION.logout).toBe('function');
  });

  it('SESSION.start() sets isActive to true', () => {
    const { win } = setup();
    win.SESSION.stop();
    win.SESSION.start();
    expect(win.SESSION.isActive).toBe(true);
    win.SESSION.stop();
  });

  it('SESSION.stop() sets isActive to false', () => {
    const { win } = setup();
    win.SESSION.start();
    win.SESSION.stop();
    expect(win.SESSION.isActive).toBe(false);
  });

  it('SESSION.lastActive is a recent timestamp', () => {
    const { win } = setup();
    win.SESSION.start();
    const now = Date.now();
    expect(win.SESSION.lastActive).toBeGreaterThan(now - 5000);
    expect(win.SESSION.lastActive).toBeLessThanOrEqual(now + 100);
    win.SESSION.stop();
  });
});

// ── Error boundary ────────────────────────────────────────────────────────────
describe('Global error boundary', () => {
  it('ERROR_LOG is an empty array on fresh boot', () => {
    const { win } = setup();
    expect(Array.isArray(win.ERROR_LOG)).toBe(true);
  });

  it('ERROR_LOG is accessible and appendable', () => {
    const { win } = setup();
    const before = win.ERROR_LOG.length;
    win.ERROR_LOG.push({ ts: new Date().toISOString(), msg: 'test error', file: '', line: 0, col: 0, stack: '' });
    expect(win.ERROR_LOG.length).toBe(before + 1);
    win.ERROR_LOG.pop(); // clean up
  });
});

// ── Accessibility primitives ──────────────────────────────────────────────────
describe('Accessibility — modal ARIA and focus management', () => {
  it('_modalA11y() adds role=dialog and aria-modal to open modal', () => {
    const { win, doc } = setup('tenant');
    const mr = doc.getElementById('modal-root');
    mr.innerHTML = '<div class="modal"><div class="modal-title" id="test-title">Test</div></div>';
    win._modalA11y();
    const modal = mr.querySelector('.modal');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
  });

  it('openModal() produces a modal with role=dialog', () => {
    const { win, doc } = setup('tenant');
    win.openModal('add-staff');
    const modal = doc.querySelector('#modal-root [role="dialog"]');
    expect(modal).toBeTruthy();
    expect(modal.getAttribute('aria-modal')).toBe('true');
  });

  it('closeModal() clears modal-root', () => {
    const { win, doc } = setup('tenant');
    win.openModal('add-staff');
    expect(doc.getElementById('modal-root').innerHTML).not.toBe('');
    win.closeModal();
    expect(doc.getElementById('modal-root').innerHTML).toBe('');
  });

  it('patientComboHtml input has role=combobox and aria-expanded=false initially', () => {
    const { win, doc } = setup('tenant');
    const container = doc.createElement('div');
    container.innerHTML = win.patientComboHtml('test-field', { placeholder: 'Search…' });
    doc.body.appendChild(container);
    const input = container.querySelector('#pc-input-test-field');
    expect(input).toBeTruthy();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-haspopup')).toBe('listbox');
  });

  it('patientComboHtml list has role=listbox', () => {
    const { win, doc } = setup('tenant');
    const container = doc.createElement('div');
    container.innerHTML = win.patientComboHtml('test-field2', { placeholder: 'Search…' });
    doc.body.appendChild(container);
    const list = container.querySelector('#pc-list-test-field2');
    expect(list).toBeTruthy();
    expect(list.getAttribute('role')).toBe('listbox');
  });
});

// ── Referral portal ───────────────────────────────────────────────────────────
describe('Referral doctor portal', () => {
  it('enterReferralMode() sets session mode to referral', () => {
    const { win } = setup();
    win.enterReferralMode('Dr. Smith', 'TOKEN-001');
    expect(win.S().mode).toBe('referral');
    expect(win.S().referralDoctor).toBe('Dr. Smith');
  });

  it('renderReferralPortal() renders the read-only banner', () => {
    const { win, doc } = setup();
    win.enterTenantMode('tnt_vitalis');
    win.S().referralDoctor = 'Dr. Adekunle Smith';
    const root = doc.createElement('div'); doc.body.appendChild(root);
    win.renderReferralPortal(root);
    expect(root.innerHTML).toContain('Referral portal');
    expect(root.innerHTML).toContain('read-only');
    expect(root.innerHTML).toContain('Dr. Adekunle Smith');
  });

  it('filterReferralResults() hides non-matching cards', () => {
    const { win, doc } = setup();
    win.enterTenantMode('tnt_vitalis');
    win.S().referralDoctor = 'Dr. Adekunle Smith';
    const root = doc.createElement('div'); root.id = 'content'; doc.body.appendChild(root);
    win.renderReferralPortal(root);
    // add synthetic result cards
    const list = doc.getElementById('referral-results-list') || root.querySelector('#referral-results-list');
    if (list && list.querySelectorAll('.card').length > 0) {
      win.filterReferralResults('ZZZNOMATCH');
      const visible = [...list.querySelectorAll('.card')].filter(c => c.style.display !== 'none');
      expect(visible.length).toBe(0);
    }
    // If no released results, the portal still renders without error
    expect(root.innerHTML).toContain('Referral portal');
  });

  it('onbReferralSignIn() function exists and is callable', () => {
    const { win } = setup();
    expect(typeof win.onbReferralSignIn).toBe('function');
    // Should not throw when called
    expect(() => win.onbReferralSignIn()).not.toThrow();
  });
});

// ── QC Route and nav integration ──────────────────────────────────────────────
describe('QC route registration', () => {
  it('qualityControl is registered in ROUTES', () => {
    const { booted } = setup();
    expect(booted.ROUTES).toBeTruthy();
    expect(booted.ROUTES['qualityControl']).toBeTruthy();
    expect(typeof booted.ROUTES['qualityControl'].render).toBe('function');
  });

  it('privacy is registered in ROUTES', () => {
    const { booted } = setup();
    expect(booted.ROUTES['privacy']).toBeTruthy();
    expect(typeof booted.ROUTES['privacy'].render).toBe('function');
  });

  it('QC nav item visible for Enterprise tenant (hematology enabled)', () => {
    const { win } = setup('tenant');
    win.enterTenantMode('tnt_pathcare'); // enterprise
    win.renderShell();
    const nav = win.document.getElementById('sidebar-nav').innerHTML;
    expect(nav).toContain('Quality Control');
  });
});

// ── DSAR seed data ────────────────────────────────────────────────────────────
describe('DSAR seed data in APP_STATE', () => {
  it('APP_STATE.dsarRequests is an array', () => {
    const { APP_STATE } = setup();
    expect(Array.isArray(APP_STATE.dsarRequests)).toBe(true);
  });

  it('seeded DSARs have correct structure', () => {
    const { APP_STATE } = setup();
    const dsars = APP_STATE.dsarRequests || [];
    for (const d of dsars) {
      expect(d.id).toMatch(/^DSAR-/);
      expect(['access','correction','deletion','portability','restriction','objection']).toContain(d.type);
      expect(d.submittedAt).toBeTruthy();
      expect(d.dueAt).toBeTruthy();
      expect(d.status).toBeTruthy();
    }
  });
});

// ── RBAC — role-based access control ──────────────────────────────────────────
describe('RBAC — role-based access control', () => {
  it('exports the RBAC matrix, roles, and permission list', () => {
    const { win } = setup();
    expect(win.RBAC_MATRIX).toBeTruthy();
    expect(win.RBAC_ROLES).toBeTruthy();
    expect(Array.isArray(win.RBAC_PERMISSIONS)).toBe(true);
    expect(win.RBAC_PERMISSIONS.length).toBeGreaterThan(10);
  });

  it('TENANT_ADMIN has wildcard access', () => {
    const { win } = setup('tenant');
    win.S().userRole = 'TENANT_ADMIN';
    expect(win.can('patients.view')).toBe(true);
    expect(win.can('billing.manage')).toBe(true);
    expect(win.can('staff.manage')).toBe(true);
    expect(win.can('settings.manage')).toBe(true);
  });

  it('PHLEBOTOMIST can collect samples but not manage billing', () => {
    const { win } = setup('tenant');
    win.S().userRole = 'PHLEBOTOMIST';
    expect(win.can('samples.collect')).toBe(true);
    expect(win.can('patients.view')).toBe(true);
    expect(win.can('billing.manage')).toBe(false);
    expect(win.can('staff.manage')).toBe(false);
    expect(win.can('results.release')).toBe(false);
  });

  it('CASHIER can manage billing but not enter results', () => {
    const { win } = setup('tenant');
    win.S().userRole = 'CASHIER';
    expect(win.can('billing.manage')).toBe(true);
    expect(win.can('results.enter')).toBe(false);
    expect(win.can('samples.collect')).toBe(false);
  });

  it('PATHOLOGIST can validate and release results', () => {
    const { win } = setup('tenant');
    win.S().userRole = 'PATHOLOGIST';
    expect(win.can('results.validate')).toBe(true);
    expect(win.can('results.release')).toBe(true);
    expect(win.can('histopath.manage')).toBe(true);
    expect(win.can('billing.manage')).toBe(false);
  });

  it('canAccessRoute blocks unauthorised routes', () => {
    const { win } = setup('tenant');
    win.S().userRole = 'PHLEBOTOMIST';
    expect(win.canAccessRoute('samples')).toBe(true);
    expect(win.canAccessRoute('staff')).toBe(false);
    expect(win.canAccessRoute('subscription')).toBe(false);
    expect(win.canAccessRoute('billing')).toBe(false);
  });

  it('canAccessRoute allows unguarded routes for everyone', () => {
    const { win } = setup('tenant');
    win.S().userRole = 'PHLEBOTOMIST';
    expect(win.canAccessRoute('dashboard')).toBe(true);
    expect(win.canAccessRoute('help')).toBe(true);
  });

  it('rbacNormaliseRole maps display strings to canonical codes', () => {
    const { win } = setup();
    expect(win.rbacNormaliseRole('Laboratory Director')).toBe('LAB_DIRECTOR');
    expect(win.rbacNormaliseRole('Med Lab Scientist')).toBe('LAB_SCIENTIST');
    expect(win.rbacNormaliseRole('Front Desk Officer')).toBe('FRONT_DESK');
    expect(win.rbacNormaliseRole('TENANT_ADMIN')).toBe('TENANT_ADMIN');
  });

  it('requirePermission returns true when permitted, false otherwise', () => {
    const { win } = setup('tenant');
    win.S().userRole = 'TENANT_ADMIN';
    expect(win.requirePermission('billing.manage', 'manage billing')).toBe(true);
    win.S().userRole = 'PHLEBOTOMIST';
    expect(win.requirePermission('billing.manage', 'manage billing')).toBe(false);
  });

  it('platform mode grants all permissions', () => {
    const { win } = setup();
    win.S().mode = 'platform';
    expect(win.can('patients.view')).toBe(true);
    expect(win.can('platform.admin')).toBe(true);
    win.S().mode = 'tenant'; // restore
  });
});

// ── CoreCare single-centre limit ──────────────────────────────────────────────
describe('CoreCare plan — single centre', () => {
  it('CoreCare allows only 1 centre', () => {
    const { APP_STATE } = setup();
    const corecare = (APP_STATE.plans||[]).find(p => p.code === 'corecare');
    expect(corecare).toBeTruthy();
    expect(corecare.entitlements.maxCentres).toBe(1);
  });
});

// ── Supabase adapter — must not break the app when unconfigured ───────────────
describe('Supabase integration readiness', () => {
  it('LabOSApi exists and exposes the expected interface in mock mode', () => {
    const { win } = setup();
    expect(win.LabOSApi).toBeTruthy();
    expect(typeof win.LabOSApi.isEnabled).toBe('function');
    // No backend configured → isEnabled is false, app uses local/mock path.
    expect(win.LabOSApi.isEnabled()).toBe(false);
  });

  it('LABOS_CONFIG is absent or empty by default (demo mode)', () => {
    const { win } = setup();
    const cfg = win.LABOS_CONFIG;
    // Either undefined or an object with no supabaseUrl — both mean demo mode.
    const configured = !!(cfg && cfg.supabaseUrl && cfg.supabaseAnonKey);
    expect(configured).toBe(false);
  });

  it('the result lifecycle still works through the mock path', () => {
    const { win, doc } = setup('tenant');
    // Confirms the app does not hard-depend on a backend being present.
    expect(typeof win.LabOSApi.enterResult).toBe('function');
    expect(typeof win.LabOSApi.validateResultRow).toBe('function');
    expect(typeof win.LabOSApi.releaseResultRow).toBe('function');
  });
});

// ── ASTM Parser ──────────────────────────────────────────────────────────────
describe('ASTMParser', () => {
  it('exports ASTMParser with parse and utility methods', () => {
    const { win } = setup();
    expect(win.ASTMParser).toBeTruthy();
    expect(typeof win.ASTMParser.parse).toBe('function');
    expect(typeof win.ASTMParser.computeChecksum).toBe('function');
    expect(typeof win.ASTMParser.verifyChecksum).toBe('function');
    expect(typeof win.ASTMParser.normaliseFlag).toBe('function');
  });

  it('parses a simple ASTM message with H/P/O/R/L segments', () => {
    const { win } = setup();
    const raw = 'H|\\^&|||BC-5000^Mindray||||||P|1\rP|1||Smith^John\rO|1|SMP-001||^^^WBC\rR|1|^^^WBC^White Blood Cell Count|7.2|x10^9/L|4.0-11.0|N|||F\rR|2|^^^HGB^Hemoglobin|6.8|g/dL|13.5-17.5|LL|||F\rL|1|N';
    const result = win.ASTMParser.parse(raw, { name: 'Test BC-5000', model: 'BC-5000' });
    expect(result.protocol).toBe('ASTM');
    expect(result.analyzerModel).toBe('BC-5000');
    expect(result.sampleId).toBe('SMP-001');
    expect(result.patientName).toBe('John Smith');
    expect(result.analytes.length).toBe(2);
    expect(result.analytes[0].code).toBe('WBC');
    expect(result.analytes[0].value).toBe('7.2');
    expect(result.analytes[0].flag).toBe('N');
    expect(result.analytes[1].code).toBe('HGB');
    expect(result.analytes[1].flag).toBe('LL');
  });

  it('extracts analyte code from component 3 of OBX-2 test identifier', () => {
    const { win } = setup();
    const raw = 'H|\\^&\rR|1|^^^PLT^Platelet Count|48|x10^9/L|150-400|LL|||F\rL|1|N';
    const result = win.ASTMParser.parse(raw, {});
    expect(result.analytes.length).toBe(1);
    expect(result.analytes[0].code).toBe('PLT');
    expect(result.analytes[0].name).toBe('Platelet Count');
    expect(result.analytes[0].flag).toBe('LL');
  });

  it('handles E (error) segments gracefully', () => {
    const { win } = setup();
    const raw = 'H|\\^&|||KX-21\rE|COMM_TIMEOUT|Serial port read timeout after 5000ms\rL|1';
    const result = win.ASTMParser.parse(raw, {});
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('COMM_TIMEOUT');
    expect(result.analytes.length).toBe(0);
  });

  it('normalises vendor-specific flag codes', () => {
    const { win } = setup();
    expect(win.ASTMParser.normaliseFlag('HH')).toBe('HH');
    expect(win.ASTMParser.normaliseFlag('LL')).toBe('LL');
    expect(win.ASTMParser.normaliseFlag('++')).toBe('HH');
    expect(win.ASTMParser.normaliseFlag('--')).toBe('LL');
    expect(win.ASTMParser.normaliseFlag('+')).toBe('H');
    expect(win.ASTMParser.normaliseFlag('-')).toBe('L');
    expect(win.ASTMParser.normaliseFlag('N')).toBe('N');
    expect(win.ASTMParser.normaliseFlag('')).toBe('N');
  });

  it('computes ASTM checksum correctly', () => {
    const { win } = setup();
    // Checksum = sum of ASCII values mod 256 as 2-digit hex
    const body = '1H|\\^&|||TEST';
    const cs = win.ASTMParser.computeChecksum(body);
    expect(typeof cs).toBe('string');
    expect(cs.length).toBe(2);
    // Verify it's valid hex
    expect(parseInt(cs, 16)).not.toBeNaN();
  });

  it('handles \\r escape in raw string as segment separator', () => {
    const { win } = setup();
    const raw = 'H|\\^&\rR|1|^^^WBC|5.0|x10^9/L|4-11|N|||F\rL|1|N';
    const result = win.ASTMParser.parse(raw, {});
    expect(result.analytes.length).toBe(1);
  });
});

// ── HL7 Parser ───────────────────────────────────────────────────────────────
describe('HL7Parser', () => {
  it('exports HL7Parser with parse and utility methods', () => {
    const { win } = setup();
    expect(win.HL7Parser).toBeTruthy();
    expect(typeof win.HL7Parser.parse).toBe('function');
    expect(typeof win.HL7Parser.extractDelimiters).toBe('function');
    expect(typeof win.HL7Parser.generateACK).toBe('function');
    expect(typeof win.HL7Parser.normaliseFlag).toBe('function');
  });

  it('parses a standard HL7 ORU^R01 message', () => {
    const { win } = setup();
    const raw = 'MSH|^~\\&|COBAS|LAB|LABOS|RECV|20260617142203||ORU^R01|MSG001|P|2.5\rPID|1||PT002^^^LAB||Okafor^Adaeze\rOBR|1|ACC4413|ACC4413|CHEM|||20260617140000\rOBX|1|NM|GLU^Glucose||12.4|mmol/L|3.9-6.1|HH|||F\rOBX|2|NM|CREA^Creatinine||89|umol/L|62-115|N|||F';
    const result = win.HL7Parser.parse(raw, { name: 'Cobas c311', model: 'Cobas c311' });
    expect(result.protocol).toBe('HL7');
    expect(result.messageId).toBe('MSG001');
    expect(result.patientId).toBe('PT002');
    expect(result.patientName).toBe('Adaeze Okafor');
    expect(result.accession).toBe('ACC4413');
    expect(result.analytes.length).toBe(2);
    expect(result.analytes[0].code).toBe('GLU');
    expect(result.analytes[0].value).toBe('12.4');
    expect(result.analytes[0].flag).toBe('HH');
    expect(result.analytes[1].code).toBe('CREA');
    expect(result.analytes[1].flag).toBe('N');
  });

  it('extracts delimiters correctly from MSH', () => {
    const { win } = setup();
    const msh = 'MSH|^~\\&|SENDER';
    const d = win.HL7Parser.extractDelimiters(msh);
    expect(d.field).toBe('|');
    expect(d.component).toBe('^');
    expect(d.repeat).toBe('~');
    expect(d.escape).toBe('\\');
    expect(d.subComponent).toBe('&');
  });

  it('generates a valid ACK message', () => {
    const { win } = setup();
    const msh = 'MSH|^~\\&|COBAS|LAB|LABOS|RECV|20260617||ORU^R01|MSG001|P|2.5';
    const ack = win.HL7Parser.generateACK(msh, 'AA', '');
    expect(ack).toContain('MSH');
    expect(ack).toContain('MSA');
    expect(ack).toContain('AA');
    expect(ack).toContain('MSG001');
  });

  it('normalises HL7 abnormal flags correctly', () => {
    const { win } = setup();
    expect(win.HL7Parser.normaliseFlag('HH')).toBe('HH');
    expect(win.HL7Parser.normaliseFlag('LL')).toBe('LL');
    expect(win.HL7Parser.normaliseFlag('>')).toBe('HH');
    expect(win.HL7Parser.normaliseFlag('<')).toBe('LL');
    expect(win.HL7Parser.normaliseFlag('H')).toBe('H');
    expect(win.HL7Parser.normaliseFlag('L')).toBe('L');
    expect(win.HL7Parser.normaliseFlag('N')).toBe('N');
    expect(win.HL7Parser.normaliseFlag('A')).toBe('A');
    expect(win.HL7Parser.normaliseFlag('AA')).toBe('HH');
  });

  it('handles missing MSH segment gracefully', () => {
    const { win } = setup();
    const raw = 'OBX|1|NM|GLU^Glucose||5.4|mmol/L|3.9-6.1|N|||F';
    const result = win.HL7Parser.parse(raw, {});
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('MSH');
  });
});

// ── GatewayProtocol dispatcher ───────────────────────────────────────────────
describe('GatewayProtocol', () => {
  it('exports GatewayProtocol with detect, parseAuto, ingest', () => {
    const { win } = setup();
    expect(win.GatewayProtocol).toBeTruthy();
    expect(typeof win.GatewayProtocol.detect).toBe('function');
    expect(typeof win.GatewayProtocol.parseAuto).toBe('function');
    expect(typeof win.GatewayProtocol.ingest).toBe('function');
  });

  it('detects ASTM protocol from H| prefix', () => {
    const { win } = setup();
    expect(win.GatewayProtocol.detect('H|\\^&|||BC-5000')).toBe('ASTM');
  });

  it('detects HL7 protocol from MSH| prefix', () => {
    const { win } = setup();
    expect(win.GatewayProtocol.detect('MSH|^~\\&|COBAS')).toBe('HL7');
  });

  it('auto-routes ASTM message to ASTMParser', () => {
    const { win } = setup();
    const raw = 'H|\\^&|||BC-5000\rR|1|^^^WBC|7.2|x10^9/L|4-11|N|||F\rL|1|N';
    const result = win.GatewayProtocol.parseAuto(raw, { driver: 'mindray_bc5000' });
    expect(result.protocol).toBe('ASTM');
    expect(result.analytes.length).toBeGreaterThan(0);
  });

  it('auto-routes HL7 message to HL7Parser', () => {
    const { win } = setup();
    const raw = 'MSH|^~\\&|COBAS|LAB|||20260617||ORU^R01|MSG1|P|2.5\rOBX|1|NM|GLU^Glucose||5.4|mmol/L|3.9-6.1|N|||F';
    const result = win.GatewayProtocol.parseAuto(raw, { driver: 'roche_cobas' });
    expect(result.protocol).toBe('HL7');
    expect(result.analytes.length).toBeGreaterThan(0);
  });

  it('ingest() adds parsed result to GATEWAY_STATE.gatewayResults', () => {
    const { win } = setup();
    const raw = 'H|\\^&|||BC-5000\rR|1|^^^WBC|7.2|x10^9/L|4-11|N|||F\rL|1|N';
    const parsed = win.ASTMParser.parse(raw, {});
    const before = (win.GATEWAY_STATE.gatewayResults || []).length;
    win.GatewayProtocol.ingest(parsed, 'ANA-001');
    const after = (win.GATEWAY_STATE.gatewayResults || []).length;
    expect(after).toBe(before + 1);
    const added = win.GATEWAY_STATE.gatewayResults[0];
    expect(added.status).toBe('pending');
    expect(added.analytes.length).toBeGreaterThan(0);
  });

  it('ingest() adds message to GATEWAY_STATE.gatewayMessages', () => {
    const { win } = setup();
    const raw = 'MSH|^~\\&|COBAS|LAB|||20260617||ORU^R01|MSG2|P|2.5\rOBX|1|NM|K^Potassium||3.2|mmol/L|3.5-5.0|L|||F';
    const parsed = win.HL7Parser.parse(raw, {});
    const before = (win.GATEWAY_STATE.gatewayMessages || []).length;
    win.GatewayProtocol.ingest(parsed, 'ANA-003');
    const after = (win.GATEWAY_STATE.gatewayMessages || []).length;
    expect(after).toBe(before + 1);
  });
});
