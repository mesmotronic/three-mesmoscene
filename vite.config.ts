import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset URLs so the build works from any subpath, e.g. GitHub Pages
  base: './',
  build: {
    target: 'es2022',
    // three/webgpu is one big module; that's fine for a demo
    chunkSizeWarningLimit: 1500,
  },
});
