import React, { useState } from 'react';
import { Puzzle, Layers } from 'lucide-react';
import { features, featureTranslationKey, type FeatureId } from '../../modules/registry';
import { setFeatureEnabled, useFeatures } from '../../modules/state';
import { tr, useLocale } from '../../i18n';
import { PluginCenter } from '../../plugins/PluginCenter';
import { UiSwitch } from '../ui/UiSwitch';

export function FeatureManagementPanel() {
  return <PluginCenter><BuiltinFeatureList /></PluginCenter>;
}

function BuiltinFeatureList() {
  useLocale();
  const enabled = useFeatures();
  const [pending, setPending] = useState<FeatureId | null>(null);
  const [error, setError] = useState('');
  const toggle = async (id: FeatureId) => {
    setPending(id); setError('');
    try { await setFeatureEnabled(id, !enabled[id]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(null); }
  };
  return (
    <div className="space-y-6" data-feature-management>
      <p className="text-sm leading-6 text-sub">{tr('settings:features.scope')}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {(['module', 'plugin'] as const).map(kind => (
        <section key={kind} className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-main">
            {kind === 'module' ? <Layers className="h-4 w-4" /> : <Puzzle className="h-4 w-4" />}
            {tr(`settings:features.${kind === 'module' ? 'modules' : 'plugins'}`)}
          </h3>
          {features.filter(item => item.kind === kind).map(item => (
            <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl border border-edge bg-card p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-main">{tr(featureTranslationKey(item.nameKey))}</span>
                  <span className="text-xs text-quiet">{kind === 'plugin' ? `${tr('settings:features.bundled')} · v${item.version}` : tr('settings:features.builtin')}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-sub">{tr(featureTranslationKey(item.descriptionKey))}</p>
                <p className="mt-1 text-xs text-quiet">{tr(`settings:features.${enabled[item.id] ? 'enabled' : 'disabled'}`)}</p>
              </div>
              <UiSwitch
                checked={enabled[item.id]}
                label={tr(featureTranslationKey(item.nameKey))}
                disabled={pending !== null}
                onChange={() => void toggle(item.id)}
              />
            </div>
          ))}
          {kind === 'plugin' && <p className="text-xs leading-5 text-quiet">{tr('settings:features.bundledNote')}</p>}
        </section>
      ))}
    </div>
  );
}
