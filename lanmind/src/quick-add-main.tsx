import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import QuickAddWindow from './QuickAddWindow';
import './index.css';

// This is a separate Vite/Tauri entry so the system shortcut can show only the
// compact quick-add window while the main workspace remains hidden in the tray.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QuickAddWindow />
  </StrictMode>,
);
