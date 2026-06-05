// Smoke test: load the built dist/ in jsdom, run the bundle, and assert the
// app boots and core globals are wired. This catches load-order, scope, and
// runtime errors that a syntax check can't.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let dom, win;
const consoleErrors = [];

beforeAll(async () => {
  const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
  const bundle = readFileSync(resolve(root, 'dist/labos.bundle.js'), 'utf8');

  const vc = new VirtualConsole();
  vc.on('error', (e) => consoleErrors.push(String(e)));

  dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc
  });
  win = dom.window;

  // Stub the browser APIs the bundle touches that jsdom lacks
  win.scrollTo = () => {};
  win.matchMedia = win.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  win.Chart = function () { this.destroy = () => {}; };
  win.print = () => {};
  if (!win.localStorage) {
    const store = new Map();
    win.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear()
    };
  }
  // Service worker / caches are optional; stub so registration no-ops cleanly
  win.navigator.serviceWorker = win.navigator.serviceWorker || {
    register: () => Promise.resolve({ scope: '/' }),
    addEventListener() {}
  };

  // Execute the bundle as a real <script> element so top-level const/let
  // bindings live in the shared global lexical scope (matching how the browser
  // loads <script src>). win.eval() would give it a private scope instead.
  const scriptEl = win.document.createElement('script');
  scriptEl.textContent = bundle;
  win.document.body.appendChild(scriptEl);

  // A probe script runs in the same global lexical scope and copies the
  // const-declared singletons onto window so the test can read them. (In the
  // app itself these are reached as bare globals across script tags; const
  // bindings are global but not properties of window.)
  const probe = win.document.createElement('script');
  probe.textContent = `
    try { window.__APP_STATE = APP_STATE; } catch (e) {}
    try { window.__ROUTES = ROUTES; } catch (e) {}
    try { window.__OfflineCore = OfflineCore; } catch (e) {}
    try { window.__LicenseCore = LicenseCore; } catch (e) {}
    try { window.__DataMode = DataMode; } catch (e) {}
    try { window.__LabOSApi = LabOSApi; } catch (e) {}
  `;
  win.document.body.appendChild(probe);
});

describe('LabOS built bundle — boot smoke test', () => {
  it('runs without throwing console errors during boot', () => {
    expect(consoleErrors).toEqual([]);
  });

  it('defines core global functions', () => {
    expect(typeof win.navigate).toBe('function');
    expect(typeof win.openModal).toBe('function');
    expect(typeof win.bootApp).toBe('function');
    expect(typeof win.renderShell).toBe('function');
  });

  it('defines the core service singletons', () => {
    expect(typeof win.__OfflineCore).toBe('object');
    expect(typeof win.__LicenseCore).toBe('object');
    expect(typeof win.__DataMode).toBe('object');
    expect(typeof win.__LabOSApi).toBe('object');
  });

  it('wires the service-UI layer (split from services.js)', () => {
    // These renderers live in service-ui.js; if that layer is dropped from the
    // build manifest, the badges/overlay break and these go undefined.
    expect(typeof win.renderConnectionBadge).toBe('function');
    expect(typeof win.renderLicenceBadge).toBe('function');
    expect(typeof win.renderLicenceOverlay).toBe('function');
    expect(typeof win.renderDevices).toBe('function');
  });

  it('seeds APP_STATE with tenants and catalogues', () => {
    expect(win.__APP_STATE).toBeTruthy();
    expect(Array.isArray(win.__APP_STATE.tenants)).toBe(true);
    expect(win.__APP_STATE.tenants.length).toBeGreaterThanOrEqual(5);
    const labCount = Object.values(win.__APP_STATE.testCatalog).reduce((s, a) => s + a.length, 0);
    expect(labCount).toBeGreaterThan(200);
  });

  it('has a populated ROUTES table', () => {
    expect(win.__ROUTES).toBeTruthy();
    expect(Object.keys(win.__ROUTES).length).toBeGreaterThanOrEqual(20);
  });

  it('renders the app shell into the DOM', () => {
    // A fresh boot lands on onboarding; the workspace shell (and its sidebar
    // nav) renders once a tenant is entered. Drive that, then assert the nav.
    const probe = win.document.createElement('script');
    probe.textContent = `try { enterTenantMode('tnt_pathcare'); renderShell(); } catch (e) { window.__shellErr = e.message; }`;
    win.document.body.appendChild(probe);
    const nav = win.document.getElementById('sidebar-nav');
    expect(nav).toBeTruthy();
    expect(nav.innerHTML.length).toBeGreaterThan(100);
    // Collapsible domain groups should be present.
    expect(win.document.querySelectorAll('.nav-group[data-group]').length).toBe(7);
  });
});
