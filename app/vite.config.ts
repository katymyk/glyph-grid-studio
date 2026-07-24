import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base is set for GitHub Pages project path; harmless in dev.
export default defineConfig({
  base: '/glyph-grid-studio/',
  plugins: [react()],
});
