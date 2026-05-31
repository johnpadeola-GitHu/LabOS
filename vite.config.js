import { defineConfig } from 'vite';

// LabOS uses an ordered-script architecture during this migration phase:
// the application code is split into cohesive layers (data → services →
// views → bootstrap) that share a controlled global scope, exactly as the
// original single-file prototype did. This preserves the fully-tested runtime
// behaviour while giving us a real project structure, dev server, and an
// optimised production build. Future work can incrementally convert layers
// to true ES modules.
export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2018',
    minify: 'terser',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Stable, cache-friendly asset names
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    }
  },
  server: {
    port: 5173,
    open: false,
    host: true
  },
  preview: {
    port: 4173,
    host: true
  }
});
