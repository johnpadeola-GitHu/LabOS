// Tests for the 4-tier plan system.
// Covers: plan catalogue integrity, module access per tier, hard centre/staff
// limits, nav group gating, and add-on fee catalogue completeness.
import { describe, it, expect } from 'vitest';
import { bootLabOS } from './harness.js';

function setup() {
  const booted = bootLabOS();
  const { win, APP_STATE } = booted;
  const doc = win.document;
  ['modal-root', 'app'].forEach(id => {
    if (!doc.getElementById(id)) {
      const el = doc.createElement('div'); el.id = id; doc.body.appendChild(el);
    }
  });
  return { win, doc, booted, APP_STATE, S: win.S };
}

describe('Plan catalogue — 4 tiers', () => {
  it('has exactly 4 plans in tier order', () => {
    const { APP_STATE } = setup();
    const plans = APP_STATE.plans;
    expect(plans.length).toBe(4);
    expect(plans.map(p => p.code)).toEqual(['corecare', 'standard', 'professional', 'enterprise']);
    expect(plans.map(p => p.tier)).toEqual([1, 2, 3, 4]);
  });

  it('plan names match the agreed nomenclature', () => {
    const { APP_STATE } = setup();
    expect(APP_STATE.plans.map(p => p.name)).toEqual(['CoreCare', 'Standard', 'Professional', 'Enterprise']);
  });

  it('prices increase with each tier', () => {
    const { APP_STATE } = setup();
    const prices = APP_STATE.plans.map(p => p.annualPrice);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1]);
    }
  });

  it('every plan has a setup fee and monthly price', () => {
    const { APP_STATE } = setup();
    for (const p of APP_STATE.plans) {
      expect(p.setupFee).toBeGreaterThan(0);
      expect(p.monthlyPrice).toBeGreaterThan(0);
    }
  });

  it('only enterprise has unlimited centres', () => {
    const { APP_STATE } = setup();
    const plans = APP_STATE.plans;
    expect(plans.find(p => p.code === 'corecare').entitlements.maxCentres).toBe(1);
    expect(plans.find(p => p.code === 'standard').entitlements.maxCentres).toBe(3);
    expect(plans.find(p => p.code === 'professional').entitlements.maxCentres).toBe(10);
    expect(plans.find(p => p.code === 'enterprise').entitlements.maxCentres).toBe('unlimited');
  });

  it('add-on catalogue exists and covers extra-centre and SMS bundle', () => {
    const { APP_STATE } = setup();
    const addOns = APP_STATE.planAddOns || [];
    expect(addOns.length).toBeGreaterThan(0);
    expect(addOns.some(a => a.id === 'addon_centre_slot')).toBe(true);
    expect(addOns.some(a => a.id === 'addon_sms_bundle')).toBe(true);
    const centreAddOn = addOns.find(a => a.id === 'addon_centre_slot');
    expect(centreAddOn.applicablePlans).toContain('professional');
    expect(centreAddOn.applicablePlans).not.toContain('enterprise');
    expect(centreAddOn.applicablePlans).not.toContain('corecare');
  });
});

describe('Module access — plan-gated modules', () => {
  it('CoreCare: core diagnostics on, specialty still gated', () => {
    const { APP_STATE } = setup();
    const cc = APP_STATE.plans.find(p => p.code === 'corecare').entitlements.modules;
    // Core diagnostics included
    expect(cc.hematology).toBe(true);
    expect(cc.microbiology).toBe(true);
    expect(cc.immunology).toBe(true);
    expect(cc.packages).toBe(true);
    // Specialty still gated
    for (const mod of ['renal', 'histopath', 'molecular', 'imaging', 'imagingAdvanced', 'dna', 'biobank', 'research', 'toxicology', 'advancedAnalytics', 'apiAccess']) {
      expect(cc[mod]).toBe(false);
    }
  });

  it('Standard: adds Renal, Histopath, Toxicology over CoreCare', () => {
    const { APP_STATE } = setup();
    const std = APP_STATE.plans.find(p => p.code === 'standard').entitlements.modules;
    expect(std.hematology).toBe(true);
    expect(std.microbiology).toBe(true);
    expect(std.immunology).toBe(true);
    expect(std.packages).toBe(true);
    expect(std.renal).toBe(true);
    expect(std.histopath).toBe(true);
    expect(std.toxicology).toBe(true);
    // Still gated on Standard
    for (const mod of ['molecular', 'imaging', 'dna', 'biobank', 'research', 'advancedAnalytics', 'apiAccess']) {
      expect(std[mod]).toBe(false);
    }
  });

  it('Professional: specialty on but imagingAdvanced, dna, research off', () => {
    const { APP_STATE } = setup();
    const pro = APP_STATE.plans.find(p => p.code === 'professional').entitlements.modules;
    for (const mod of ['renal', 'histopath', 'molecular', 'imaging', 'biobank', 'advancedAnalytics', 'apiAccess', 'hematology', 'microbiology', 'immunology']) {
      expect(pro[mod]).toBe(true);
    }
    for (const mod of ['imagingAdvanced', 'dna', 'research', 'whiteLabel']) {
      expect(pro[mod]).toBe(false);
    }
  });

  it('Enterprise: every single module is enabled', () => {
    const { APP_STATE } = setup();
    const ent = APP_STATE.plans.find(p => p.code === 'enterprise').entitlements.modules;
    for (const [key, val] of Object.entries(ent)) {
      expect(val).toBe(true);
    }
  });
});

describe('Module gating — nav groups by plan', () => {
  it('CoreCare tenant sees fewer nav groups than Enterprise (gated specialty)', () => {
    const { win, APP_STATE } = setup();
    // Temporarily make a solo tenant and switch to it
    const soloTenant = APP_STATE.tenants.find(t => t.plan === 'corecare');
    if (!soloTenant) return; // skip if no solo tenant in seed
    win.enterTenantMode(soloTenant.id);
    win.renderShell();
    const groups = win.document.querySelectorAll('.nav-group[data-group]');
    // Solo should have far fewer groups than enterprise (Research/Genomics,
    // Imaging, BiobankOS, Clinical Packages, Diagnostics specialty all hidden)
    expect(groups.length).toBeLessThan(7);
  });

  it('Enterprise tenant sees all 7 nav groups', () => {
    const { win } = setup();
    win.enterTenantMode('tnt_pathcare'); // enterprise
    win.renderShell();
    const groups = win.document.querySelectorAll('.nav-group[data-group]');
    expect(groups.length).toBe(7);
  });

  it('Professional tenant does not see Research & Genomics (all items gated research:false)', () => {
    const { win } = setup();
    win.enterTenantMode('tnt_vitalis'); // professional
    win.renderShell();
    const nav = win.document.getElementById('sidebar-nav').innerHTML;
    expect(nav).not.toContain('Research &amp; Genomics');
    expect(nav).not.toContain('Sequencing Workflow');
  });

  it('Professional tenant does not see CT Scan or MRI (imagingAdvanced:false)', () => {
    const { win } = setup();
    win.enterTenantMode('tnt_vitalis');
    win.renderShell();
    const nav = win.document.getElementById('sidebar-nav').innerHTML;
    expect(nav).not.toContain('CT Scan');
    expect(nav).not.toContain('>MRI<');
  });

  it('Enterprise tenant sees CT Scan and MRI', () => {
    const { win } = setup();
    win.enterTenantMode('tnt_pathcare');
    win.renderShell();
    const nav = win.document.getElementById('sidebar-nav').innerHTML;
    expect(nav).toContain('CT Scan');
    expect(nav).toContain('MRI');
  });
});

describe('Centre hard limit — Professional (max 10)', () => {
  it('enforceCentreLimit returns false when under the limit', () => {
    const { win, booted } = setup(); const APP_STATE = booted.APP_STATE;
    win.enterTenantMode('tnt_vitalis'); // professional, max 10
    const orig = APP_STATE.centres.filter(c => c.tenantId === 'tnt_vitalis');
    APP_STATE.centres = APP_STATE.centres.filter(c => c.tenantId !== 'tnt_vitalis');
    APP_STATE.centres.push({ id: 'c1', tenantId: 'tnt_vitalis', name: 'HQ' });
    expect(win.enforceCentreLimit('test')).toBe(false);
    APP_STATE.centres = [...APP_STATE.centres.filter(c => c.tenantId !== 'tnt_vitalis'), ...orig];
  });

  it('enforceCentreLimit returns true (blocked) when at the limit of 10', () => {
    const { win, booted } = setup(); const APP_STATE = booted.APP_STATE;
    win.enterTenantMode('tnt_vitalis');
    // Fill exactly 10 centres
    APP_STATE.centres = APP_STATE.centres.filter(c => c.tenantId !== 'tnt_vitalis');
    APP_STATE.tenants.find(t => t.id === 'tnt_vitalis').branches = [];
    for (let i = 0; i < 10; i++) {
      APP_STATE.centres.push({ id: `cl${i}`, tenantId: 'tnt_vitalis', name: `Centre ${i}` });
    }
    expect(win.enforceCentreLimit('add a branch')).toBe(true); // blocked at 10
  });

  it('Enterprise tenant is never blocked regardless of centre count', () => {
    const { win, booted } = setup(); const APP_STATE = booted.APP_STATE;
    win.enterTenantMode('tnt_pathcare');
    // Add 20 centres
    for (let i = 0; i < 20; i++) {
      APP_STATE.centres.push({ id: `ce${i}`, tenantId: 'tnt_pathcare', name: `Centre ${i}` });
    }
    expect(win.enforceCentreLimit('add a branch')).toBe(false);
  });
});

describe('Staff limit enforcement', () => {
  it('enforceStaffLimit returns false under the limit', () => {
    const { win, booted } = setup(); const APP_STATE = booted.APP_STATE;
    win.enterTenantMode('tnt_vitalis'); // professional, limit 30
    const orig = APP_STATE.staff.slice();
    APP_STATE.staff = [{ name: 'A', active: true }];
    expect(win.enforceStaffLimit()).toBe(false);
    APP_STATE.staff = orig;
  });

  it('planTier returns correct tier per plan', () => {
    const { win } = setup();
    win.enterTenantMode('tnt_vitalis'); // professional = tier 3
    expect(win.planTier()).toBe(3);
    win.enterTenantMode('tnt_pathcare'); // enterprise = tier 4
    expect(win.planTier()).toBe(4);
  });
});
