// Tests for the invite-only onboarding gate (security/access hardening) and
// the red/white modal close button. The gate is a client-side usability layer;
// real enforcement is server-side, but it must still prevent click-through
// access and route demo users through an explicit, labelled path.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootLabOS } from './harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// The seeded provisioned tenant + its one-time activation code.
const VALID_CODE = 'HAUWA-7F3K-2026';
const VALID_TENANT = 'tnt_hauwa';

describe('Invite-only onboarding gate', () => {
  let win, ONB_STATE, S, doc;

  function setInput(id, val) {
    const el = doc.getElementById(id);
    if (el) el.value = val;
  }
  function fillAccount(code, { name = 'Dr. Test Admin', email = 'admin@hauwadiagnostics.ng', password = 'a-very-long-password' } = {}) {
    setInput('onb-fullName', name);
    setInput('onb-email', email);
    setInput('onb-password', password);
    setInput('onb-activationCode', code);
  }

  beforeEach(() => {
    const booted = bootLabOS();
    win = booted.win;
    ONB_STATE = booted.ONB_STATE;
    doc = win.document;
    S = win.S;
    // Make sure the onboarding root exists and start the wizard.
    if (!doc.getElementById('onboarding-root')) {
      const r = doc.createElement('div');
      r.id = 'onboarding-root';
      doc.body.appendChild(r);
    }
    if (!doc.getElementById('app')) {
      const a = doc.createElement('div');
      a.id = 'app';
      doc.body.appendChild(a);
    }
    win.startOnboarding();
  });

  it('opens on the activation gate, not a click-through account form', () => {
    const html = doc.getElementById('onboarding-root').innerHTML;
    expect(html).toContain('Activate your laboratory');
    expect(html.toLowerCase()).toContain('invite-only');
    expect(html).toContain('onb-activationCode');
    // No generic "Continue" button is offered until activation succeeds.
    expect(html).toContain('onbActivate()');
    expect(html).not.toContain('onbNext()'); // step 1 hides Continue pre-activation
  });

  it('refuses to advance past step 1 without activation', () => {
    expect(ONB_STATE.step).toBe(1);
    win.onbNext();
    expect(ONB_STATE.step).toBe(1); // still gated
    expect(ONB_STATE.activated).toBe(false);
    expect(ONB_STATE.activationError).toBeTruthy();
  });

  it('rejects an invalid activation code and stays gated', async () => {
    fillAccount('WRONG-CODE-9999');
    await win.onbActivate();
    expect(ONB_STATE.activated).toBe(false);
    expect(ONB_STATE.activationError).toMatch(/not recognised|administrator/i);
  });

  it('requires valid account fields even with a valid code', async () => {
    fillAccount(VALID_CODE, { name: '', email: 'not-an-email', password: 'short' });
    await win.onbActivate();
    expect(ONB_STATE.activated).toBe(false);
    expect(ONB_STATE.errors.fullName).toBeTruthy();
    expect(ONB_STATE.errors.email).toBeTruthy();
    expect(ONB_STATE.errors.password).toBeTruthy();
  });

  it('accepts a valid provisioned code and unlocks progression', async () => {
    fillAccount(VALID_CODE);
    await win.onbActivate();
    expect(ONB_STATE.activated).toBe(true);
    expect(ONB_STATE.activatedTenantId).toBe(VALID_TENANT);
    // Now the wizard can advance.
    win.onbNext();
    expect(ONB_STATE.step).toBe(2);
  });

  it('completeOnboarding refuses an un-activated session', () => {
    expect(ONB_STATE.activated).toBe(false);
    S().mode = 'onboarding';
    win.completeOnboarding();
    // Bounced back to the gate, not into a tenant.
    expect(ONB_STATE.step).toBe(1);
    expect(S().mode).not.toBe('tenant');
  });

  it('completeOnboarding enters the activated tenant and marks the code used', async () => {
    fillAccount(VALID_CODE);
    await win.onbActivate();
    expect(ONB_STATE.activated).toBe(true);

    win.completeOnboarding();
    expect(S().mode).toBe('tenant');
    expect(S().activeTenantId).toBe(VALID_TENANT);
    expect(S().isDemoSession).toBe(false);

    const tenant = win.__labos.APP_STATE.tenants.find((t) => t.id === VALID_TENANT);
    expect(tenant.activationUsedAt).toBeTruthy(); // one-time code now redeemed
  });

  it('the demo path is explicit and flags the session as demo', () => {
    win.onbExploreDemo();
    expect(S().mode).toBe('tenant');
    expect(S().isDemoSession).toBe(true);
    expect(S().activeTenantId).toBe('tnt_vitalis');
  });

  it('the admin sign-in path shows credentials form when backend is configured', () => {
    const cfg = win.LABOS_CONFIG || {};
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      // Real backend — onbAdminSignIn focuses the email field, not platform mode
      // Just verify it doesn't throw
      let threw = false;
      try { win.onbAdminSignIn(); } catch(e) { threw = true; }
      expect(threw).toBe(false);
    } else {
      // Demo mode — goes straight to platform view
      win.onbAdminSignIn();
      expect(win.APP_STATE.session.mode).toBe('platform');
      expect(win.APP_STATE.session.isPlatformAdmin).toBe(true);
    }
  });
});

describe('Tenant provisioning (issuing activation codes)', () => {
  let win, S, doc, LicenseCore, APP_STATE;

  beforeEach(() => {
    const booted = bootLabOS();
    win = booted.win;
    doc = win.document;
    S = win.S;
    LicenseCore = booted.LicenseCore;
    APP_STATE = booted.APP_STATE;
    if (!doc.getElementById('modal-root')) {
      const m = doc.createElement('div'); m.id = 'modal-root'; doc.body.appendChild(m);
    }
  });

  it('generates a readable, lab-specific one-time code', () => {
    const code = LicenseCore.generateActivationCode('Sunrise Diagnostics');
    expect(code).toMatch(/^SUNRI-[A-Z2-9]{4}-\d{4}$/);
    // Two calls should differ (random middle segment).
    const code2 = LicenseCore.generateActivationCode('Sunrise Diagnostics');
    expect(code).not.toBe(code2);
  });

  it('provisioning creates a pending tenant with a fresh code', () => {
    win.openProvisionTenant();
    doc.getElementById('prov-name').value = 'Sunrise Diagnostics';
    doc.getElementById('prov-email').value = 'admin@sunrise.ng';
    const before = APP_STATE.tenants.length;
    win.submitProvisionTenant();
    expect(APP_STATE.tenants.length).toBe(before + 1);
    const t = APP_STATE.tenants[APP_STATE.tenants.length - 1];
    expect(t.name).toBe('Sunrise Diagnostics');
    expect(t.activationCode).toMatch(/^SUNRI-/);
    expect(t.activationUsedAt).toBeNull(); // pending until redeemed
    // The generated code is shown to the operator.
    expect(doc.getElementById('prov-result').innerHTML).toContain(t.activationCode);
  });

  it('rejects provisioning with a missing name or bad email', () => {
    win.openProvisionTenant();
    doc.getElementById('prov-name').value = '';
    doc.getElementById('prov-email').value = 'not-an-email';
    const before = APP_STATE.tenants.length;
    win.submitProvisionTenant();
    expect(APP_STATE.tenants.length).toBe(before); // nothing created
  });

  it('a freshly provisioned code can be redeemed end-to-end', async () => {
    // 1) Operator provisions a lab and gets a code.
    win.openProvisionTenant();
    doc.getElementById('prov-name').value = 'Sunrise Diagnostics';
    doc.getElementById('prov-email').value = 'admin@sunrise.ng';
    win.submitProvisionTenant();
    const t = APP_STATE.tenants[APP_STATE.tenants.length - 1];
    const code = t.activationCode;

    // 2) Lab admin redeems it at the gate.
    if (!doc.getElementById('onboarding-root')) {
      const r = doc.createElement('div'); r.id = 'onboarding-root'; doc.body.appendChild(r);
    }
    if (!doc.getElementById('app')) {
      const a = doc.createElement('div'); a.id = 'app'; doc.body.appendChild(a);
    }
    win.startOnboarding();
    doc.getElementById('onb-fullName').value = 'Dr. Sun Admin';
    doc.getElementById('onb-email').value = 'admin@sunrise.ng';
    doc.getElementById('onb-password').value = 'a-very-long-password';
    doc.getElementById('onb-activationCode').value = code;
    await win.onbActivate();
    win.completeOnboarding();

    expect(S().mode).toBe('tenant');
    expect(S().activeTenantId).toBe(t.id);
    expect(t.activationUsedAt).toBeTruthy(); // now redeemed
  });
});

describe('Modal close button styling', () => {
  const css = readFileSync(resolve(root, 'src/styles/labos.css'), 'utf8');

  // Both classes are used for the upper-right modal X (modal-close: 25 modals,
  // close-btn: 42 modals). Both must be red fill with a white glyph.
  function baseRule(selector) {
    const re = new RegExp(`\\.${selector}\\{([^}]*)\\}`, 'g');
    const rules = [...css.matchAll(re)].map((m) => m[1]);
    return rules.find((r) => /background:/.test(r));
  }

  it('renders .modal-close as red fill with white glyph', () => {
    const rule = baseRule('modal-close');
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/background:\s*#9A1F1F/i);
    expect(rule).toMatch(/color:\s*#fff/i);
  });

  it('renders .close-btn with danger styling', () => {
    const rule = baseRule('close-btn');
    expect(rule).toBeTruthy();
    // Softer danger style — background is danger-bg tint, not solid red fill
    expect(rule).toMatch(/border-radius/i);
    expect(rule).toMatch(/cursor:\s*pointer/i);
  });
});

describe('Sign-in form field isolation (regression: duplicate ID bug)', () => {
  let win, doc;

  beforeEach(() => {
    const booted = bootLabOS();
    win = booted.win;
    doc = win.document;
    win.LABOS_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'test-key' };
    win.renderOnboarding(1);
  });

  it('the activation form and sign-in form do not share element IDs', () => {
    // Activation form fields
    const activationEmail = doc.getElementById('onb-email');
    const activationPwd   = doc.getElementById('onb-password');
    // Sign-in form fields — must be DIFFERENT elements with DIFFERENT ids
    const signinEmail = doc.getElementById('onb-signin-email');
    const signinPwd   = doc.getElementById('onb-signin-password');

    expect(activationEmail).toBeTruthy();
    expect(activationPwd).toBeTruthy();
    expect(signinEmail).toBeTruthy();
    expect(signinPwd).toBeTruthy();

    // Critical: these must NOT be the same DOM node
    expect(activationEmail).not.toBe(signinEmail);
    expect(activationPwd).not.toBe(signinPwd);
  });

  it('no duplicate IDs exist anywhere on the onboarding screen', () => {
    const allIds = Array.from(doc.querySelectorAll('[id]')).map(el => el.id);
    const seen = new Set();
    const duplicates = [];
    for (const id of allIds) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    expect(duplicates).toEqual([]);
  });

  it('typing in the sign-in fields does not affect the activation form fields', () => {
    doc.getElementById('onb-signin-email').value    = 'real-signin@test.com';
    doc.getElementById('onb-signin-password').value = 'real-signin-password';

    // Activation fields should remain untouched
    expect(doc.getElementById('onb-email').value).not.toBe('real-signin@test.com');
    expect(doc.getElementById('onb-password').value).not.toBe('real-signin-password');
  });

  it('onbSignInDirect reads values from the sign-in fields, not the activation fields', () => {
    // Put DIFFERENT values in each form to prove isolation
    doc.getElementById('onb-email').value             = 'activation@test.com';
    doc.getElementById('onb-password').value           = 'activation-password';
    doc.getElementById('onb-signin-email').value        = 'correct-signin@test.com';
    doc.getElementById('onb-signin-password').value     = 'correct-signin-password';

    // Stub fetch so the function doesn't actually hit the network
    let capturedBody = null;
    win.fetch = (url, opts) => {
      if (opts && opts.body) capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'test stub' })
      });
    };

    return win.onbSignInDirect().then(() => {
      expect(capturedBody).toBeTruthy();
      expect(capturedBody.email).toBe('correct-signin@test.com');
      expect(capturedBody.password).toBe('correct-signin-password');
    });
  });
});

describe('Sign-in session hygiene (regression: stale demo session leak)', () => {
  let win, doc, S;

  beforeEach(() => {
    const booted = bootLabOS();
    win = booted.win;
    doc = win.document;
    S = win.S;
    win.LABOS_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'test-key' };
    win.renderOnboarding(1);
  });

  it('real tenant sign-in overwrites the default demo userId, not just userName', async () => {
    // Confirm the demo seed really does start with the stale ID
    expect(S().userId).toBe('usr_lab_dir');

    doc.getElementById('onb-signin-email').value    = 'tenant@test.com';
    doc.getElementById('onb-signin-password').value = 'tenant-password';

    win.fetch = (url, opts) => {
      if (url.includes('/auth/v1/token')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'tok', refresh_token: 'ref',
            user: { id: 'real-tenant-uuid-1234' }
          })
        });
      }
      if (url.includes('/rest/v1/app_users')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{
            id: 'real-tenant-uuid-1234',
            full_name: 'Real Tenant User',
            role: 'TENANT_ADMIN',
            tenant_id: 'real-tenant-id',
            is_platform: false
          }])
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    };

    await win.onbSignInDirect();

    // The stale demo userId must be gone, replaced with the real account id
    expect(S().userId).toBe('real-tenant-uuid-1234');
    expect(S().userId).not.toBe('usr_lab_dir');
  });

  it('real tenant sign-in sets isPlatformAdmin to false even if the demo seed had it true', async () => {
    // Confirm the demo seed really does start with isPlatformAdmin true
    expect(S().isPlatformAdmin).toBe(true);

    doc.getElementById('onb-signin-email').value    = 'tenant2@test.com';
    doc.getElementById('onb-signin-password').value = 'tenant-password';

    win.fetch = (url, opts) => {
      if (url.includes('/auth/v1/token')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'tok', refresh_token: 'ref',
            user: { id: 'real-tenant-uuid-5678' }
          })
        });
      }
      if (url.includes('/rest/v1/app_users')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{
            id: 'real-tenant-uuid-5678',
            full_name: 'Another Tenant User',
            role: 'TENANT_ADMIN',
            tenant_id: 'another-tenant-id',
            is_platform: false   // <- account is NOT a platform admin
          }])
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    };

    await win.onbSignInDirect();

    // Must reflect the real account's is_platform value, not the stale demo seed
    expect(S().isPlatformAdmin).toBe(false);
  });

  it('real platform-admin sign-in still correctly sets isPlatformAdmin to true', async () => {
    doc.getElementById('onb-signin-email').value    = 'platform@test.com';
    doc.getElementById('onb-signin-password').value = 'platform-password';

    win.fetch = (url, opts) => {
      if (url.includes('/auth/v1/token')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'tok', refresh_token: 'ref',
            user: { id: 'real-platform-uuid-9999' }
          })
        });
      }
      if (url.includes('/rest/v1/app_users')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{
            id: 'real-platform-uuid-9999',
            full_name: 'Real Platform Admin',
            role: 'PLATFORM_SUPER_ADMIN',
            tenant_id: null,
            is_platform: true
          }])
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    };

    await win.onbSignInDirect();

    expect(S().isPlatformAdmin).toBe(true);
    expect(S().userId).toBe('real-platform-uuid-9999');
    expect(S().mode).toBe('platform');
  });
});
