import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { wikiEditorAssets } from './scripts/wiki-editor-assets';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), wikiEditorAssets()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      // Tests may disable automatic reloads while retaining transform invalidation.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Keep transforms current when tests disable automatic page reloads.
      watch: {
        ignored: ['**/src-tauri/target/**', '**/dist/**', '**/dist-receiver/**', '**/test-results/**', '**/playwright-report/**', '**/.tmp/**'],
      },
    },
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
      manifest: true,
      target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild' as const,
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          network: path.resolve(__dirname, 'network.html'),
          quickAdd: path.resolve(__dirname, 'quick-add.html'),
          notification: path.resolve(__dirname, 'notification.html'),
          trayUnread: path.resolve(__dirname, 'tray-unread.html'),
          desktopCalendar: path.resolve(__dirname, 'desktop-calendar.html'),
          opticalTransfer: path.resolve(__dirname, 'optical-transfer.html'),
          screenshot: path.resolve(__dirname, 'screenshot.html'),
          receiver: path.resolve(__dirname, 'receiver/index.html'),
        },
      },
    },
  };
});
