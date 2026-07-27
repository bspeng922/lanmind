import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DesktopCalendarWindow from './DesktopCalendarWindow';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopCalendarWindow />
  </StrictMode>,
);
