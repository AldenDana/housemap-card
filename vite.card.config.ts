import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Separate build target from vite.config.ts (which still builds the
// standalone iframe'd app exactly as before - untouched). This one builds
// the Lovelace custom card as a single self-contained JS file: HACS has no
// build step of its own, it just copies whatever file the repo/release
// points it at into www/community/, so everything (React, ReactDOM,
// framer-motion, @mdi/js, this app's own CSS) needs to be bundled into that
// one file rather than left as separate node_modules-resolved imports.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-card',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/housemap-card.tsx'),
      name: 'HousemapCard',
      formats: ['iife'],
      fileName: () => 'housemap-card.js',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
