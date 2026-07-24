import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works served from a domain root (Vercel/Netlify)
// or a GitHub Pages subpath alike.
export default defineConfig({
  base: './',
  plugins: [react()],
});
