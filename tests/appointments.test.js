// Tests for the rebuilt appointment modal.
// Covers: comprehensive type list, grouped optgroups, all new fields,
// recurrence shown only for dialysis, real centres from tenant,
// provider pulled from staff, both booking statuses, priority field.
import { describe, it, expect, beforeEach } from 'vitest';
import { bootLabOS } from './harness.js';

function setup() {
  const booted = bootLabOS();
  const { win } = booted;
  const doc = win.document;
  ['modal-root','app'].forEach(id => {
    if (!doc.getElementById(id)) {
      const el = doc.createElement('div'); el.id = id; doc.body.appendChild(el);
    }
  });
  win.enterTenantMode('440a5c9e-605e-4d53-9aff-dc7562087575');
  win.openAppointment();
  const el = id => doc.getElementById(id);
  return { win, doc, booted, el };
}

describe('Appointment modal — type coverage', () => {
  it('renders grouped appointment types with optgroups', () => {
    const { el } = setup();
    const sel = el('apt-type');
    expect(sel).toBeTruthy();
    const groups = [...sel.querySelectorAll('optgroup')].map(g => g.label);
    expect(groups).toContain('Sample Collection');
    expect(groups).toContain('Imaging & Diagnostics');
    expect(groups).toContain('Consultations');
    expect(groups).toContain('Procedures');
    expect(groups).toContain('Screening Programmes');
    expect(groups).toContain('Other');
  });

  it('includes at least 35 distinct appointment types', () => {
    const { el } = setup();
    const types = [...el('apt-type').querySelectorAll('option')].map(o => o.value).filter(Boolean);
    expect(types.length).toBeGreaterThanOrEqual(35);
  });

  it('covers all key diagnostic lab visit types', () => {
    const { el } = setup();
    const types = [...el('apt-type').querySelectorAll('option')].map(o => o.text);
    // Sample collection
    expect(types.some(t => /fasting/i.test(t))).toBe(true);
    expect(types.some(t => /phlebotomy/i.test(t))).toBe(true);
    expect(types.some(t => /24.hour urine/i.test(t))).toBe(true);
    expect(types.some(t => /home.*phlebotomy|mobile/i.test(t))).toBe(true);
    // Imaging
    expect(types.some(t => /X.Ray/i.test(t))).toBe(true);
    expect(types.some(t => /CT Scan/i.test(t))).toBe(true);
    expect(types.some(t => /MRI/i.test(t))).toBe(true);
    expect(types.some(t => /ECG/i.test(t))).toBe(true);
    expect(types.some(t => /mammography/i.test(t))).toBe(true);
    // Procedures
    expect(types.some(t => /dialysis/i.test(t))).toBe(true);
    expect(types.some(t => /vaccination/i.test(t))).toBe(true);
    expect(types.some(t => /endoscopy/i.test(t))).toBe(true);
    // Screening
    expect(types.some(t => /immigration|travel medical/i.test(t))).toBe(true);
    expect(types.some(t => /antenatal/i.test(t))).toBe(true);
    expect(types.some(t => /NDLEA|drug screening/i.test(t))).toBe(true);
    expect(types.some(t => /insurance medical/i.test(t))).toBe(true);
    // Consultations
    expect(types.some(t => /follow.up/i.test(t))).toBe(true);
    expect(types.some(t => /telemedicine/i.test(t))).toBe(true);
  });
});

describe('Appointment modal — new fields', () => {
  it('renders all new fields: priority, duration, provider, referring, room, insurance, remind, notes', () => {
    const { el } = setup();
    expect(el('apt-priority')).toBeTruthy();
    expect(el('apt-duration')).toBeTruthy();
    expect(el('apt-provider')).toBeTruthy();
    expect(el('apt-referring')).toBeTruthy();
    expect(el('apt-room')).toBeTruthy();
    expect(el('apt-insurance')).toBeTruthy();
    expect(el('apt-remind')).toBeTruthy();
    expect(el('apt-notes')).toBeTruthy();
    expect(el('apt-notes').tagName).toBe('TEXTAREA');
  });

  it('priority has Routine, Urgent, Emergency options', () => {
    const { el } = setup();
    const opts = [...el('apt-priority').options].map(o => o.value);
    expect(opts).toContain('Routine');
    expect(opts).toContain('Urgent');
    expect(opts).toContain('Emergency');
  });

  it('provider dropdown is populated from tenant staff', () => {
    const { el, booted } = setup();
    const staffNames = (booted.APP_STATE.staff || []).map(s => s.name);
    const providerOpts = [...el('apt-provider').querySelectorAll('option')]
      .map(o => o.value).filter(v => v !== 'TBA');
    expect(providerOpts.length).toBeGreaterThan(0);
    expect(providerOpts.some(name => staffNames.includes(name))).toBe(true);
  });

  it('insurance covers NHIS and Reliance HMO', () => {
    const { el } = setup();
    const opts = [...el('apt-insurance').options].map(o => o.value);
    expect(opts).toContain('NHIS');
    expect(opts).toContain('Reliance HMO');
    expect(opts).toContain('Self-pay');
  });

  it('centre options come from real tenant centres, not hardcoded strings', () => {
    const { el, win } = setup();
    const tenantCentres = win.tenantCentres(win.S().activeTenantId).map(c => c.name);
    const centreOpts = [...el('apt-centre').options].map(o => o.value);
    expect(tenantCentres.length).toBeGreaterThan(0);
    expect(centreOpts.some(c => tenantCentres.includes(c))).toBe(true);
    // Must NOT contain the old hardcoded "Victoria Island" unless it's a real centre.
    const hardcoded = ['Victoria Island','Lekki','Ikeja'].filter(c => !tenantCentres.includes(c));
    hardcoded.forEach(c => expect(centreOpts).not.toContain(c));
  });
});

describe('Appointment modal — recurrence', () => {
  it('recurrence section is hidden by default', () => {
    const { el } = setup();
    const sec = el('apt-recurrence-section');
    expect(sec).toBeTruthy();
    expect(sec.style.display).toBe('none');
  });

  it('recurrence section appears when Dialysis session is selected', () => {
    const { win, el } = setup();
    el('apt-type').value = 'Dialysis session';
    win.aptTypeChange();
    expect(el('apt-recurrence-section').style.display).not.toBe('none');
  });

  it('recurrence section hides again when a non-dialysis type is selected', () => {
    const { win, el } = setup();
    el('apt-type').value = 'Dialysis session';
    win.aptTypeChange();
    el('apt-type').value = 'Routine phlebotomy';
    win.aptTypeChange();
    expect(el('apt-recurrence-section').style.display).toBe('none');
  });

  it('recurrence dropdown offers weekly and twice-weekly options', () => {
    const { el } = setup();
    const opts = [...el('apt-recur-freq').options].map(o => o.value).filter(Boolean);
    expect(opts).toContain('weekly');
    expect(opts).toContain('twice_weekly');
    expect(opts).toContain('three_weekly');
  });
});

describe('Appointment modal — duration auto-set', () => {
  it('sets 15 min for phlebotomy', () => {
    const { win, el } = setup();
    el('apt-type').value = 'Routine phlebotomy';
    win.aptTypeChange();
    expect(el('apt-duration').value).toBe('15 min');
  });

  it('sets 4 hrs for dialysis', () => {
    const { win, el } = setup();
    el('apt-type').value = 'Dialysis session';
    win.aptTypeChange();
    expect(el('apt-duration').value).toBe('4 hrs');
  });

  it('sets 2 hrs for executive health check', () => {
    const { win, el } = setup();
    el('apt-type').value = 'Annual / executive health check';
    win.aptTypeChange();
    expect(el('apt-duration').value).toBe('2 hrs');
  });
});

describe('Appointment modal — booking', () => {
  it('saves all new fields on submit and defaults to scheduled', () => {
    const { win, el, booted } = setup();
    { const _p = booted.APP_STATE.patients[0]; win.pcSelect('apt-patient', _p.id, _p.name + ' — ' + _p.id); }
    el('apt-type').value = 'Ultrasound';
    el('apt-priority').value = 'Urgent';
    el('apt-duration').value = '30 min';
    el('apt-provider').value = 'Dr. Folake Aigbogun';
    el('apt-referring').value = 'Dr. Smith · LUTH';
    el('apt-date').value = '2026-06-01';
    el('apt-time').value = '10:00';
    el('apt-insurance').value = 'AXA Mansard';
    el('apt-remind').value = 'WhatsApp';
    el('apt-notes').value = 'Pelvic USS — review fibroid size.';
    const before = booted.APP_STATE.appointments.length;
    win.submitAppointment('scheduled');
    expect(booted.APP_STATE.appointments.length).toBe(before + 1);
    const a = booted.APP_STATE.appointments[0];
    expect(a.type).toBe('Ultrasound');
    expect(a.priority).toBe('Urgent');
    expect(a.provider).toBe('Dr. Folake Aigbogun');
    expect(a.referringDoctor).toBe('Dr. Smith · LUTH');
    expect(a.insurance).toBe('AXA Mansard');
    expect(a.remindVia).toBe('WhatsApp');
    expect(a.notes).toBe('Pelvic USS — review fibroid size.');
    expect(a.status).toBe('scheduled');
  });

  it('confirms appointment when "Confirm" is clicked', () => {
    const { win, el, booted } = setup();
    { const _p = booted.APP_STATE.patients[0]; win.pcSelect('apt-patient', _p.id, _p.name + ' — ' + _p.id); }
    el('apt-date').value = '2026-06-01';
    win.submitAppointment('confirmed');
    const a = booted.APP_STATE.appointments[0];
    expect(a.status).toBe('confirmed');
  });
});
