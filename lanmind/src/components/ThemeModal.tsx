import { tr, useLocale } from "../i18n";
import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { X, Palette, Check, Monitor, Sparkles } from 'lucide-react';

interface ThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ThemeModal: React.FC<ThemeModalProps> = ({ isOpen, onClose }) => {
  useLocale();
  const { currentTheme, themePreference, setThemeId, allThemes } = useTheme();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg space-y-5 overflow-y-auto rounded-2xl border border-edge bg-surface p-6 shadow-popover animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-edge">
          <div className="flex items-center space-x-2 text-feature">
            <Palette className="w-5 h-5" />
            <h2 className="text-sm font-bold text-main">{tr("settings:themeModal.appearance")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-modal-close-btn"
            title={tr("settings:themeModal.closeEsc")}
            aria-label={tr("settings:themeModal.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-sub">
          {tr("settings:themeModal.chooseAThemeChangesAreSavedOn")}</p>

        <button
          type="button"
          role="switch"
          aria-checked={themePreference === 'system'}
          onClick={() => setThemeId(themePreference === 'system' ? currentTheme.id : 'system')}
          className="flex w-full items-center justify-between gap-4 rounded-xl border border-edge bg-canvas/60 p-3.5 text-left transition-colors hover:border-subtle hover:bg-hover/50"
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-info">
              <Monitor className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-xs font-bold text-main">{tr("settings:themeModal.followSystem")}</span>
              <span className="mt-0.5 block text-[10px] text-sub">
                {tr("settings:themeModal.useTitaniumLightInLightModeAnd")}</span>
            </span>
          </span>
          <span
            aria-hidden="true"
            className="ui-switch"
            data-state={themePreference === 'system' ? 'checked' : 'unchecked'}
          >
            <span className="ui-switch-thumb" />
          </span>
        </button>

        {/* Theme Options Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {allThemes.map((theme) => {
            const isSelected = themePreference === theme.id;
            const accentColor = theme.accentColor || '#3b82f6';
            return (
              <button
                key={theme.id}
                onClick={() => setThemeId(theme.id)}
                style={isSelected ? { borderColor: accentColor, boxShadow: `0 8px 24px ${accentColor}25` } : undefined}
                className={`p-3.5 rounded-xl border text-left transition-all duration-200 relative group flex flex-col justify-between ${
                  isSelected
                    ? 'bg-card/90 ring-1'
                    : 'bg-canvas/60 border-edge hover:border-subtle hover:bg-hover/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2.5">
                      <div
                        className="w-5 h-5 rounded-full shadow-inner flex-shrink-0 ring-1 ring-white/20"
                        style={{ background: theme.previewColor }}
                      />
                      <span className="text-xs font-bold text-main group-hover:text-info transition-colors">
                        {theme.name}
                      </span>
                    </div>

                    {isSelected && (
                      <span
                        className="w-5 h-5 rounded-full text-on-solid flex items-center justify-center text-xs shadow-panel"
                        style={{ backgroundColor: accentColor }}
                      >
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-sub line-clamp-2 leading-relaxed">
                    {theme.description}
                  </p>
                </div>

                {/* Swatch Elements */}
                <div className="mt-3 pt-2 border-t border-edge/60 flex items-center justify-between text-[10px] text-quiet font-mono">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-3 h-3 rounded-full bg-canvas border border-edge" />
                    <span className="w-3 h-3 rounded-full bg-card border border-subtle" />
                    <span
                      className="w-3 h-3 rounded-full shadow-soft"
                      style={{ backgroundColor: accentColor }}
                    />
                  </div>
                  <span className="rounded bg-card/60 px-1.5 py-0.5 text-[9px] text-sub border border-subtle/50">
                    {theme.id === 'titanium-light' ? tr("settings:themeModal.lightTheme") : tr("settings:themeModal.darkTheme")}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-edge">
          <div className="flex items-center space-x-1.5 text-xs text-sub">
            <Sparkles className="w-3.5 h-3.5 text-warning" />
            <span>
              {tr("settings:themeModal.active")}<strong className="text-main">{currentTheme.name}</strong>
              {themePreference === 'system' && tr("settings:themeModal.followSystem2")}
            </span>
          </div>

          <button
            onClick={onClose}
            className="theme-btn-primary px-4 py-1.5 text-xs font-bold rounded-xl"
          >
            {tr("settings:themeModal.done")}</button>
        </div>
      </div>
    </div>
  );
};
