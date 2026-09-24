import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (/sylaxgen/) and
// when served by the CLI from any port.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
});
