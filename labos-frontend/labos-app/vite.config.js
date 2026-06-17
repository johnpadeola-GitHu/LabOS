import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    root: 'src',
    publicDir: '../public',

    plugins: [
      // Inject Supabase credentials into index.html at build time.
      // Replaces __SUPABASE_URL__ and __SUPABASE_ANON_KEY__ with the actual
      // values from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env vars.
      // When the vars are not set (demo mode) the placeholders become empty
      // strings so the adapter stays inert.
      {
        name: 'inject-supabase-config',
        transformIndexHtml(html) {
          const url  = env.VITE_SUPABASE_URL      || '';
          const key  = env.VITE_SUPABASE_ANON_KEY || '';
          return html
            .replace(/__SUPABASE_URL__/g,      JSON.stringify(url))
            .replace(/__SUPABASE_ANON_KEY__/g, JSON.stringify(key));
        }
      }
    ],

    build: {
      outDir: '../dist',
      emptyOutDir: true,
      target: 'es2018',
      minify: 'terser',
      sourcemap: true,
      rollupOptions: {
        output: {
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
  };
});
