/**
 * ProviderPresets — 模型供应商快捷预设配置与网格卡片展示。
 *
 * CALLING SPEC:
 *   import { PRESETS, ProviderPresetGrid } from "./ProviderPresets";
 *   <ProviderPresetGrid onSelectPreset={(key: string) => void} />
 */

import React from "react";
import { Plus } from "lucide-react";
import { tr, useLocale } from "../../i18n";

export interface PresetDef {
  name: string;
  url: string;
  type: string;
  desc: string;
  icon: string;
  badge: string;
}

export const PRESETS: Record<string, PresetDef> = {
  ollama: {
    get name() { return "Ollama"; },
    url: "http://127.0.0.1:11434/v1",
    type: "ollama",
    get desc() { return tr("ai:presets.ollamaDesc"); },
    icon: "🦙",
    get badge() { return tr("ai:presets.ollamaBadge"); },
  },
  vllm: {
    get name() { return "vLLM"; },
    url: "http://127.0.0.1:8000/v1",
    type: "vllm",
    get desc() { return tr("ai:presets.vllmDesc"); },
    icon: "⚡",
    get badge() { return tr("ai:presets.vllmBadge"); },
  },
  sglang: {
    get name() { return "SGLang"; },
    url: "http://127.0.0.1:30000/v1",
    type: "sglang",
    get desc() { return tr("ai:presets.sglangDesc"); },
    icon: "🚀",
    get badge() { return tr("ai:presets.sglangBadge"); },
  },
  "openai-compatible": {
    get name() { return tr("ai:presets.openaiName"); },
    url: "https://api.openai.com/v1",
    type: "openai-compatible",
    get desc() { return tr("ai:presets.openaiDesc"); },
    icon: "🌐",
    get badge() { return tr("ai:presets.openaiBadge"); },
  },
};

export const ProviderPresetGrid: React.FC<{
  onSelectPreset: (key: string) => void;
}> = ({ onSelectPreset }) => {
  useLocale();
  return (
    <div className="grid grid-cols-4 gap-3.5">
      {Object.entries(PRESETS).map(([key, p]) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelectPreset(key)}
          className="group flex flex-col justify-between rounded-2xl border border-edge bg-surface p-4 text-left shadow-soft hover:border-accent hover:shadow-strong transition-all cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">{p.icon}</span>
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {p.badge}
              </span>
            </div>
            <h4 className="font-bold text-main text-xs group-hover:text-accent transition-colors">
              {p.name}
            </h4>
            <p className="text-[11px] text-quiet mt-1 leading-4">{p.desc}</p>
          </div>

          <div className="mt-4 pt-2.5 border-t border-edge/60 flex items-center justify-between text-[11px] text-sub font-semibold">
            <span>{tr("ai:presets.createNow")}</span>
            <Plus className="w-3.5 h-3.5 text-accent group-hover:scale-125 transition-transform" />
          </div>
        </button>
      ))}
    </div>
  );
};
