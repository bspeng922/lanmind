import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
      target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild' as const,
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          quickAdd: path.resolve(__dirname, 'quick-add.html'),
          notification: path.resolve(__dirname, 'notification.html'),
          trayUnread: path.resolve(__dirname, 'tray-unread.html'),
          desktopCalendar: path.resolve(__dirname, 'desktop-calendar.html'),
          opticalTransfer: path.resolve(__dirname, 'optical-transfer.html'),
          receiver: path.resolve(__dirname, 'receiver/index.html'),
        },
      },
    },
  };
});
