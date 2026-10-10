import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { initializeLocale } from './i18n';
import { ScreenshotSelection, ScreenshotRegion } from './components/ScreenshotSelection';
import './index.css';

const cancel = () => { void invoke('cancel_screenshot'); };
const copy = (region: ScreenshotRegion, imageData?: string) =>
  invoke<boolean>('finish_screenshot', { region, action: 'copy', imageData });
const save = (region: ScreenshotRegion, imageData?: string) =>
  invoke<boolean>('finish_screenshot', { region, action: 'save', imageData });
const ready = () => { void invoke('screenshot_ready').catch(cancel); };

function ScreenshotWindow() {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { void invoke<string>('get_screenshot_frame').then(setSrc).catch(cancel); }, []);
  return src ? <ScreenshotSelection src={src} onReady={ready} onCopy={copy} onSave={save} onCancel={cancel} /> : null;
}

void initializeLocale().then(() => {
  createRoot(document.getElementById('root')!).render(<ScreenshotWindow />);
}).catch(cancel);
