import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './context/ThemeContext';
import { TrayUnreadWindow } from './TrayUnreadWindow';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <TrayUnreadWindow />
  </ThemeProvider>,
);
