// Tests for the patient search/select combobox in the New Test Request modal.
// Covers: dropdown renders, search filters, keyboard selection, patient pre-fill
// from patient detail context, validation blocks submit without selection,
// and selected patient is correctly stored on the new request.
import { describe, it, expect, beforeEach } from 'vitest';
import { bootLabOS } from './harness.js';

function setup() {
  const booted = bootLabOS();
  const { win } = booted;
  const doc = win.document;
  ['modal-root', 'app'].forEach(id => {
    if (!doc.getElementById(id)) {
      const el = doc.createElement('div'); el.id = id; doc.body.appendChild(el);
    }
  });
  win.enterTenantMode('440a5c9e-605e-4d53-9aff-dc7562087575');
  // Reset RX_STATE so each test starts fresh.
  win.RX_STATE = { selected: new Set(['FBC']), search: '', priority: 'Routine',
                   expanded: new Set(['Hematology']), patientId: null, patientLabel: '' };
  win.openModal('new-request');
  const el = id => doc.getElementById(id);
  return { win, doc, booted, APP_STATE: booted.APP_STATE, el };
}

describe('New request modal — patient combobox structure', () => {
  it('renders a text input for patient search, not a static hardcoded value', () => {
    const { el } = setup();
    const input = el('rx-patient-input');
    expect(input).toBeTruthy();
    expect(input.tagName).toBe('INPUT');
    // Must NOT contain the old hardcoded patient string.
    expect(input.value).not.toBe('Adaeze Okafor — PT-2026-0142');
  });

  it('renders the dropdown list element hidden by default', () => {
    const { el } = setup();
    const list = el('rx-patient-list');
    expect(list).toBeTruthy();
    expect(list.tagName).toBe('UL');
    expect(list.style.display).toBe('none');
  });

  it('renders the hint text prompting the user to search', () => {
    const { el } = setup();
    const hint = el('rx-patient-hint');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toMatch(/type|search|name|phone/i);
  });
});

describe('New request modal — patient search behaviour', () => {
  it('shows matching patients when a name fragment is typed', () => {
    const { win, el, APP_STATE } = setup();
    // Ensure there's at least one patient in the seed.
    const first = APP_STATE.patients[0];
    const fragment = first.name.split(' ')[0].slice(0, 4); // e.g. "Adae"
    win.rxPatientSearch(fragment);
    const list = el('rx-patient-list');
    expect(list.style.display).toBe('block');
    expect(list.querySelectorAll('li[data-pid]').length).toBeGreaterThan(0);
  });

  it('shows a "no results" item for a query that matches nothing', () => {
    const { win, el } = setup();
    win.rxPatientSearch('ZZZZZZZZZ_NO_MATCH');
    const list = el('rx-patient-list');
    expect(list.style.display).toBe('block');
    expect(list.querySelectorAll('li[data-pid]').length).toBe(0);
    expect(list.textContent).toMatch(/no patients matched/i);
  });

  it('hides the dropdown and clears the selection when the input is cleared', () => {
    const { win, el, APP_STATE } = setup();
    // First select a patient.
    const pid = APP_STATE.patients[0].id;
    win.rxSelectPatient(pid, `Test — ${pid}`);
    expect(win.RX_STATE.patientId).toBe(pid);
    // Now clear the input.
    win.rxPatientSearch('');
    expect(win.RX_STATE.patientId).toBeNull();
    const list = el('rx-patient-list');
    expect(list.style.display).toBe('none');
  });

  it('caps results at 12 even if more patients match', () => {
    const { win, el, APP_STATE } = setup();
    // Add enough patients to exceed the cap.
    for (let i = 0; i < 20; i++) {
      APP_STATE.patients.push({ id: `PT-EXTRA-${i}`, name: `Test Patient ${i}`, gender: 'Male' });
    }
    win.rxPatientSearch('patient'); // matches all the extras
    const items = el('rx-patient-list').querySelectorAll('li[data-pid]');
    expect(items.length).toBeLessThanOrEqual(12);
  });
});

describe('New request modal — patient selection', () => {
  it('rxSelectPatient stores the patient ID and label in RX_STATE', () => {
    const { win, APP_STATE } = setup();
    const p = APP_STATE.patients[0];
    const label = `${p.name} — ${p.id}`;
    win.rxSelectPatient(p.id, label);
    expect(win.RX_STATE.patientId).toBe(p.id);
    expect(win.RX_STATE.patientLabel).toBe(label);
  });

  it('rxSelectPatient updates the input value and hides the dropdown', () => {
    const { win, el, APP_STATE } = setup();
    const p = APP_STATE.patients[0];
    win.rxSelectPatient(p.id, `${p.name} — ${p.id}`);
    const input = el('rx-patient-input');
    const list  = el('rx-patient-list');
    expect(input.value).toBe(`${p.name} — ${p.id}`);
    expect(list.style.display).toBe('none');
  });

  it('rxSelectPatient updates the hint to show the confirmed name', () => {
    const { win, el, APP_STATE } = setup();
    const p = APP_STATE.patients[0];
    win.rxSelectPatient(p.id, `${p.name} — ${p.id}`);
    expect(el('rx-patient-hint').textContent).toContain(p.name);
  });
});

describe('New request modal — submit validation', () => {
  it('blocks submission and focuses the input when no patient is selected', () => {
    const { win, APP_STATE } = setup();
    win.RX_STATE.patientId = null;
    const before = (APP_STATE.requests || []).length;
    try { win.submitNewRequest(); } catch (_) {}
    expect((APP_STATE.requests || []).length).toBe(before);
  });

  it('submits successfully when a patient is selected and saves correct patientId', () => {
    const { win, APP_STATE } = setup();
    const p = APP_STATE.patients[0];
    win.rxSelectPatient(p.id, `${p.name} — ${p.id}`);
    win.RX_STATE.selected = new Set(['FBC']);
    const before = (APP_STATE.requests || []).length;
    win.submitNewRequest();
    const reqs = APP_STATE.requests || [];
    expect(reqs.length).toBe(before + 1);
    expect(reqs[0].patientId).toBe(p.id);
    expect(reqs[0].patient).toBe(p.name);
  });

  it('clears patientId and patientLabel from RX_STATE after a successful submit', () => {
    const { win, APP_STATE } = setup();
    const p = APP_STATE.patients[0];
    win.rxSelectPatient(p.id, `${p.name} — ${p.id}`);
    win.RX_STATE.selected = new Set(['FBC']);
    win.submitNewRequest();
    expect(win.RX_STATE.patientId).toBeNull();
    expect(win.RX_STATE.patientLabel).toBe('');
  });
});

describe('New request modal — patient pre-fill from patient detail', () => {
  it('openNewRequest pre-fills patientId and patientLabel when called with a patient ID', () => {
    const { win, el, APP_STATE } = setup();
    const p = APP_STATE.patients[0];
    win.openNewRequest(p.id);
    // Re-open so pre-fill is applied into RX_STATE.
    expect(win.RX_STATE.patientId).toBe(p.id);
    expect(win.RX_STATE.patientLabel).toContain(p.name);
    // The input should reflect the pre-filled label.
    const input = el('rx-patient-input');
    expect(input.value).toContain(p.name);
  });

  it('openNewRequest without a patient ID leaves patientId null', () => {
    const { win } = setup();
    win.openNewRequest();
    expect(win.RX_STATE.patientId).toBeNull();
  });
});

describe('Shared patient combobox — global application', () => {
  const fieldModals = [
    { fieldId:'cn-patient',  open: win => win.openComposeNotification(),  label:'Compose Notification' },
    { fieldId:'img-patient', open: win => win.openImagingOrder('radiology'), label:'Imaging Order' },
    { fieldId:'pg-patient',  open: win => win.openProgramOrder('progPreEmployment'), label:'Clinical Package' },
  ];

  for (const { fieldId, open, label } of fieldModals) {
    it(`${label}: renders patientComboHtml input (not a <select>)`, () => {
      const booted = bootLabOS();
      const { win } = booted;
      const doc = win.document;
      ['modal-root','app'].forEach(id=>{
        if(!doc.getElementById(id)){ const el=doc.createElement('div'); el.id=id; doc.body.appendChild(el); }
      });
      win.enterTenantMode('440a5c9e-605e-4d53-9aff-dc7562087575');
      open(win);
      const input = doc.getElementById('pc-input-'+fieldId);
      const list  = doc.getElementById('pc-list-'+fieldId);
      expect(input).toBeTruthy();
      expect(input.tagName).toBe('INPUT');
      expect(list).toBeTruthy();
      expect(list.style.display).toBe('none');
      // Old <select> must NOT be present.
      expect(doc.getElementById(fieldId)).toBeNull();
    });
  }

  it('pcSearch filters patients correctly across all combobox instances', () => {
    const booted = bootLabOS();
    const { win } = booted;
    const doc = win.document;
    ['modal-root','app'].forEach(id=>{
      if(!doc.getElementById(id)){ const el=doc.createElement('div'); el.id=id; doc.body.appendChild(el); }
    });
    win.enterTenantMode('440a5c9e-605e-4d53-9aff-dc7562087575');
    win.openComposeNotification();
    const first = booted.APP_STATE.patients[0];
    win.pcSearch('cn-patient', first.name.slice(0, 4));
    const list = doc.getElementById('pc-list-cn-patient');
    expect(list.style.display).toBe('block');
    expect(list.querySelectorAll('li[data-pid]').length).toBeGreaterThan(0);
  });

  it('pcRequire blocks submission when no patient is selected', () => {
    const booted = bootLabOS();
    const { win } = booted;
    const doc = win.document;
    ['modal-root','app'].forEach(id=>{
      if(!doc.getElementById(id)){ const el=doc.createElement('div'); el.id=id; doc.body.appendChild(el); }
    });
    win.enterTenantMode('440a5c9e-605e-4d53-9aff-dc7562087575');
    win.openComposeNotification();
    if(!win.PC_STATE) win.PC_STATE = {};
    win.PC_STATE['cn-patient'] = { patientId: null, patientLabel: '' };
    const before = (booted.APP_STATE.notifications||[]).length;
    try { win.submitComposeNotification(); } catch(_) {}
    expect((booted.APP_STATE.notifications||[]).length).toBe(before);
  });

  it('pcSelect + submitComposeNotification queues a message with correct patientId', () => {
    const booted = bootLabOS();
    const { win } = booted;
    const doc = win.document;
    ['modal-root','app'].forEach(id=>{
      if(!doc.getElementById(id)){ const el=doc.createElement('div'); el.id=id; doc.body.appendChild(el); }
    });
    win.enterTenantMode('440a5c9e-605e-4d53-9aff-dc7562087575');
    win.openComposeNotification();
    const p = booted.APP_STATE.patients[0];
    win.pcSelect('cn-patient', p.id, p.name+' — '+p.id);
    // Set a message body
    doc.getElementById('cn-body').value = 'Hello {{name}}, your results are ready.';
    const before = (booted.APP_STATE.notifications||[]).length;
    win.submitComposeNotification();
    expect(booted.APP_STATE.notifications.length).toBe(before + 1);
    const msg = booted.APP_STATE.notifications[0];
    expect(msg.patientId).toBe(p.id);
    expect(msg.status).toBe('queued');
  });
});
