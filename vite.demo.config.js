// Click-through demo build with sample data (no Supabase needed): npm run build:demo
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const mock = path.resolve('demo/supabase-mock.js');
export default defineConfig({
  plugins: [react(), {
    name: 'pof-demo-mock', enforce: 'pre',
    resolveId(id, importer) { if (id === './supabase' && importer?.includes('/src/')) return mock; },
  }],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  build: { outDir: 'dist-demo', assetsInlineLimit: 100000000, cssCodeSplit: false },
});
