import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/receiver/',
  publicDir: path.resolve(__dirname, 'public/receiver'),
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  build: {
    outDir: path.resolve(__dirname, 'dist-receiver'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: { input: path.resolve(__dirname, 'receiver/index.html') },
  },
});
