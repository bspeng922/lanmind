/**
 * ModelFetchModal — 从上游获取模型后的勾选启用弹窗（参考 Image 1）。
 *
 * CALLING SPEC:
 *   <ModelFetchModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     channelName={string}
 *     availableModelIds={string[]}
 *     initialSelectedModelIds={string[]}
 *     onSaveModels={(selectedIds: string[]) => void}
 *   />
 */

import React, { useMemo, useState, useEffect } from "react";
import { Check, Search, X } from "lucide-react";
import { tr, useLocale } from "../../i18n";

export interface ModelFetchModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelName: string;
  availableModelIds: string[];
  initialSelectedModelIds: string[];
  onSaveModels: (selectedIds: string[]) => void;
}

export const ModelFetchModal: React.FC<ModelFetchModalProps> = ({
  isOpen,
  onClose,
  channelName,
  availableModelIds = [],
  initialSelectedModelIds = [],
  onSaveModels,
}) => {
  useLocale();
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedModelIds);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "new" | "existing">("all");
  const prevIsOpenRef = React.useRef(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setSelectedIds(initialSelectedModelIds);
      setSearchQuery("");
      setActiveTab("all");
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialSelectedModelIds]);

  const existingSet = useMemo(() => new Set(initialSelectedModelIds), [initialSelectedModelIds]);

  const filteredModels = useMemo(() => {
    let list = availableModelIds;
    if (activeTab === "new") {
      list = list.filter((id) => !existingSet.has(id));
    } else if (activeTab === "existing") {
      list = list.filter((id) => existingSet.has(id));
    }

    if (!searchQuery.trim()) return list;
    const q = searchQuery.trim().toLowerCase();
    return list.filter((id) => id.toLowerCase().includes(q));
  }, [availableModelIds, activeTab, existingSet, searchQuery]);

  const allFilteredSelected =
    filteredModels.length > 0 &&
    filteredModels.every((id) => selectedIds.includes(id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredModels.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredModels])));
    }
  };

  const toggleModel = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    onSaveModels(selectedIds);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex h-[76vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-200">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5 bg-canvas/40">
          <div>
            <h3 className="text-sm font-bold text-main">获取模型</h3>
            <p className="text-xs text-quiet mt-0.5">
              渠道: <span className="font-semibold text-main">{channelName || "本地渠道"}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 搜索框与筛选 Tabs */}
        <div className="border-b border-edge p-4 space-y-3 bg-canvas/20">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-quiet" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模型..."
              className="w-full bg-canvas border border-edge rounded-xl pl-8 pr-3 py-1.5 text-xs text-main focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex rounded-lg border border-edge bg-canvas/60 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`flex-1 rounded-md py-1 text-center transition-colors ${
                activeTab === "all" ? "bg-accent text-on-accent" : "text-sub hover:text-main"
              }`}
            >
              全部模型 ({availableModelIds.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("new")}
              className={`flex-1 rounded-md py-1 text-center transition-colors ${
                activeTab === "new" ? "bg-accent text-on-accent" : "text-sub hover:text-main"
              }`}
            >
              新模型 ({availableModelIds.filter((id) => !existingSet.has(id)).length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("existing")}
              className={`flex-1 rounded-md py-1 text-center transition-colors ${
                activeTab === "existing" ? "bg-accent text-on-accent" : "text-sub hover:text-main"
              }`}
            >
              现有模型 ({availableModelIds.filter((id) => existingSet.has(id)).length})
            </button>
          </div>
        </div>

        {/* 全选操作栏 */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-2 text-xs bg-canvas/10">
          <label className="flex items-center gap-2 cursor-pointer font-semibold text-main select-none">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              className="h-4 w-4 rounded border-edge text-accent focus:ring-accent cursor-pointer"
            />
            <span>模型列表 ({filteredModels.length})</span>
          </label>
          <span className="text-quiet text-[11px] font-mono">
            {filteredModels.filter((id) => selectedIds.includes(id)).length} / {filteredModels.length} 已选
          </span>
        </div>

        {/* 模型复选列表：双列网格 */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          {filteredModels.length === 0 ? (
            <div className="py-12 text-center text-xs text-quiet">
              未找到匹配的模型，请检查搜索词或上游服务配置
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filteredModels.map((id) => {
                const isChecked = selectedIds.includes(id);
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => toggleModel(id)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-xs transition-colors cursor-pointer select-none text-left w-full ${
                      isChecked
                        ? "border-accent/40 bg-accent/10 text-main font-medium"
                        : "border-edge bg-canvas/40 hover:border-accent/20 text-sub hover:text-main"
                    }`}
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        isChecked
                          ? "border-accent bg-accent text-on-accent"
                          : "border-edge bg-surface"
                      }`}
                    >
                      {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span className="truncate font-mono text-[11px]">{id}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部保存栏 */}
        <div className="flex items-center justify-between border-t border-edge bg-canvas/40 px-5 py-3">
          <div className="text-xs text-quiet">
            已勾选 <span className="font-bold text-accent">{selectedIds.length}</span> 个模型
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-edge bg-surface px-4 py-1.5 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-xl bg-accent px-5 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors shadow-soft"
            >
              保存模型
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
