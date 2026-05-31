// Tests for patient registration form fixes:
// 1. Age auto-calculates from DOB
// 2. Next of kin is a structured name + relationship dropdown
// 3. Emergency phone is required (blocks submit if empty)
// 4. 36 states + FCT with cascading LGA dropdown
import { describe, it, expect, beforeEach } from 'vitest';
import { bootLabOS } from './harness.js';

function setup() {
  const booted = bootLabOS();
  const { win } = booted;
  const doc = win.document;
  // Ensure modal root exists.
  if (!doc.getElementById('modal-root')) {
    const m = doc.createElement('div'); m.id = 'modal-root'; doc.body.appendChild(m);
  }
  win.openModal('register-patient');
  const modal = () => doc.getElementById('modal-root').innerHTML;
  const el = (id) => doc.getElementById(id);
  return { win, doc, booted, modal, el };
}

describe('Patient registration — Nigeria geo data', () => {
  it('loads 37 states (36 + FCT)', () => {
    const { win } = setup();
    expect(Array.isArray(win.NIGERIA_GEO)).toBe(true);
    expect(win.NIGERIA_GEO.length).toBe(37);
  });

  it('includes FCT Abuja with its 6 area councils', () => {
    const { win } = setup();
    const fct = win.NIGERIA_GEO.find((s) => s.state === 'FCT Abuja');
    expect(fct).toBeTruthy();
    expect(fct.lgas).toContain('Municipal Area Council');
    expect(fct.lgas.length).toBe(6);
  });

  it('Lagos has exactly 20 LGAs', () => {
    const { win } = setup();
    const lagos = win.NIGERIA_GEO.find((s) => s.state === 'Lagos');
    expect(lagos.lgas.length).toBe(20);
    expect(lagos.lgas).toContain('Ikeja');
    expect(lagos.lgas).toContain('Lagos Island');
  });

  it('Kano has 44 LGAs (largest)', () => {
    const { win } = setup();
    const kano = win.NIGERIA_GEO.find((s) => s.state === 'Kano');
    expect(kano.lgas.length).toBe(44);
  });

  it('every state has at least one LGA', () => {
    const { win } = setup();
    for (const s of win.NIGERIA_GEO) {
      expect(s.lgas.length).toBeGreaterThan(0);
    }
  });
});

describe('Patient registration modal — state/LGA cascade', () => {
  it('renders the state dropdown with all 37 entries', () => {
    const { modal, el } = setup();
    expect(el('rp-state')).toBeTruthy();
    const options = el('rp-state').querySelectorAll('option[value]:not([value=""])');
    expect(options.length).toBe(37);
  });

  it('LGA dropdown starts blank until state is chosen', () => {
    const { el } = setup();
    const lga = el('rp-lga');
    expect(lga.tagName).toBe('SELECT');
    expect(lga.options[0].text).toMatch(/Select state first/i);
    expect(lga.options.length).toBe(1);
  });

  it('rpUpdateLgas populates LGAs when a state is selected', () => {
    const { win, el } = setup();
    el('rp-state').value = 'Lagos';
    win.rpUpdateLgas();
    const lga = el('rp-lga');
    const lgaNames = [...lga.options].map((o) => o.value).filter(Boolean);
    expect(lgaNames.length).toBe(20);
    expect(lgaNames).toContain('Ikeja');
    expect(lgaNames).toContain('Surulere');
  });

  it('rpUpdateLgas updates correctly when state changes', () => {
    const { win, el } = setup();
    el('rp-state').value = 'Rivers';
    win.rpUpdateLgas();
    const lgaNames = [...el('rp-lga').options].map((o) => o.value).filter(Boolean);
    expect(lgaNames).toContain('Port Harcourt');
    expect(lgaNames).toContain('Obio/Akpor');
    expect(lgaNames.length).toBe(23);
  });
});

describe('Patient registration modal — age auto-calculation', () => {
  it('rpCalcAge shows years for a past date of birth', () => {
    const { win, el } = setup();
    // Set DOB to approx 30 years ago.
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);
    el('rp-dob').value = dob.toISOString().slice(0, 10);
    win.rpCalcAge();
    const age = el('rp-age').value;
    expect(age).toMatch(/^(29|30) yrs?$/);  // ±1 depending on birthday
  });

  it('rpCalcAge shows months for a baby born this year', () => {
    const { win, el } = setup();
    const dob = new Date();
    dob.setMonth(dob.getMonth() - 4);
    el('rp-dob').value = dob.toISOString().slice(0, 10);
    win.rpCalcAge();
    const age = el('rp-age').value;
    expect(age).toMatch(/mo/);
  });

  it('rpCalcAge clears field for a future date', () => {
    const { win, el } = setup();
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    el('rp-dob').value = future.toISOString().slice(0, 10);
    win.rpCalcAge();
    expect(el('rp-age').value).toBe('');
  });

  it('age value updates again when DOB changes a second time', () => {
    const { win, el } = setup();
    const dob1 = new Date(); dob1.setFullYear(dob1.getFullYear() - 25);
    el('rp-dob').value = dob1.toISOString().slice(0, 10);
    win.rpCalcAge();
    expect(el('rp-age').value).toMatch(/2[45]/);  // 24 or 25 depending on birthday
    const dob2 = new Date(); dob2.setFullYear(dob2.getFullYear() - 40);
    el('rp-dob').value = dob2.toISOString().slice(0, 10);
    win.rpCalcAge();
    expect(el('rp-age').value).toMatch(/40/);
  });
});

describe('Patient registration modal — next of kin + emergency phone', () => {
  it('renders separate name input and relationship select for NOK', () => {
    const { el } = setup();
    expect(el('rp-kin-name')).toBeTruthy();
    expect(el('rp-kin-rel')).toBeTruthy();
    expect(el('rp-kin-rel').tagName).toBe('SELECT');
    const rels = [...el('rp-kin-rel').options].map((o) => o.value).filter(Boolean);
    expect(rels).toContain('Spouse');
    expect(rels).toContain('Parent');
    expect(rels).toContain('Guardian');
  });

  it('NOK name + relationship are stored as "Name (Relationship)" on submit', () => {
    const { win, el, booted } = setup();
    el('rp-name').value = 'Adaeze Okafor';
    el('rp-gender').value = 'Female';
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - 34);
    el('rp-dob').value = dob.toISOString().slice(0, 10);
    el('rp-phone').value = '+2348030001111';
    el('rp-emergency').value = '+2348030002222';
    el('rp-kin-name').value = 'Emeka Okafor';
    el('rp-kin-rel').value = 'Spouse';
    win.submitRegisterPatient();
    const patient = booted.APP_STATE.patients[0];
    expect(patient.nextOfKin).toBe('Emeka Okafor (Spouse)');
    expect(patient.emergencyPhone).toBe('+2348030002222');
  });

  it('emergency phone is required — submit is blocked when empty', () => {
    const { win, el, booted } = setup();
    el('rp-name').value = 'Test Patient';
    el('rp-gender').value = 'Female';
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - 20);
    el('rp-dob').value = dob.toISOString().slice(0, 10);
    el('rp-phone').value = '+2348000000000';
    el('rp-emergency').value = ''; // missing
    const before = booted.APP_STATE.patients.length;
    // $req calls scrollIntoView (not in jsdom) — swallow the error, the
    // important assertion is that no patient was added.
    try { win.submitRegisterPatient(); } catch (_) {}
    expect(booted.APP_STATE.patients.length).toBe(before);
  });
});
