import { initializeLocale } from './i18n';
import { initializeFeatures } from './modules/state';
import { createRoot } from 'react-dom/client';
import { NotificationWindow } from './NotificationWindow';
import { ThemeProvider } from './context/ThemeContext';
import { AppLockGate } from './components/AppLockGate';
import './index.css';

void Promise.all([initializeLocale(), initializeFeatures()]).then(() => {
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <AppLockGate primary={false}><NotificationWindow /></AppLockGate>
  </ThemeProvider>
);

});
