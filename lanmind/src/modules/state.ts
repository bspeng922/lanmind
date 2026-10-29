import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { defaultFeatureState, normalizeFeatureState, type FeatureId, type FeatureState } from './registry';

const STORAGE_KEY = 'lanmind-feature-modules-v1';
let state: FeatureState = { ...defaultFeatureState };
const subscribers = new Set<() => void>();
function publish(value: unknown) {
  state = normalizeFeatureState(value);
  subscribers.forEach(callback => callback());
}
let initialization: Promise<void> | undefined;
export function initializeFeatures(): Promise<void> {
  return initialization ??= (async () => {
    if (isTauri()) {
      // Subscribe before reading so a change in another window cannot be missed.
      let changed = false;
      const unlisten = await listen<FeatureState>('features://changed', event => { changed = true; publish(event.payload); });
      try {
        const snapshot = await invoke<FeatureState>('get_feature_modules');
        if (!changed) publish(snapshot);
      } catch (error) { unlisten(); throw error; }
    } else {
      try { publish(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch { publish({}); }
      window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY) {
          try { publish(JSON.parse(event.newValue || '{}')); } catch { /* Keep last valid state. */ }
        }
      });
    }
  })().catch(error => { initialization = undefined; throw error; });
}
export function useFeatures(): FeatureState {
  return useSyncExternalStore(callback => { subscribers.add(callback); return () => { subscribers.delete(callback); }; }, () => state);
}
export function featureEnabled(id: FeatureId): boolean { return state[id]; }
export async function setFeatureEnabled(id: FeatureId, enabled: boolean): Promise<void> {
  if (isTauri()) {
    publish(await invoke<FeatureState>('set_feature_module_enabled', { id, enabled }));
  } else {
    const next = { ...state, [id]: enabled };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    publish(next);
  }
}
