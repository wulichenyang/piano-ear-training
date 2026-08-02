import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react()],
  esbuild: {
    drop: command === 'build' ? ['console', 'debugger'] : [],
  },
  build: {
    target: 'es2020',
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
}));
