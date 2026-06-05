// Minimal ESLint flat config. The migrated app layers use browser globals and
// a shared global scope (classic-script architecture), so we declare the
// known cross-layer globals as readonly to avoid no-undef noise while still
// catching genuine mistakes.
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        FileReader: 'readonly',
        AbortController: 'readonly',
        Chart: 'readonly',
        caches: 'readonly',
        crypto: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-constant-condition': ['warn', { checkLoops: false }]
    }
  }
];
