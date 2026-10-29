import { initializeLocale } from './i18n';
import { initializeFeatures } from './modules/state';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { createAppStartup } from './utils/appStartup';
import './index.css';

const startup = createAppStartup();
const finishStartup = () => { void startup.finish(); };

void Promise.all([initializeLocale(), initializeFeatures().catch(error => console.error('Feature initialization failed', error))]).then(() => {
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App onStartupReady={finishStartup} />
  </StrictMode>,
);

void startup.start();

});
