import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // three/webgpu is one big module; that's fine for a demo
    chunkSizeWarningLimit: 1500,
  },
});
