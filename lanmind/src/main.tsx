import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { createAppStartup } from './utils/appStartup';
import './index.css';

const startup = createAppStartup();
const finishStartup = () => { void startup.finish(); };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App onStartupReady={finishStartup} />
  </StrictMode>,
);

void startup.start();
