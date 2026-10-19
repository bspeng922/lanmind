/**
 * ProjectSettingsModal — Dedicated Plane-style Project Management View.
 *
 * CALLING SPEC:
 *   <ProjectSettingsModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     project={Project}
 *     users={User[]}
 *     currentUser={User}
 *     localDirectory?: LocalDirectory
 *     onProjectSaved: () => void | Promise<void>
 *     onProjectDeleted?: (projectId: string) => void | Promise<void>
 *     onStatesChanged?: (states: WorkItemState[]) => void
 *   />
 *
 * Provides comprehensive project administration:
 * - Tab 'General': Cover banner with dynamic theme accent, project name,
 *   immutable identifier, description, visibility, leader, timezone, and project color.
 * - Tab 'Members': Default assignee (ThemeSelect), guest access toggle, searchable member list
 *   with role switching (Admin / Member / Viewer via ThemeSelect), add member dialog.
 * - Fixed Modal Footer: Standardized "取消" (Cancel) & "保存更改" (Save Changes) actions.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Settings,
  Users,
  Folder,
  Check,
  Pipette,
  Loader2,
  AlertCircle,
  Calendar,
  Target,
} from 'lucide-react';
import { Project, User, LocalDirectory, WorkItemState } from '../types';
import { ApiService } from '../services/api';
import { tr, useLocale } from '../i18n';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { ThemeDatePicker } from './ThemeDatePicker';
import { ProjectMembersPanel } from './ProjectMembersPanel';

const PRESET_PROJECT_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#6366f1', '#06b6d4'];

const COMMON_TIMEZONES = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
  { value: 'UTC', label: 'UTC (UTC+0)' },
  { value: 'America/New_York', label: 'America/New_York (UTC-5)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-8)' },
  { value: 'Europe/London', label: 'Europe/London (UTC+0)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
];

const isValidHex = (hex: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);

export type ProjectSettingsTab = 'general' | 'members';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  users: User[];
  currentUser: User;
  localDirectory?: LocalDirectory;
  onProjectSaved: () => void | Promise<void>;
  onProjectDeleted?: (projectId: string) => void | Promise<void>;
  onStatesChanged?: (states: WorkItemState[]) => void;
}

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  isOpen,
  onClose,
  project,
  users,
  currentUser,
  localDirectory,
  onProjectSaved,
}) => {
  useLocale();
  const [activeTab, setActiveTab] = useState<ProjectSettingsTab>('general');

  // General fields
  const [name, setName] = useState(project.name);
  const [identifier] = useState(project.identifier || '');
  const [description, setDescription] = useState(project.description || '');
  const [color, setColor] = useState(project.color || '#3b82f6');
  const [visibility, setVisibility] = useState<'public' | 'private'>(project.visibility || 'public');
  const [leaderId, setLeaderId] = useState(project.leadId || project.createdBy);
  const [timezone, setTimezone] = useState(project.timezone || 'Asia/Shanghai');
  const [startDate, setStartDate] = useState(project.startDate || '');
  const [targetDate, setTargetDate] = useState(project.targetDate || '');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Members fields
  const [members, setMembers] = useState<string[]>(project.members || []);
  const [admins, setAdmins] = useState<string[]>(project.admins || []);
  const [defaultAssignee, setDefaultAssignee] = useState<string>('');
  const [guestAccess, setGuestAccess] = useState(false);

  // Sync state when project changes
  useEffect(() => {
    if (!isOpen) return;
    setName(project.name);
    setDescription(project.description || '');
    setColor(project.color || '#3b82f6');
    setVisibility(project.visibility || 'public');
    setLeaderId(project.leadId || project.createdBy);
    setTimezone(project.timezone || 'Asia/Shanghai');
    setStartDate(project.startDate || '');
    setTargetDate(project.targetDate || '');
    setMembers(project.members || []);
    setAdmins(project.admins || []);
    setIsSaving(false);
    setStatusMessage(null);
  }, [project, isOpen]);

  const visibilityOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'public', label: `🌐 ${tr('projects:projectModal.visibilityPublic')}` },
      { value: 'private', label: `🔒 ${tr('projects:projectModal.visibilityPrivate')}` },
    ],
    []
  );

  const leaderOptions: ThemeSelectOption[] = useMemo(
    () =>
      users.map((u) => ({
        value: u.id,
        label: `${u.nickname || u.username} (${u.id === currentUser.id ? tr('projects:projectModal.me') : u.username})`,
      })),
    [users, currentUser.id]
  );

  const timezoneOptions: ThemeSelectOption[] = useMemo(
    () => COMMON_TIMEZONES.map((tz) => ({ value: tz.value, label: tz.label })),
    []
  );

  if (!isOpen) return null;

  const isProjectAdmin = project.admins.includes(currentUser.id) || project.createdBy === currentUser.id;

  const handleUpdateProject = async () => {
    if (!isProjectAdmin) return;
    setIsSaving(true);
    setStatusMessage(null);

    try {
      await ApiService.updateProject(
        project.id,
        {
          name: name.trim(),
          description: description.trim(),
          color,
          visibility,
          leadId: leaderId || undefined,
          timezone: timezone || undefined,
          startDate: startDate ? startDate : null,
          targetDate: targetDate ? targetDate : null,
          members,
          admins,
        },
        currentUser.id
      );

      setStatusMessage({ text: '项目设置已成功保存', type: 'success' });
      await onProjectSaved();
    } catch (err: any) {
      setStatusMessage({ text: err.message || '保存项目设置失败', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const bannerBackground = `linear-gradient(135deg, color-mix(in srgb, ${color} 32%, #0f172a) 0%, #0f172a 60%, color-mix(in srgb, ${color} 18%, #1e293b) 100%)`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div className="relative flex h-[88vh] w-[1140px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-200">
        {/* Top Breadcrumb & Close Bar */}
        <div className="flex items-center justify-between border-b border-edge bg-canvas/40 px-6 py-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-sub">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-main font-bold">{project.name}</span>
            <span className="text-quiet">/</span>
            <span>设置</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Body: Left Navigation Tabs + Right Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left Navigation */}
          <div className="w-48 shrink-0 border-r border-edge bg-canvas/30 p-3 space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-quiet">
              项目配置
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('general')}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                activeTab === 'general'
                  ? 'bg-accent/15 text-accent'
                  : 'text-sub hover:bg-hover hover:text-main'
              }`}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>基础设置</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                activeTab === 'members'
                  ? 'bg-accent/15 text-accent'
                  : 'text-sub hover:bg-hover hover:text-main'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>成员与权限</span>
              <span className="ml-auto rounded-full bg-card px-1.5 py-0.2 text-[10px] font-mono text-sub">
                {members.length}
              </span>
            </button>
          </div>

          {/* Right Scrollable Content Pane */}
          <div className={`flex-1 overflow-y-auto ${activeTab === 'members' ? 'p-4' : 'p-6'}`}>
            {statusMessage && (
              <div
                className={`mb-5 flex items-center gap-2 rounded-xl border p-3 text-xs ${
                  statusMessage.type === 'success'
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-danger/30 bg-danger/10 text-danger'
                }`}
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* TAB 1: GENERAL */}
            {activeTab === 'general' && (
              <div className="space-y-5 w-full max-w-4xl">
                {/* Project Header Banner — compact & centered without awkward upper blank space */}
                <div
                  className="relative w-full rounded-2xl overflow-hidden shadow-inner flex items-center justify-between px-5 py-3.5 transition-all border border-white/10"
                  style={{ background: bannerBackground }}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-strong border border-white/20 text-white font-bold"
                      style={{ backgroundColor: color }}
                    >
                      <Folder className="w-5 h-5" />
                    </div>
                    <div className="text-white drop-shadow-md min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold truncate">{name || '未命名项目'}</h2>
                        <span className="font-mono bg-black/30 px-1.5 py-0.2 rounded border border-white/15 text-[10px] font-semibold shrink-0">
                          {identifier || 'PRJ'}
                        </span>
                        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded bg-white/15 text-white/90 shrink-0">
                          {visibility === 'public' ? 'Public' : 'Private'}
                        </span>
                      </div>
                      {(startDate || targetDate) && (
                        <div className="flex items-center gap-1 font-mono text-[11px] text-white/80 mt-1">
                          <Calendar className="w-3 h-3 text-white/80 shrink-0" />
                          <span>{startDate || '—'} ~ {targetDate || '—'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Form fields */}
                <div className="space-y-4 text-xs">
                  {/* Project Name */}
                  <div>
                    <label className="mb-1.5 block font-semibold text-sub">项目名称 (Project Name)</label>
                    <input
                      type="text"
                      value={name}
                      disabled={!isProjectAdmin}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-canvas border border-edge rounded-xl px-3.5 py-2.5 text-xs text-main focus:outline-none focus:border-accent disabled:opacity-50"
                      placeholder="输入项目名称..."
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="mb-1.5 block font-semibold text-sub">描述 (Description)</label>
                    <textarea
                      value={description}
                      disabled={!isProjectAdmin}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="w-full bg-canvas border border-edge rounded-xl p-3 text-xs text-main focus:outline-none focus:border-accent resize-none disabled:opacity-50"
                      placeholder="简短描述项目目标或背景..."
                    />
                  </div>

                  {/* ID & Visibility Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 flex items-center justify-between font-semibold text-sub">
                        <span>项目标识 (Identifier)</span>
                        <span className="text-[10px] text-quiet">创建后不可修改</span>
                      </label>
                      <input
                        type="text"
                        value={identifier}
                        disabled={true}
                        readOnly={true}
                        title="项目标识用于生成任务编号（如 PRJ-1），创建后不可修改"
                        className="w-full bg-canvas/50 border border-edge rounded-xl px-3.5 py-2.5 font-mono uppercase text-xs text-sub cursor-not-allowed select-none opacity-80"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block font-semibold text-sub">{tr('projects:projectModal.visibility')}</label>
                      <ThemeSelect
                        portal
                        disabled={!isProjectAdmin}
                        value={visibility}
                        options={visibilityOptions}
                        onChange={(val) => setVisibility(val as 'public' | 'private')}
                        ariaLabel={tr('projects:projectModal.visibility')}
                      />
                    </div>
                  </div>

                  {/* Leader & Timezone Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block font-semibold text-sub">{tr('projects:projectModal.projectLead')}</label>
                      <ThemeSelect
                        portal
                        disabled={!isProjectAdmin}
                        value={leaderId}
                        options={leaderOptions}
                        onChange={(val) => setLeaderId(val)}
                        ariaLabel={tr('projects:projectModal.projectLead')}
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block font-semibold text-sub">{tr('projects:projectModal.timezone')}</label>
                      <ThemeSelect
                        portal
                        disabled={!isProjectAdmin}
                        value={timezone}
                        options={timezoneOptions}
                        onChange={(val) => setTimezone(val)}
                        ariaLabel={tr('projects:projectModal.timezone')}
                      />
                    </div>
                  </div>

                  {/* Project Date Range (Start Date ~ Target Date) */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 font-semibold text-sub">
                        <Calendar className="h-3.5 w-3.5 text-accent" />
                        <span>计划开始日期</span>
                      </label>
                      <ThemeDatePicker
                        value={startDate}
                        disabled={!isProjectAdmin}
                        onChange={(val) => setStartDate(val || '')}
                        placeholder="选择开始日期 (可选)"
                        ariaLabel="项目计划开始日期"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 font-semibold text-sub">
                        <Target className="h-3.5 w-3.5 text-feature" />
                        <span>目标交付日期</span>
                      </label>
                      <ThemeDatePicker
                        value={targetDate}
                        disabled={!isProjectAdmin}
                        onChange={(val) => setTargetDate(val || '')}
                        placeholder="选择目标交付日 (可选)"
                        ariaLabel="项目目标交付日期"
                      />
                    </div>
                  </div>

                  {/* Color Picker */}
                  <div>
                    <label className="mb-1.5 block font-semibold text-sub">项目主题色 (Project Color)</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {PRESET_PROJECT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            setColor(c);
                            setIsCustomMode(false);
                          }}
                          className="h-7 w-7 rounded-lg transition-transform hover:scale-105 flex items-center justify-center"
                          style={{ backgroundColor: c }}
                        >
                          {color.toLowerCase() === c.toLowerCase() && (
                            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                          )}
                        </button>
                      ))}
                      <label className="flex h-7 items-center gap-1.5 rounded-lg border border-edge bg-canvas px-2.5 text-[11px] font-semibold cursor-pointer">
                        <Pipette className="w-3.5 h-3.5 text-accent" />
                        <span>自定义</span>
                        <input
                          type="color"
                          value={isValidHex(color) ? color : '#3b82f6'}
                          onChange={(e) => {
                            setColor(e.target.value);
                            setIsCustomMode(true);
                          }}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: MEMBERS */}
            {activeTab === 'members' && (
              <ProjectMembersPanel
                project={project}
                users={users}
                currentUser={currentUser}
                localDirectory={localDirectory}
                isProjectAdmin={isProjectAdmin}
                members={members}
                admins={admins}
                defaultAssignee={defaultAssignee}
                guestAccess={guestAccess}
                onMembersChange={(newMembers) => setMembers(newMembers)}
                onAdminsChange={(newAdmins) => setAdmins(newAdmins)}
                onDefaultAssigneeChange={(val) => setDefaultAssignee(val)}
                onGuestAccessChange={(val) => setGuestAccess(val)}
              />
            )}
          </div>
        </div>

        {/* Modal Bottom Footer — Unified with other modals */}
        <div className="flex items-center justify-between border-t border-edge bg-canvas/40 px-6 py-3.5">
          <div className="text-xs text-quiet">
            {isProjectAdmin ? '如需归档或删除项目，请在项目主界面的“更多选项”菜单中操作' : '您当前为只读查看权限'}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-edge bg-surface px-4 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
            >
              取消
            </button>
            {isProjectAdmin && (
              <button
                type="button"
                onClick={handleUpdateProject}
                disabled={isSaving}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-50 shadow-soft"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>保存更改</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
