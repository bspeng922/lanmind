/**
 * ProviderPresets — 模型供应商快捷预设配置与网格卡片展示。
 *
 * CALLING SPEC:
 *   import { PRESETS, ProviderPresetGrid } from "./ProviderPresets";
 *   <ProviderPresetGrid onSelectPreset={(key: string) => void} />
 */

import React from "react";
import { Plus } from "lucide-react";

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
    name: "Ollama",
    url: "http://127.0.0.1:11434/v1",
    type: "ollama",
    desc: "轻量高效的本地模型框架，零配置即开即用",
    icon: "🦙",
    badge: "本地首选",
  },
  vllm: {
    name: "vLLM",
    url: "http://127.0.0.1:8000/v1",
    type: "vllm",
    desc: "针对高吞吐量优化的分布式 LLM 推理引擎",
    icon: "⚡",
    badge: "高性能",
  },
  sglang: {
    name: "SGLang",
    url: "http://127.0.0.1:30000/v1",
    type: "sglang",
    desc: "针对结构化生成与复杂 Agent 调用的高并发推理服务",
    icon: "🚀",
    badge: "Agent 加速",
  },
  "openai-compatible": {
    name: "OpenAI 兼容",
    url: "https://api.openai.com/v1",
    type: "openai-compatible",
    desc: "兼容 DeepSeek、通义千问、智谱、Moonshot 等标准 API",
    icon: "🌐",
    badge: "通用标准",
  },
};

export const ProviderPresetGrid: React.FC<{
  onSelectPreset: (key: string) => void;
}> = ({ onSelectPreset }) => {
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
            <span>立即创建</span>
            <Plus className="w-3.5 h-3.5 text-accent group-hover:scale-125 transition-transform" />
          </div>
        </button>
      ))}
    </div>
  );
};
