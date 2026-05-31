// Shared harness for LabOS tests. Boots the built bundle inside jsdom and
// returns the window plus the const-declared singletons (APP_STATE, ROUTES,
// OfflineCore, LicenseCore, DataMode) which are global lexical bindings rather
// than window properties.
//
// Usage:
//   import { bootLabOS } from './harness.js';
//   const { win, APP_STATE, OfflineCore } = await bootLabOS();
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

export function bootLabOS({ collectErrors = false } = {}) {
  const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
  const bundle = readFileSync(resolve(root, 'dist/labos.bundle.js'), 'utf8');

  const errors = [];
  const vc = new VirtualConsole();
  if (collectErrors) vc.on('error', (e) => errors.push(String(e)));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc
  });
  const win = dom.window;

  // Browser API stubs jsdom lacks
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
  win.navigator.serviceWorker = win.navigator.serviceWorker || {
    register: () => Promise.resolve({ scope: '/' }),
    addEventListener() {}
  };

  // Run the bundle as a real script (true global lexical scope)
  const s = win.document.createElement('script');
  s.textContent = bundle;
  win.document.body.appendChild(s);

  // Probe to surface const singletons for the test process
  const probe = win.document.createElement('script');
  probe.textContent = `
    window.__labos = {
      get APP_STATE(){ try { return APP_STATE; } catch(e){ return undefined; } },
      get ROUTES(){ try { return ROUTES; } catch(e){ return undefined; } },
      get OfflineCore(){ try { return OfflineCore; } catch(e){ return undefined; } },
      get LicenseCore(){ try { return LicenseCore; } catch(e){ return undefined; } },
      get DataMode(){ try { return DataMode; } catch(e){ return undefined; } },
      get HELP_ARTICLES(){ try { return HELP_ARTICLES; } catch(e){ return undefined; } },
      get SECTION_ICONS(){ try { return SECTION_ICONS; } catch(e){ return undefined; } },
      get NAV_GROUPS(){ try { return NAV_GROUPS; } catch(e){ return undefined; } },
      get PATIENTS_FILTER_STATE(){ try { return PATIENTS_FILTER_STATE; } catch(e){ return undefined; } },
      get ONB_STATE(){ try { return ONB_STATE; } catch(e){ return undefined; } }
    };
  `;
  win.document.body.appendChild(probe);

  const L = win.__labos;
  return {
    dom,
    win,
    errors,
    APP_STATE: L.APP_STATE,
    ROUTES: L.ROUTES,
    OfflineCore: L.OfflineCore,
    LicenseCore: L.LicenseCore,
    DataMode: L.DataMode,
    ONB_STATE: L.ONB_STATE,
    labos: L
  };
}
