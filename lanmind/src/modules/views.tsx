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
export const WikiView = moduleView('wiki', () => import('../components/wiki/WikiView').then(module => ({ default: module.WikiView })));
export const AIWorkspace = moduleView('ai', () => import('../components/ai/AIWorkspace').then(module => ({ default: module.AIWorkspace })));
export const LanChatModal = moduleView('chat', () => import('../components/LanChatModal').then(module => ({ default: module.LanChatModal })));
export const LLMReportStudio = moduleView('ai', () => import('../components/LLMReportStudio').then(module => ({ default: module.LLMReportStudio })));
export const LLMConfigModal = moduleView('ai', () => import('../components/LLMConfigModal').then(module => ({ default: module.LLMConfigModal })));
export const OpticalTransferPlugin = moduleView('optical', () => import('../../plugins/optical-transfer/entry'));
export const PasswordVaultPlugin = moduleView('vault', () => import('../../plugins/password-vault/entry'));
