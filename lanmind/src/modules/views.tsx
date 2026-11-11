import React, { lazy, Suspense, type ComponentType } from 'react';
import { useFeatures } from './state';
import type { FeatureId } from './registry';

/** A single loading/activation boundary for built-in business views. */
function moduleView<P extends object>(id: FeatureId, load: () => Promise<{ default: ComponentType<P> }>) {
  const View = lazy(load);
  return function ModuleView(props: P) {
    const enabled = useFeatures();
    return enabled[id] ? <Suspense fallback={<div className="flex-1 animate-pulse bg-canvas" aria-busy="true" />}><View {...props} /></Suspense> : null;
  };
}
export const WikiView = moduleView('wiki', async () => ({ default: (await import('../components/wiki/WikiView')).WikiView }));
export const AIWorkspace = moduleView('ai', async () => ({ default: (await import('../components/ai/AIWorkspace')).AIWorkspace }));
export const LanChatModal = moduleView('chat', async () => ({ default: (await import('../components/LanChatModal')).LanChatModal }));
export const LLMReportStudio = moduleView('ai', async () => ({ default: (await import('../components/LLMReportStudio')).LLMReportStudio }));
export const LLMConfigModal = moduleView('ai', async () => ({ default: (await import('../components/LLMConfigModal')).LLMConfigModal }));
export const OpticalTransferPlugin = moduleView('optical', () => import('../../plugins/optical-transfer/entry'));
export const PasswordVaultPlugin = moduleView('vault', () => import('../../plugins/password-vault/entry'));
