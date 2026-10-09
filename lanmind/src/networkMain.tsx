import { initializeLocale } from './i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './context/ThemeContext';
import { NetworkApp } from './NetworkApp';
import './index.css';

void initializeLocale().then(() => {
createRoot(document.getElementById('root')!).render(<ThemeProvider><NetworkApp /></ThemeProvider>);

});
