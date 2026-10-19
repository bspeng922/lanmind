import React from "react";
import { X } from "lucide-react";
import { tr, useLocale } from "../i18n";
import { ModelSettingsPanel } from "./ai/ModelSettingsPanel";
export const LLMConfigModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  useLocale();
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr("ai:v2.settings")}
        className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl border border-subtle bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-main">
            {tr("ai:v2.settings")}
          </h2>
          <button
            type="button"
            className="ai-v2-btn"
            aria-label={tr("ai:v2.close")}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <ModelSettingsPanel />
      </div>
    </div>
  );
};
