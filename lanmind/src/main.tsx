import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {invoke, isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import App from './App.tsx';
import './index.css';

const splashStartedAt = performance.now();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const revealWindow = isTauri()
      ? invoke('main_window_ready').catch((error) => {
          console.error('Failed to finish main window setup through the app command', error);
          return getCurrentWindow().show().catch((showError) => {
            console.error('Failed to reveal the main window through the window API', showError);
          });
        })
      : Promise.resolve();

    void revealWindow.finally(() => {
      // React is now painted and the desktop window is visible, so the user sees
      // the HTML splash instead of the native WebView background during startup.
      const splash = document.getElementById('app-splash');
      if (!splash) return;

      const remaining = Math.max(0, 650 - (performance.now() - splashStartedAt));
      window.setTimeout(() => {
        splash.classList.add('app-splash--hidden');
        window.setTimeout(() => splash.remove(), 320);
      }, remaining);
    });
  });
});
