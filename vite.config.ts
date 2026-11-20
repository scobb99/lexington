import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    // Keep every SVG as its own .svg file. Pixi's Assets loader picks its SVG parser from
    // the .svg file extension (Build Spec v1.1, Section 3: SVG to texture).
    assetsInlineLimit: 0,
    // Pixi 7 is one large library; this only silences the size warning.
    chunkSizeWarningLimit: 1200,
  },
});
