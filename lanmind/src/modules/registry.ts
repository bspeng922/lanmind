import catalog from './catalog.json';
import optical from '../../plugins/optical-transfer/manifest.json';
import vault from '../../plugins/password-vault/manifest.json';

export type FeatureId = 'chat' | 'ai' | 'wiki' | 'optical' | 'vault';
export interface FeatureDefinition {
  id: FeatureId;
  kind: 'module' | 'plugin';
  version: string;
  nameKey: string;
  descriptionKey: string;
  section: string;
  views: string[];
  settings: string[];
  commands: string[];
  commandPrefixes?: string[];
}
export type FeatureState = Record<FeatureId, boolean>;
export const features = [...catalog, optical, vault] as FeatureDefinition[];
export const defaultFeatureState: FeatureState = { chat: true, ai: true, wiki: true, optical: true, vault: true };
export function featureTranslationKey(key: string): string { return key.includes(':') ? key : `settings:features.${key}`; }
export function normalizeFeatureState(value: unknown): FeatureState {
  const result = { ...defaultFeatureState };
  if (value && typeof value === 'object') {
    for (const { id } of features) if (typeof value[id] === 'boolean') result[id] = value[id];
  }
  return result;
}
export function featureForView(view: string): FeatureId | undefined {
  return features.find(item => item.views.includes(view))?.id;
}
export function featureForSetting(tab: string): FeatureId | undefined {
  return features.find(item => item.settings.includes(tab))?.id;
}
