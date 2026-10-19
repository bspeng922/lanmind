/**
 * ModelSettingsPanel — AI 模块主设置入口（模型供应商、Skill 技能、MCP 扩展、定时任务）。
 *
 * CALLING SPEC:
 *   <ModelSettingsPanel defaultTab?: string />
 */

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { tr, useLocale } from "../../i18n";
import { AI, aiError, type Catalog } from "./aiClient";
import { AgentSettingsPanel } from "./AgentSettingsPanel";
import { ModelProvidersPanel } from "./ModelProvidersPanel";
import "./ai-v2.css";

const emptyCatalog: Catalog = { schemaVersion: 2, connections: [], defaults: {} };

export function ModelSettingsPanel({
  defaultTab = "models",
}: {
  defaultTab?: string;
} = {}) {
  useLocale();
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [tab, setTab] = useState(defaultTab);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const value = await AI.call<Catalog>("catalog");
      setCatalog(value);
      return value;
    } catch (e) {
      setError(aiError(e));
      return emptyCatalog;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tabLabels: Record<string, string> = {
    models: tr("ai:v2.models"),
    skills: tr("ai:v2.skills"),
    mcp: tr("ai:v2.mcp"),
    schedules: tr("ai:v2.schedules"),
  };

  return (
    <section className="ai-v2 space-y-4" aria-label={tr("ai:v2.settings")}>
      <nav className="flex flex-wrap gap-1" aria-label={tr("ai:v2.settings")}>
        {["models", "skills", "mcp", "schedules"].map((t) => (
          <button
            key={t}
            type="button"
            className={`ai-v2-tab ${tab === t ? "is-active" : ""}`}
            onClick={() => setTab(t)}
          >
            {tabLabels[t] || tr(`ai:v2.${t}`) || t}
          </button>
        ))}
      </nav>

      {error && (
        <p role="alert" className="ai-v2-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ai-v2-success">
          <CheckCircle2 size={14} />
          {notice}
        </p>
      )}

      {tab === "models" ? (
        <ModelProvidersPanel />
      ) : (
        <AgentSettingsPanel tab={tab} catalog={catalog} />
      )}
    </section>
  );
}
