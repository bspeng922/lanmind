import { createRoot } from 'react-dom/client';
import { NotificationWindow } from './NotificationWindow';
import { ThemeProvider } from './context/ThemeContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <NotificationWindow />
  </ThemeProvider>
);
