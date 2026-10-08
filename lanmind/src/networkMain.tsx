import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './context/ThemeContext';
import { NetworkApp } from './NetworkApp';
import './index.css';

createRoot(document.getElementById('root')!).render(<ThemeProvider><NetworkApp /></ThemeProvider>);
