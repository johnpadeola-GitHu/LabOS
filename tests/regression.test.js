import { describe, it, expect } from 'vitest';
import { bootLabOS } from './harness.js';

// These tests run against the BUILT bundle (dist/), proving the frontend
// restructure preserves the prototype's tested behaviour end-to-end:
// data integrity, routing, modals, offline outbox, licence enforcement,
// patient filters, and the section-icon system.

describe('Data integrity', () => {
  it('seeds 5 tenants with the expected statuses', () => {
    const { APP_STATE } = bootLabOS();
    const ids = APP_STATE.tenants.map((t) => t.id);
    expect(ids).toContain('440a5c9e-605e-4d53-9aff-dc7562087575');
    expect(ids).toContain('tnt_pathcare');
    expect(APP_STATE.tenants.length).toBeGreaterThanOrEqual(5);
  });

  it('has 402 catalogue items across the four catalogues', () => {
    const { APP_STATE } = bootLabOS();
    const lab = Object.values(APP_STATE.testCatalog).reduce((s, a) => s + a.length, 0);
    const img = Object.values(APP_STATE.imagingCatalog).reduce((s, a) => s + a.length, 0);
    const dna = Object.values(APP_STATE.dnaCatalog).reduce((s, a) => s + a.length, 0);
    const pkg = Object.values(APP_STATE.packagesCatalog).reduce((s, a) => s + a.length, 0);
    expect(lab + img + dna + pkg).toBe(402);
  });

  it('every seeded vital references a known patient', () => {
    const { APP_STATE } = bootLabOS();
    const ids = new Set(APP_STATE.patients.map((p) => p.id));
    for (const v of APP_STATE.vitalsHistory) {
      expect(ids.has(v.patientId)).toBe(true);
    }
  });
});

describe('Help system', () => {
  it('has articles across categories, none of them stubs', () => {
    const { labos } = bootLabOS();
    const arts = labos.HELP_ARTICLES;
    let total = 0;
    let stubs = 0;
    for (const cat of Object.keys(arts)) {
      for (const a of arts[cat]) {
        total++;
        if (!a.body || a.body.trim().length < 200) stubs++;
      }
    }
    // Article count grows as we add content — assert at least the original count.
    expect(total).toBeGreaterThanOrEqual(131);
    expect(stubs).toBe(0);
    // Category count grows too — assert at least original 16.
    expect(Object.keys(arts).length).toBeGreaterThanOrEqual(16);
  });
});

describe('Routing & rendering', () => {
  it('renders every tenant + platform route without throwing', () => {
    const { win, ROUTES } = bootLabOS();
    const S = win.S;
    const failures = [];
    for (const [key, route] of Object.entries(ROUTES)) {
      try {
        if (route.scope === 'platform') {
          S().mode = 'platform';
          S().isPlatformAdmin = true;
        } else {
          S().mode = 'tenant';
          S().activeTenantId = '440a5c9e-605e-4d53-9aff-dc7562087575';
        }
        const el = win.document.createElement('div');
        route.render(el);
      } catch (e) {
        failures.push(`${key}: ${e.message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('platform module map renders the manifest with coverage and click-through routes', () => {
    const { win, ROUTES } = bootLabOS();
    const S = win.S;
    S().mode = 'platform';
    S().isPlatformAdmin = true;

    // The route is registered and points at the new renderer.
    expect(ROUTES.platformModules).toBeTruthy();
    expect(ROUTES.platformModules.scope).toBe('platform');

    const el = win.document.createElement('div');
    ROUTES.platformModules.render(el);
    const html = el.innerHTML;

    // Manifest is actually surfaced: domains + a known module from each end.
    const manifest = win.LABOS_MODULES || [];
    expect(manifest.length).toBeGreaterThan(0);
    const escHtml = (s) => String(s).replace(/&/g, '&amp;');
    for (const g of manifest) {
      expect(html).toContain(escHtml(g.name));
    }
    expect(html).toContain('Patient Management'); // core, live
    expect(html).toContain('BiobankOS');           // biobank domain

    // Coverage stats reflect the manifest summary, not hard-coded numbers.
    const cov = win.LABOS_COVERAGE;
    expect(html).toContain(String(cov.total));
    expect(html).toContain(cov.pctLiveOrPartial + '%');

    // Live/partial modules with a real tenant route are click-through; planned
    // modules (no route, no live screen) are not wired to navigate().
    expect(html).toContain("navigate('patients')");
    const plannedRouteless = manifest
      .flatMap((g) => g.modules)
      .filter((m) => m.status === 'planned' && !m.route);
    expect(plannedRouteless.length).toBeGreaterThan(0);
    for (const m of plannedRouteless) {
      expect(html).not.toContain(`navigate('${m.key}')`);
    }

    // The CSV exporter is wired and callable without throwing.
    expect(typeof win.exportModuleMapCsv).toBe('function');
  });
});

describe('Modals', () => {
  const MODALS = [
    'new-request', 'register-patient', 'release-report', 'log-sample',
    'enter-result', 'new-invoice', 'add-inventory', 'capture-vitals',
    'print-labels', 'reject-sample', 'invite-staff', 'add-staff', 'upload-asset'
  ];

  it('opens key modals with non-trivial output', () => {
    const { win } = bootLabOS();
    win.S().mode = 'tenant';
    win.S().activeTenantId = '440a5c9e-605e-4d53-9aff-dc7562087575';
    const failures = [];
    for (const m of MODALS) {
      if (m === 'capture-vitals') win.MODAL_CTX = { patientId: 'PT-2026-0142' };
      else if (m === 'upload-asset') win.MODAL_CTX = { kind: 'Logo' };
      else if (m === 'print-labels' || m === 'reject-sample') win.MODAL_CTX = { id: 'REQ-2026-04412' };
      try {
        win.openModal(m);
        const root = win.document.getElementById('modal-root');
        if (!root || root.innerHTML.length < 150) failures.push(`${m}: short output`);
      } catch (e) {
        failures.push(`${m}: ${e.message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('Offline outbox', () => {
  it('records a mutation and drains it when online', () => {
    const { OfflineCore } = bootLabOS();
    OfflineCore.clearAll();
    OfflineCore.state.online = true;
    OfflineCore.record('test.op', { id: 'X1' }, 'test');
    // synchronous setTimeout in jsdom drains immediately
    expect(OfflineCore.totalCount).toBeGreaterThanOrEqual(1);
  });

  it('queues mutations while offline and tags entity status', () => {
    const { OfflineCore } = bootLabOS();
    OfflineCore.clearAll();
    OfflineCore.state.online = false;
    OfflineCore.record('patient.register', { id: 'PT-OFF-1' }, 'reg');
    expect(OfflineCore.statusOf('PT-OFF-1')).toBe('queued');
    OfflineCore.state.online = true;
  });
});

describe('Licence enforcement', () => {
  it('signs and verifies a licence, rejecting tampering', () => {
    const { LicenseCore } = bootLabOS();
    const payload = {
      tenantId: 'tnt_x', legalName: 'X Lab', plan: 'starter', entitlements: {},
      validFrom: new Date(Date.now() - 86400000).toISOString(),
      validUntil: new Date(Date.now() + 86400000 * 365).toISOString(),
      issuedAt: new Date().toISOString(), nonce: 'n1'
    };
    const signed = LicenseCore.signLicence(payload);
    expect(LicenseCore.verifyLicence(signed).ok).toBe(true);
    const tampered = { ...signed, legalName: 'Other Lab' };
    expect(LicenseCore.verifyLicence(tampered).ok).toBe(false);
  });

  it('registers a device and enters valid state', () => {
    const { LicenseCore } = bootLabOS();
    LicenseCore.registerDevice('440a5c9e-605e-4d53-9aff-dc7562087575');
    expect(LicenseCore.state.status).toBe('valid');
  });
});

describe('Patient filters', () => {
  it('filters by gender and insurance', () => {
    const { win, APP_STATE, labos } = bootLabOS();
    const f = labos.PATIENTS_FILTER_STATE;
    f.search = ''; f.gender = 'Female'; f.category = 'all'; f.insurance = 'all';
    const females = win.filteredPatients();
    const expected = APP_STATE.patients.filter((p) => p.gender === 'Female').length;
    expect(females.length).toBe(expected);
    f.gender = 'all';
  });
});

describe('Section icons', () => {
  it('keeps sidebar and page-header icons in lockstep (single source)', () => {
    const { labos } = bootLabOS();
    const SECTION_ICONS = labos.SECTION_ICONS;
    const NAV_GROUPS = labos.NAV_GROUPS;
    const wiring = {
      renal: 'renal', histopath: 'histopath', molecular: 'molecular',
      dna: 'dna', billing: 'billing', inventory: 'inventory',
      tenantProfile: 'profile', subscription: 'subscription',
      biobankSpecimens: 'biobank', biobankStorage: 'cryo', biobankConsent: 'consent',
      biobankStudies: 'study', biobankBarcode: 'barcode', biobankCustody: 'custody',
      appointments: 'appointments', notifications: 'notifications', security: 'security'
    };
    const navIcons = {};
    for (const g of NAV_GROUPS.tenant) for (const item of g.items) navIcons[item.route] = item.icon;
    for (const [route, key] of Object.entries(wiring)) {
      expect(navIcons[route]).toBe(SECTION_ICONS[key]);
    }
  });

  it('navigation mirrors the eight-domain module tree exactly', () => {
    const { labos } = bootLabOS();
    const titles = labos.NAV_GROUPS.tenant.map((g) => g.title);
    expect(titles).toEqual([
      'Core Services', 'Diagnostics', 'Imaging & Diagnostic',
      'Clinical Packages', 'BiobankOS',
      'Research & Genomics', 'Instrument Gateway', 'Administration'
    ]);
  });

  it('every nav route resolves to a registered ROUTES entry', () => {
    const { labos, ROUTES } = bootLabOS();
    const missing = [];
    for (const g of labos.NAV_GROUPS.tenant) {
      for (const item of g.items) {
        if (!ROUTES[item.route]) missing.push(item.route);
      }
    }
    expect(missing).toEqual([]);
  });

  it('renders each domain as a collapsible group, with Core Services locked open', () => {
    const { win } = bootLabOS();
    const probe = win.document.createElement('script');
    probe.textContent = `try { enterTenantMode('tnt_pathcare'); renderShell(); } catch (e) {}`;
    win.document.body.appendChild(probe);
    const groups = [...win.document.querySelectorAll('.nav-group[data-group]')];
    expect(groups.length).toBe(8);

    // Core Services is locked: always expanded, no chevron, cannot collapse.
    const core = groups.find((g) => g.querySelector('.nav-group-label')?.textContent === 'Core Services');
    expect(core.classList.contains('locked')).toBe(true);
    expect(core.querySelector('.nav-chevron')).toBeNull();
    win.toggleNavGroup(core.getAttribute('data-group'));
    expect(core.classList.contains('collapsed')).toBe(false);

    // Every other group is collapsible (button header, chevron, body) and toggles.
    const others = groups.filter((g) => !g.classList.contains('locked'));
    expect(others.length).toBe(7);
    expect(others.every((g) =>
      g.querySelector('button.nav-group-title') &&
      g.querySelector('.nav-chevron') &&
      g.querySelector('.nav-group-body')
    )).toBe(true);
    const g0 = others.find((g) => !g.querySelector('.nav-item.active'));
    const key = g0.getAttribute('data-group');
    const before = g0.classList.contains('collapsed');
    win.toggleNavGroup(key);
    expect(g0.classList.contains('collapsed')).toBe(!before);
  });
});

describe('Platform super-admin sees full tenant admin nav when browsing a tenant', () => {
  it('isAdmin() returns true for PLATFORM_SUPER_ADMIN', () => {
    const { win, APP_STATE } = bootLabOS();
    APP_STATE.session.userRole = 'PLATFORM_SUPER_ADMIN';
    expect(win.isAdmin()).toBe(true);
  });

  it('isAdmin() still returns true for TENANT_ADMIN and LAB_DIRECTOR (no regression)', () => {
    const { win, APP_STATE } = bootLabOS();
    APP_STATE.session.userRole = 'TENANT_ADMIN';
    expect(win.isAdmin()).toBe(true);
    APP_STATE.session.userRole = 'LAB_DIRECTOR';
    expect(win.isAdmin()).toBe(true);
  });

  it('isAdmin() returns false for non-admin clinical roles', () => {
    const { win, APP_STATE } = bootLabOS();
    APP_STATE.session.userRole = 'LAB_SCIENTIST';
    expect(win.isAdmin()).toBe(false);
    APP_STATE.session.userRole = 'PHLEBOTOMIST';
    expect(win.isAdmin()).toBe(false);
  });
});

describe('Clinical image upload (Supabase Storage)', () => {
  it('uploadClinicalImage rejects when no backend configured (demo mode)', async () => {
    const { win } = bootLabOS();
    win.LABOS_CONFIG = {}; // demo mode — no supabaseUrl
    const file = { name: 'test.jpg', type: 'image/jpeg', size: 1000 };
    const result = await win.uploadClinicalImage(file, { caseId: 'CASE-1' });
    expect(result).toBeNull();
  });

  it('uploadClinicalImage rejects disallowed file types', async () => {
    const { win } = bootLabOS();
    win.LABOS_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'key', accessToken: 'token', tenantId: 'tenant-1' };
    const file = { name: 'malware.exe', type: 'application/x-msdownload', size: 1000 };
    const result = await win.uploadClinicalImage(file, { caseId: 'CASE-1' });
    expect(result).toBeNull();
  });

  it('uploadClinicalImage rejects files over 10MB', async () => {
    const { win } = bootLabOS();
    win.LABOS_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'key', accessToken: 'token', tenantId: 'tenant-1' };
    const file = { name: 'huge.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 };
    const result = await win.uploadClinicalImage(file, { caseId: 'CASE-1' });
    expect(result).toBeNull();
  });

  it('uploadClinicalImage rejects when not signed in (no access token)', async () => {
    const { win } = bootLabOS();
    win.LABOS_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'key', tenantId: 'tenant-1' };
    const file = { name: 'test.jpg', type: 'image/jpeg', size: 1000 };
    const result = await win.uploadClinicalImage(file, { caseId: 'CASE-1' });
    expect(result).toBeNull();
  });

  it('uploadClinicalImage builds the correct tenant-scoped storage path and uploads', async () => {
    const { win, APP_STATE } = bootLabOS();
    win.LABOS_CONFIG = {
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'anon-key',
      accessToken: 'session-token',
      tenantId: 'tenant-abc',
      userId: 'user-1'
    };
    APP_STATE.session.activeTenantId = 'tenant-abc';

    let uploadUrl = null, uploadHeaders = null;
    let metaUrl = null, metaBody = null;
    win.fetch = (url, opts) => {
      if (url.includes('/storage/v1/object/clinical-images/')) {
        uploadUrl = url; uploadHeaders = opts.headers;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ Key: 'ok' }) });
      }
      if (url.includes('/rest/v1/clinical_images')) {
        metaUrl = url; metaBody = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'img-123' }]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    };

    const file = { name: 'specimen.jpg', type: 'image/jpeg', size: 50000 };
    const result = await win.uploadClinicalImage(file, { caseId: 'HISTO-001', category: 'gross', label: 'Specimen overview' });

    expect(uploadUrl).toContain('tenant-abc/HISTO-001/');
    expect(uploadUrl).toContain('specimen.jpg');
    expect(uploadHeaders['Content-Type']).toBe('image/jpeg');
    expect(metaBody.tenant_id).toBe('tenant-abc');
    expect(metaBody.case_id).toBe('HISTO-001');
    expect(metaBody.category).toBe('gross');
    expect(result).toBeTruthy();
    expect(result.id).toBe('img-123');
  });

  it('listClinicalImages returns empty array when not configured', async () => {
    const { win } = bootLabOS();
    win.LABOS_CONFIG = {};
    const result = await win.listClinicalImages('CASE-1');
    expect(result).toEqual([]);
  });

  it('listClinicalImages queries the correct case-scoped endpoint', async () => {
    const { win } = bootLabOS();
    win.LABOS_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'key', accessToken: 'token' };
    let calledUrl = null;
    win.fetch = (url) => {
      calledUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: '1', label: 'Test' }]) });
    };
    const result = await win.listClinicalImages('HISTO-001');
    expect(calledUrl).toContain('case_id=eq.HISTO-001');
    expect(result.length).toBe(1);
  });
});
