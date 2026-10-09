import { initializeLocale } from './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DesktopCalendarWindow from './DesktopCalendarWindow';
import './index.css';

void initializeLocale().then(() => {
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopCalendarWindow />
  </StrictMode>,
);

});
