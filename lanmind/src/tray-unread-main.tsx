import { initializeLocale } from './i18n';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './context/ThemeContext';
import { AppLockGate } from './components/AppLockGate';
import { TrayUnreadWindow } from './TrayUnreadWindow';
import './index.css';

void initializeLocale().then(() => {
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <AppLockGate primary={false}><TrayUnreadWindow /></AppLockGate>
  </ThemeProvider>,
);

});
