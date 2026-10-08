import { createRoot } from 'react-dom/client';
import { NotificationWindow } from './NotificationWindow';
import { ThemeProvider } from './context/ThemeContext';
import { AppLockGate } from './components/AppLockGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <AppLockGate primary={false}><NotificationWindow /></AppLockGate>
  </ThemeProvider>
);
