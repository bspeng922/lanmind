/**
 * GroupedModelSelect — 大模型选择下拉框组件（按供应商/品牌智能分组展示，参考 Image 1）。
 *
 * CALLING SPEC:
 *   <GroupedModelSelect
 *     catalog={catalog}
 *     value={string}
 *     onChange={(val: string) => void}
 *     agent={boolean}
 *     disabled={boolean}
 *     label={string}
 *     width={number | string}
 *   />
 */

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, Sparkles, Wrench, X } from "lucide-react";
import { tr, useLocale } from "../../i18n";
import { modelKey, type Catalog } from "./aiClient";

export type ModelBrand =
  | "qwen"
  | "deepseek"
  | "openai"
  | "claude"
  | "llama"
  | "glm"
  | "gemini"
  | "generic";

interface BrandMeta {
  brandName: string;
  brand: ModelBrand;
  bgClass: string;
  textClass: string;
  borderClass: string;
}

export function detectModelBrand(modelId: string, connectionName: string = ""): BrandMeta {
  const text = `${modelId} ${connectionName}`.toLowerCase();

  if (text.includes("qwen") || text.includes("千问")) {
    return {
      brandName: "Qwen",
      brand: "qwen",
      bgClass: "bg-[#615ced]/15 text-[#615ced]",
      textClass: "text-[#615ced]",
      borderClass: "border-[#615ced]/30",
    };
  }
  if (text.includes("deepseek") || text.includes("深度求索")) {
    return {
      brandName: "DeepSeek",
      brand: "deepseek",
      bgClass: "bg-[#0066ff]/15 text-[#0066ff]",
      textClass: "text-[#0066ff]",
      borderClass: "border-[#0066ff]/30",
    };
  }
  if (text.includes("gpt") || text.includes("o1") || text.includes("o3") || text.includes("openai")) {
    return {
      brandName: "OpenAI",
      brand: "openai",
      bgClass: "bg-[#10a37f]/15 text-[#10a37f]",
      textClass: "text-[#10a37f]",
      borderClass: "border-[#10a37f]/30",
    };
  }
  if (text.includes("claude") || text.includes("anthropic")) {
    return {
      brandName: "Claude",
      brand: "claude",
      bgClass: "bg-[#d97706]/15 text-[#d97706]",
      textClass: "text-[#d97706]",
      borderClass: "border-[#d97706]/30",
    };
  }
  if (text.includes("gemini") || text.includes("google")) {
    return {
      brandName: "Gemini",
      brand: "gemini",
      bgClass: "bg-[#4285f4]/15 text-[#4285f4]",
      textClass: "text-[#4285f4]",
      borderClass: "border-[#4285f4]/30",
    };
  }
  if (text.includes("llama") || text.includes("meta")) {
    return {
      brandName: "Llama",
      brand: "llama",
      bgClass: "bg-[#4f46e5]/15 text-[#4f46e5]",
      textClass: "text-[#4f46e5]",
      borderClass: "border-[#4f46e5]/30",
    };
  }
  if (text.includes("glm") || text.includes("chatglm") || text.includes("zhipu")) {
    return {
      brandName: "GLM",
      brand: "glm",
      bgClass: "bg-[#06b6d4]/15 text-[#06b6d4]",
      textClass: "text-[#06b6d4]",
      borderClass: "border-[#06b6d4]/30",
    };
  }

  const groupName = connectionName.trim() || tr("ai:v2.otherModels");
  return {
    brandName: groupName,
    brand: "generic",
    bgClass: "bg-accent/15 text-accent",
    textClass: "text-accent",
    borderClass: "border-accent/30",
  };
}

export const BrandIcon: React.FC<{ brand: ModelBrand; className?: string }> = ({
  brand,
  className = "w-4 h-4",
}) => {
  switch (brand) {
    case "qwen":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
          <path
            d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5A7.51 7.51 0 0 0 12 4.5Zm0 12.8a5.3 5.3 0 1 1 5.3-5.3 5.31 5.31 0 0 1-5.3 5.3Z"
            fill="currentColor"
          />
          <path
            d="M14.6 11.2a2.8 2.8 0 0 0-4.1-1.7 2.85 2.85 0 0 0-1.1 3.9 2.8 2.8 0 0 0 3.9 1.1 2.8 2.8 0 0 0 1.3-3.3Z"
            fill="currentColor"
          />
        </svg>
      );
    case "deepseek":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
          <path
            d="M17.5 8.2c-.3-.8-1.1-1.4-2.1-1.6-1.5-.3-3.4.2-4.9 1.3-1.6 1.1-2.7 2.7-3 4.2-.3 1.3.1 2.5 1 3.2.7.6 1.7.8 2.7.6 1.7-.4 3.3-1.8 4.2-3.6.8-1.5 1.1-3 .9-4.1zm-4.7 5.1c-.8.8-1.9 1.2-2.7.9-.7-.3-.8-1.1-.5-2 .4-1.1 1.4-2.2 2.6-2.8 1.1-.6 2-.6 2.3-.2.3.5.1 1.6-.7 2.7l-1 1.4z"
            fill="currentColor"
          />
        </svg>
      );
    case "openai":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
          <path
            d="M19 10.5a3.8 3.8 0 0 0-.3-2.1 4 4 0 0 0-3.3-2.1 3.8 3.8 0 0 0-3-1.3 4 4 0 0 0-3.7 2.4 3.9 3.9 0 0 0-2.8 1.4 4 4 0 0 0-.5 3.8 3.8 3.8 0 0 0 .3 2.1 4 4 0 0 0 3.3 2.1 3.8 3.8 0 0 0 3 1.3 4 4 0 0 0 3.7-2.4 3.9 3.9 0 0 0 2.8-1.4 4 4 0 0 0 .5-3.8zm-6.6 6.3a2.5 2.5 0 0 1-1.8-.8l.8-.5a1.8 1.8 0 0 0 2.4-.7l.1.1a2.5 2.5 0 0 1-1.5 1.9zm-4.3-1.8a2.5 2.5 0 0 1-.3-2l.9.4a1.8 1.8 0 0 0 .6 2.4l-.1.1a2.4 2.4 0 0 1-1.1-.9zm-1-4.7a2.5 2.5 0 0 1 1.5-1.3v1a1.8 1.8 0 0 0-1.2 2.2l-.1.1a2.5 2.5 0 0 1-.2-2zm6.6-2.5a2.5 2.5 0 0 1 1.8.8l-.8.5a1.8 1.8 0 0 0-2.4.7l-.1-.1a2.5 2.5 0 0 1 1.5-1.9zm4.3 1.8a2.5 2.5 0 0 1 .3 2l-.9-.4a1.8 1.8 0 0 0-.6-2.4l.1-.1a2.4 2.4 0 0 1 1.1.9zm1 4.7a2.5 2.5 0 0 1-1.5 1.3v-1a1.8 1.8 0 0 0 1.2-2.2l.1-.1a2.5 2.5 0 0 1 .2 2z"
            fill="currentColor"
          />
        </svg>
      );
    case "claude":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
          <path
            d="M12 5.5a1 1 0 0 1 1 1v2.1l1.5-1.5a1 1 0 1 1 1.4 1.4L14.4 10h2.1a1 1 0 1 1 0 2h-2.1l1.5 1.5a1 1 0 0 1-1.4 1.4L13 13.4v2.1a1 1 0 1 1-2 0v-2.1l-1.5 1.5a1 1 0 0 1-1.4-1.4L9.6 12H7.5a1 1 0 1 1 0-2h2.1L8.1 8.5a1 1 0 1 1 1.4-1.4L11 8.6V6.5a1 1 0 0 1 1-1z"
            fill="currentColor"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        </svg>
      );
  }
};

export interface GroupedModelItem {
  key: string;
  modelId: string;
  displayName: string;
  connectionId: string;
  connectionName: string;
  brandMeta: BrandMeta;
  hasTools: boolean;
}

export interface ModelGroup {
  name: string;
  brand: ModelBrand;
  items: GroupedModelItem[];
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  openAbove: boolean;
}

export function GroupedModelSelect({
  catalog,
  value,
  onChange,
  agent = false,
  disabled = false,
  label,
  width,
  iconOnly = false,
}: {
  catalog: Catalog;
  value: string;
  onChange: (value: string) => void;
  agent?: boolean;
  disabled?: boolean;
  label?: string;
  width?: number | string;
  iconOnly?: boolean;
}) {
  useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const connections = useMemo(
    () => catalog.connections.filter((c) => c.enabled && c.bound),
    [catalog.connections]
  );

  // 1. 扁平模型项清单与分组构建
  const { allItems, groups } = useMemo(() => {
    const items: GroupedModelItem[] = [];
    const groupMap = new Map<string, { brand: ModelBrand; items: GroupedModelItem[] }>();

    for (const c of connections) {
      for (const m of c.models.filter((item) => item.enabled)) {
        const isAgentDisabled =
          agent &&
          (m.capabilities.tools !== true ||
            m.capabilities.configRevision !== c.configRevision);
        if (!isAgentDisabled) {
          const key = modelKey({ connectionId: c.id, modelEntryId: m.id });
          const brandMeta = detectModelBrand(m.displayName || m.remoteModelId, c.name);
          const hasTools = m.capabilities.tools === true;

          const item: GroupedModelItem = {
            key,
            modelId: m.id,
            displayName: m.displayName || m.remoteModelId,
            connectionId: c.id,
            connectionName: c.name,
            brandMeta,
            hasTools,
          };
          items.push(item);

          const gName = brandMeta.brandName;
          const currentGroup = groupMap.get(gName) || {
            brand: brandMeta.brand,
            items: [],
          };
          currentGroup.items.push(item);
          groupMap.set(gName, currentGroup);
        }
      }
    }

    const groupList: ModelGroup[] = Array.from(groupMap.entries()).map(([name, data]) => ({
      name,
      brand: data.brand,
      items: data.items,
    }));

    return { allItems: items, groups: groupList };
  }, [connections, agent]);

  // 2. 当前选中的模型项
  const selectedItem = useMemo(
    () => allItems.find((item) => item.key === value),
    [allItems, value]
  );

  // 3. 搜索过滤
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.trim().toLowerCase();
    const result: ModelGroup[] = [];

    groups.forEach((g) => {
      const groupMatches = g.name.toLowerCase().includes(q);
      const matchingItems = g.items.filter(
        (it) =>
          groupMatches ||
          it.displayName.toLowerCase().includes(q) ||
          it.connectionName.toLowerCase().includes(q)
      );
      if (matchingItems.length > 0) {
        result.push({
          ...g,
          items: matchingItems,
        });
      }
    });

    return result;
  }, [groups, search]);

  // 4. 定位与外部点击监听
  const calcPosition = (): MenuPosition | null => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const wantedHeight = 360;
    const openAbove = below < wantedHeight && above > below;
    const maxHeight = Math.max(120, Math.min(wantedHeight, openAbove ? above : below));
    const menuWidth = Math.max(rect.width, 260);
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - menuWidth - 10));

    if (openAbove) {
      return {
        bottom: Math.max(10, window.innerHeight - rect.top + 6),
        left,
        width: menuWidth,
        maxHeight,
        openAbove: true,
      };
    }

    return {
      top: Math.max(10, rect.bottom + 6),
      left,
      width: menuWidth,
      maxHeight,
      openAbove: false,
    };
  };

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
    } else {
      const pos = calcPosition();
      if (pos) {
        setMenuPosition(pos);
      }
      setIsOpen(true);
    }
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const pos = calcPosition();
      if (pos) setMenuPosition(pos);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (key: string) => {
    onChange(key);
    setIsOpen(false);
    setSearch("");
  };

  const menu =
    isOpen && menuPosition ? (
      <div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-label={label ?? tr("ai:v2.model")}
        style={{
          position: "fixed",
          ...(menuPosition.top !== undefined ? { top: `${menuPosition.top}px` } : {}),
          ...(menuPosition.bottom !== undefined ? { bottom: `${menuPosition.bottom}px` } : {}),
          left: `${menuPosition.left}px`,
          width: `${menuPosition.width}px`,
          maxHeight: `${menuPosition.maxHeight}px`,
          zIndex: 99999,
          boxShadow: "var(--popover-shadow)",
        }}
        className={`flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover animate-in fade-in duration-100 ${
          menuPosition.openAbove ? "origin-bottom" : "origin-top"
        }`}
      >
      {/* 搜索框 */}
      {allItems.length > 5 && (
        <div className="border-b border-edge p-2 bg-canvas/40">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-quiet" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("ai:v2.searchModelPlaceholder")}
              className="w-full bg-canvas border border-edge rounded-xl pl-8 pr-7 py-1.5 text-xs text-main placeholder:text-quiet focus:outline-none focus:border-accent"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-2 text-quiet hover:text-main"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 分组与模型列表 */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-2 scrollbar-thin">
        {filteredGroups.length === 0 ? (
          <div className="py-6 text-center text-xs text-quiet">{tr("ai:v2.noMatchingModels")}</div>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.name} className="space-y-0.5">
              {/* 分组标题（如 Qwen、DeepSeek） */}
              <div className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-semibold text-quiet tracking-wide select-none">
                {group.name}
              </div>

              {/* 组内模型列表项 */}
              {group.items.map((item) => {
                const isSelected = item.key === value;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(item.key)}
                    className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-xs transition-colors cursor-pointer select-none text-left ${
                      isSelected
                        ? "bg-accent/15 text-accent font-semibold"
                        : "text-main hover:bg-hover"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* 圆形品牌图标 */}
                      <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${item.brandMeta.bgClass} ${item.brandMeta.borderClass}`}
                      >
                        <BrandIcon brand={item.brandMeta.brand} className="h-3.5 w-3.5" />
                      </div>

                      {/* 模型名称 */}
                      <span className="truncate text-xs">{item.displayName}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.hasTools && (
                        <span
                          className="flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-mono text-emerald-600 bg-emerald-500/10 border border-emerald-500/20"
                          title={tr("ai:v2.supportsTools")}
                        >
                          <Wrench className="w-2.5 h-2.5" />
                          <span>Tools</span>
                        </span>
                      )}
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5] text-accent" />}
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`relative ${iconOnly ? "inline-flex shrink-0 w-auto" : "inline-block"}`}
      style={iconOnly ? (width ? { width } : undefined) : { width: width || "100%" }}
    >
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={label ?? tr("ai:v2.model")}
        onClick={handleToggle}
        title={
          selectedItem
            ? `${selectedItem.displayName} (${selectedItem.connectionName})${
                selectedItem.hasTools ? tr("ai:v2.toolsSupported") : ""
              }`
            : tr("ai:v2.selectModel")
        }
        className={
          iconOnly
            ? "inline-flex items-center justify-center gap-1 h-7 px-2 rounded-lg border border-edge/60 bg-surface/80 hover:bg-hover text-sub hover:text-main text-xs font-medium transition-colors disabled:opacity-40 shrink-0"
            : "flex w-full items-center justify-between gap-2 rounded-xl border border-edge bg-surface/90 px-3 py-1.5 text-xs text-main shadow-2xs hover:border-accent/40 focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
        }
      >
        {iconOnly ? (
          <>
            {selectedItem ? (
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selectedItem.brandMeta.bgClass} ${selectedItem.brandMeta.borderClass}`}
              >
                <BrandIcon brand={selectedItem.brandMeta.brand} className="h-2.5 w-2.5" />
              </div>
            ) : (
              <Sparkles size={13} className="text-quiet" />
            )}
            <ChevronDown
              size={10}
              className={`text-quiet transition-transform duration-150 ${
                isOpen ? "rotate-180 text-accent" : ""
              }`}
            />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {selectedItem ? (
                <>
                  {/* 当前激活模型的品牌圆点 */}
                  <div
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selectedItem.brandMeta.bgClass} ${selectedItem.brandMeta.borderClass}`}
                  >
                    <BrandIcon brand={selectedItem.brandMeta.brand} className="h-3 w-3" />
                  </div>
                  <span className="truncate font-semibold">{selectedItem.displayName}</span>
                  {selectedItem.hasTools && (
                    <span className="rounded bg-emerald-500/10 px-1 py-0.2 text-[9px] font-mono text-emerald-600 shrink-0">
                      Tools
                    </span>
                  )}
                </>
              ) : (
                <span className="text-quiet truncate">{tr("ai:v2.selectModel")}</span>
              )}
            </div>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-quiet transition-transform duration-150 ${
                isOpen ? "rotate-180 text-accent" : ""
              }`}
            />
          </>
        )}
      </button>

      {isOpen && menuPosition && createPortal(menu, document.body)}
    </div>
  );
}
