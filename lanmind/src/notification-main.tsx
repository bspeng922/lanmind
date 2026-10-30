import { initializeLocale } from './i18n';
import { initializeFeatures } from './modules/state';
import { createRoot } from 'react-dom/client';
import { NotificationWindow } from './NotificationWindow';
import { ThemeProvider } from './context/ThemeContext';
import { ensureWorkspaceContext } from './services/api';
import './index.css';

async function initializeNotificationWindow() {
  try {
    await Promise.all([
      initializeLocale(),
      initializeFeatures(),
      ensureWorkspaceContext().catch(() => null),
    ]);
  } catch (error) {
    // Hidden WebViews can start before Rust has finished constructing AppState.
    // Retry instead of leaving the notification window permanently blank.
    console.warn('Notification window initialization will retry', error);
    window.setTimeout(() => void initializeNotificationWindow(), 1000);
    return;
  }

  createRoot(document.getElementById('root')!).render(
    <ThemeProvider>
      <NotificationWindow />
    </ThemeProvider>
  );
}

void initializeNotificationWindow();
