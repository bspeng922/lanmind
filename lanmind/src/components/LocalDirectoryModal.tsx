import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FolderTree, Loader2, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { LocalDirectory, LocalOrgMember, LocalOrgUnit, User } from '../types';
import { ApiService } from '../services/api';

interface LocalDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  directory: LocalDirectory;
  onSaved: (directory: LocalDirectory) => void;
}

const unitDepth = (unit: LocalOrgUnit, byId: Map<string, LocalOrgUnit>) => {
  let depth = 0;
  const seen = new Set<string>();
  let parentId = unit.parentId || null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentId || null;
  }
  return Math.min(depth, 5);
};

export const LocalDirectoryModal: React.FC<LocalDirectoryModalProps> = ({
  isOpen,
  onClose,
  users,
  directory,
  onSaved,
}) => {
  const [units, setUnits] = useState<LocalOrgUnit[]>([]);
  const [members, setMembers] = useState<LocalOrgMember[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setUnits(directory.units.map((unit) => ({ ...unit })));
    setMembers(directory.members.map((member) => ({ ...member })));
    setSelectedUnitId(directory.units[0]?.id || null);
    setSearchQuery('');
    setMemberSearchQuery('');
    setErrorMessage(null);
  }, [directory, isOpen]);

  const unitsById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const visibleUnits = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const compare = (left: LocalOrgUnit, right: LocalOrgUnit) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
    const children = new Map<string | null, LocalOrgUnit[]>();
    units.forEach((unit) => {
      const parentId = unit.parentId && unitsById.has(unit.parentId) ? unit.parentId : null;
      children.set(parentId, [...(children.get(parentId) || []), unit]);
    });
    children.forEach((items) => items.sort(compare));
    const ordered: LocalOrgUnit[] = [];
    const append = (parentId: string | null) => {
      (children.get(parentId) || []).forEach((unit) => {
        ordered.push(unit);
        append(unit.id);
      });
    };
    append(null);
    return ordered.filter((unit) => !query || unit.name.toLocaleLowerCase().includes(query));
  }, [searchQuery, units, unitsById]);
  const selectedUnit = selectedUnitId ? unitsById.get(selectedUnitId) : undefined;
  const selectedMemberIds = useMemo(
    () => new Set(members.filter((member) => member.orgUnitId === selectedUnitId).map((member) => member.userId)),
    [members, selectedUnitId],
  );
  const visibleUsers = useMemo(() => {
    const query = memberSearchQuery.trim().toLocaleLowerCase();
    return users
      .filter((user) => !query || [user.nickname, user.username, user.deviceId, user.ip].some((value) => value.toLocaleLowerCase().includes(query)))
      .sort((left, right) => Number(right.isOnline) - Number(left.isOnline) || left.nickname.localeCompare(right.nickname));
  }, [memberSearchQuery, users]);

  if (!isOpen) return null;

  const addUnit = () => {
    const next: LocalOrgUnit = {
      id: `local-org-${crypto.randomUUID()}`,
      name: '新组织',
      parentId: null,
      sortOrder: units.length,
    };
    setUnits((previous) => [...previous, next]);
    setSelectedUnitId(next.id);
    setErrorMessage(null);
  };

  const updateSelectedUnit = (updates: Partial<LocalOrgUnit>) => {
    if (!selectedUnitId) return;
    setUnits((previous) => previous.map((unit) => unit.id === selectedUnitId ? { ...unit, ...updates } : unit));
  };

  const removeSelectedUnit = () => {
    if (!selectedUnit) return;
    const replacementParentId = selectedUnit.parentId || null;
    setUnits((previous) => previous.map((unit) => unit.id === selectedUnit.id
      ? unit
      : unit.parentId === selectedUnit.id ? { ...unit, parentId: replacementParentId } : unit).filter((unit) => unit.id !== selectedUnit.id));
    setMembers((previous) => previous.filter((member) => member.orgUnitId !== selectedUnit.id));
    const nextUnit = units.find((unit) => unit.id !== selectedUnit.id);
    setSelectedUnitId(nextUnit?.id || null);
  };

  const toggleMember = (userId: string) => {
    if (!selectedUnitId) return;
    setMembers((previous) => {
      const exists = previous.some((member) => member.orgUnitId === selectedUnitId && member.userId === userId);
      return exists
        ? previous.filter((member) => !(member.orgUnitId === selectedUnitId && member.userId === userId))
        : [...previous, { orgUnitId: selectedUnitId, userId }];
    });
  };

  const handleSave = async () => {
    if (units.some((unit) => !unit.name.trim())) {
      setErrorMessage('组织名称不能为空');
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const saved = await ApiService.saveLocalDirectory({
        units: units.map((unit) => ({ ...unit, name: unit.name.trim() })),
        members,
      });
      onSaved(saved);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存本地组织失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/80 p-4 backdrop-blur-sm">
      <div className="flex h-[min(680px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-subtle bg-surface shadow-popover">
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl border border-accent/30 bg-accent/15 p-2 text-accent"><FolderTree className="h-4 w-4" /></div>
            <div>
              <h2 className="text-sm font-bold text-main">本地组织目录</h2>
              <p className="mt-0.5 text-[11px] text-sub">仅保存在本机，用于快速筛选和添加群成员</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-sub hover:bg-hover hover:text-main" aria-label="关闭本地组织目录"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <section className="flex max-h-48 w-full flex-shrink-0 flex-col border-b border-edge bg-canvas/50 p-3 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
            <div className="mb-2 flex items-center gap-2">
              <div className="relative flex-1">
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索组织" className="w-full rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs text-main outline-none placeholder-quiet focus:border-accent" />
              </div>
              <button type="button" onClick={addUnit} className="rounded-lg border border-accent/30 bg-accent/15 p-1.5 text-accent hover:bg-accent hover:text-on-accent" title="新建组织" aria-label="新建组织"><Plus className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {visibleUnits.length === 0 ? (
                <div className="rounded-lg border border-dashed border-edge px-3 py-8 text-center text-[11px] text-quiet">还没有本地组织</div>
              ) : visibleUnits.map((unit) => {
                const active = unit.id === selectedUnitId;
                const memberCount = members.filter((member) => member.orgUnitId === unit.id).length;
                return (
                  <button key={unit.id} type="button" onClick={() => setSelectedUnitId(unit.id)} className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-2 text-left text-xs transition-colors ${active ? 'border-accent/40 bg-accent/15 text-accent' : 'border-transparent text-sub hover:border-edge hover:bg-hover'}`} style={{ paddingLeft: `${8 + unitDepth(unit, unitsById) * 14}px` }}>
                    {units.some((child) => child.parentId === unit.id) ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 opacity-30" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{unit.name}</span>
                    <span className="text-[10px] text-quiet">{memberCount}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="min-w-0 flex-1 overflow-y-auto p-5">
            {!selectedUnit ? (
              <div className="flex h-full items-center justify-center text-xs text-quiet">选择或新建一个组织开始配置</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-[11px] font-semibold text-sub">组织名称</label>
                    <input value={selectedUnit.name} onChange={(event) => updateSelectedUnit({ name: event.target.value })} className="w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-sm font-semibold text-main outline-none focus:border-accent" maxLength={40} />
                  </div>
                  <button type="button" onClick={removeSelectedUnit} className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-danger hover:bg-rose-500/20" title="删除组织" aria-label="删除组织"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-sub">上级组织</label>
                  <select value={selectedUnit.parentId || ''} onChange={(event) => updateSelectedUnit({ parentId: event.target.value || null })} className="w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-main outline-none focus:border-accent">
                    <option value="">作为顶级组织</option>
                    {units.filter((unit) => {
                      if (unit.id === selectedUnit.id) return false;
                      let parentId = unit.parentId || null;
                      const seen = new Set<string>();
                      while (parentId && !seen.has(parentId)) {
                        if (parentId === selectedUnit.id) return false;
                        seen.add(parentId);
                        parentId = unitsById.get(parentId)?.parentId || null;
                      }
                      return true;
                    }).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                  </select>
                </div>
                <div className="border-t border-edge pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div><h3 className="flex items-center gap-1.5 text-xs font-bold text-main"><Users className="h-3.5 w-3.5 text-success" />组织成员</h3><p className="mt-0.5 text-[10px] text-quiet">同一个人可以加入多个本地组织</p></div>
                    <span className="text-[10px] text-accent">已选 {selectedMemberIds.size} 人</span>
                  </div>
                  <input value={memberSearchQuery} onChange={(event) => setMemberSearchQuery(event.target.value)} placeholder="搜索成员" className="mb-2 w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-main outline-none placeholder-quiet focus:border-accent" />
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-edge bg-canvas/50 p-2">
                    {visibleUsers.map((user) => {
                      const checked = selectedMemberIds.has(user.id);
                      return <button key={user.id} type="button" onClick={() => toggleMember(user.id)} className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors ${checked ? 'border-accent/30 bg-accent/10' : 'border-transparent hover:border-edge hover:bg-hover'}`}>
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-accent bg-accent text-on-accent' : 'border-subtle bg-surface'}`}>{checked && <Check className="h-3 w-3" />}</span>
                        <span className={`h-2 w-2 rounded-full ${user.isOnline ? 'bg-emerald-400' : 'bg-muted'}`} />
                        <span className="min-w-0 flex-1 truncate font-medium text-main">{user.nickname}</span>
                        <span className="max-w-32 truncate font-mono text-[10px] text-quiet">{user.ip}</span>
                      </button>;
                    })}
                    {visibleUsers.length === 0 && <div className="py-6 text-center text-[11px] text-quiet">没有匹配的局域网成员</div>}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {errorMessage && <div className="border-t border-rose-500/20 bg-rose-500/10 px-5 py-2 text-xs text-danger">{errorMessage}</div>}
        <div className="flex items-center justify-between border-t border-edge px-5 py-3">
          <span className="text-[10px] text-quiet">不会同步给局域网中的其他用户</span>
          <div className="flex gap-2"><button type="button" onClick={onClose} className="ui-cancel-button rounded-lg px-3 py-1.5 text-xs">取消</button><button type="button" onClick={handleSave} disabled={isSaving} className="theme-btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存目录</button></div>
        </div>
      </div>
    </div>
  );
};
