/**
 * ProjectCreateModal — Streamlined Project Creation Modal.
 *
 * CALLING SPEC:
 *   <ProjectCreateModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     users={User[]}
 *     currentUser={User}
 *     onProjectCreated={(project: Project) => void | Promise<void>}
 *   />
 *
 * Provides a minimal, focused creation dialog with only General fields:
 * - Project Name (required)
 * - Project Identifier (auto-derived, editable)
 * - Description (optional)
 * - Theme Color (presets + custom hex picker)
 * - Visibility ('public' | 'private')
 * - Leader (dropdown of users, default currentUser.id)
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FolderPlus,
  Folder,
  Hash,
  FileText,
  Palette,
  Eye,
  Lock,
  UserCheck,
  Check,
  Pipette,
  Loader2,
  Calendar,
  Target,
} from 'lucide-react';
import { Project, User } from '../types';
import { ApiService } from '../services/api';
import { tr, useLocale } from '../i18n';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { ThemeDatePicker } from './ThemeDatePicker';

const PRESET_PROJECT_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#6366f1', '#06b6d4'];
const isValidHex = (hex: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);
const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
const deriveIdentifier = (name: string) => {
  const latin = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  return latin || 'PRJ';
};

interface ProjectCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  currentUser: User;
  onProjectCreated: (project: Project) => void | Promise<void>;
}

export const ProjectCreateModal: React.FC<ProjectCreateModalProps> = ({
  isOpen,
  onClose,
  users,
  currentUser,
  onProjectCreated,
}) => {
  useLocale();
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [leaderId, setLeaderId] = useState(currentUser.id);
  const [startDate, setStartDate] = useState<string>('');
  const [targetDate, setTargetDate] = useState<string>('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const derivedIdentifier = useMemo(() => deriveIdentifier(name), [name]);

  const leaderOptions: ThemeSelectOption[] = useMemo(
    () =>
      users.map((u) => ({
        value: u.id,
        label: `${u.nickname || u.username} (${u.id === currentUser.id ? tr('projects:projectModal.me') : u.username})`,
      })),
    [users, currentUser.id]
  );

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setIdentifier('');
    setDescription('');
    setColor('#3b82f6');
    setVisibility('public');
    setLeaderId(currentUser.id);
    setStartDate('');
    setTargetDate('');
    setIsCustomMode(false);
    setIsSaving(false);
    setErrorMsg('');
  }, [isOpen, currentUser.id]);

  if (!isOpen) return null;

  const isCustomSelected = isCustomMode || !PRESET_PROJECT_COLORS.includes(color.toLowerCase());

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.trim();
    if (!val.startsWith('#')) val = '#' + val;
    setColor(val);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const trimmedColor = color.trim();
    if (!isValidHex(trimmedColor)) {
      setErrorMsg(tr('projects:projectModal.pleaseEnterAValidHexColorCodeSuch'));
      return;
    }

    setIsSaving(true);
    setErrorMsg('');

    try {
      const finalIdentifier = identifier.trim() || derivedIdentifier;
      const created = await ApiService.createProject(
        {
          name: name.trim(),
          identifier: finalIdentifier,
          description: description.trim(),
          color: trimmedColor,
          createdBy: currentUser.id,
          admins: [currentUser.id, leaderId].filter(Boolean),
          members: [currentUser.id, leaderId].filter(Boolean),
          leadId: leaderId,
          visibility,
          startDate: startDate ? startDate : null,
          targetDate: targetDate ? targetDate : null,
        },
        currentUser.id
      );

      await onProjectCreated(created);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || tr('projects:projectModal.couldNotCreateProject'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-main">
            <FolderPlus className="w-4 h-4 text-accent" />
            <span>{tr('projects:projectModal.newProject')}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main disabled:opacity-50"
            title={tr('projects:projectModal.closeEsc')}
            aria-label={tr('projects:projectModal.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              {errorMsg}
            </div>
          )}

          {/* Project Name */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-semibold text-sub">
              <Folder className="h-3.5 w-3.5 text-accent" />
              <span>{tr('projects:projectModal.projectName')}</span>
              <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr('projects:projectModal.eGQ22026MarketingReview')}
              className="w-full bg-canvas border border-edge rounded-xl px-3.5 py-2.5 text-xs text-main placeholder:text-quiet focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Identifier */}
          <div>
            <label className="mb-1.5 flex items-center justify-between font-semibold text-sub">
              <span className="flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-feature" />
                <span>{tr('projects:projectModal.identifier')}</span>
              </span>
              <span className="text-[10px] text-quiet">
                {tr('projects:projectModal.identifierHint')}
              </span>
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(sanitizeIdentifier(e.target.value))}
              placeholder={derivedIdentifier}
              maxLength={12}
              className="w-full bg-canvas border border-edge rounded-xl px-3.5 py-2 font-mono uppercase text-xs text-main placeholder:text-quiet focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-semibold text-sub">
              <FileText className="h-3.5 w-3.5 text-sub" />
              <span>{tr('projects:projectModal.projectDescription')}</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tr('projects:projectModal.projectGoalsScopeAndDeliverables')}
              rows={2}
              className="w-full bg-canvas border border-edge rounded-xl p-3 text-xs text-main placeholder:text-quiet focus:outline-none focus:border-accent resize-none transition-colors"
            />
          </div>

          {/* Leader Selection */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-semibold text-sub">
              <UserCheck className="h-3.5 w-3.5 text-info" />
              <span>{tr('projects:projectModal.projectLead')}</span>
            </label>
            <ThemeSelect
              portal
              ariaLabel={tr('projects:projectModal.projectLead')}
              value={leaderId}
              options={leaderOptions}
              onChange={(val) => setLeaderId(val)}
            />
          </div>

          {/* Project Schedule (Start Date ~ Target Date) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 font-semibold text-sub">
                <Calendar className="h-3.5 w-3.5 text-accent" />
                <span>计划开始日期</span>
              </label>
              <ThemeDatePicker
                value={startDate}
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
                onChange={(val) => setTargetDate(val || '')}
                placeholder="选择交付日期 (可选)"
                ariaLabel="项目目标交付日期"
              />
            </div>
          </div>

          {/* Visibility */}
          <div>
            <label className="mb-1.5 block font-semibold text-sub">{tr('projects:projectModal.visibility')}</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                  visibility === 'public'
                    ? 'border-accent bg-accent/10 text-main'
                    : 'border-edge bg-canvas hover:border-subtle text-sub'
                }`}
              >
                <Eye className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                <div>
                  <div className="font-semibold text-main">{tr('projects:projectModal.visibilityPublic')}</div>
                  <div className="text-[10px] text-quiet mt-0.5 leading-snug">
                    {tr('projects:projectModal.visibilityPublicHint')}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                  visibility === 'private'
                    ? 'border-accent bg-accent/10 text-main'
                    : 'border-edge bg-canvas hover:border-subtle text-sub'
                }`}
              >
                <Lock className="w-4 h-4 mt-0.5 text-warning shrink-0" />
                <div>
                  <div className="font-semibold text-main">{tr('projects:projectModal.visibilityPrivate')}</div>
                  <div className="text-[10px] text-quiet mt-0.5 leading-snug">
                    {tr('projects:projectModal.visibilityPrivateHint')}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Color Tag Picker */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-semibold text-sub">
              <Palette className="h-3.5 w-3.5 text-feature" />
              <span>{tr('projects:projectModal.projectColor')}</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_PROJECT_COLORS.map((c) => {
                const isSelected = !isCustomMode && color.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setColor(c);
                      setIsCustomMode(false);
                    }}
                    className="relative flex h-7 w-7 items-center justify-center rounded-lg transition-transform hover:scale-105 active:scale-95"
                    style={{ backgroundColor: c }}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                  </button>
                );
              })}

              {/* Custom Color Selector */}
              <label
                className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold cursor-pointer transition-colors ${
                  isCustomSelected
                    ? 'border-accent bg-accent/10 text-main'
                    : 'border-edge bg-canvas hover:border-subtle text-sub'
                }`}
              >
                <Pipette className="w-3.5 h-3.5 text-accent" />
                <span>{tr('projects:projectModal.customMode')}</span>
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

              {isCustomMode && (
                <input
                  type="text"
                  value={color}
                  onChange={handleHexChange}
                  maxLength={7}
                  placeholder="#3B82F6"
                  className="h-7 w-20 rounded-lg border border-edge bg-canvas px-2 font-mono text-[11px] uppercase text-main focus:border-accent focus:outline-none"
                />
              )}
            </div>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-edge">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-edge bg-surface px-4 py-2 text-xs font-semibold text-sub transition-colors hover:bg-hover hover:text-main disabled:opacity-50"
            >
              {tr('projects:projectModal.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-50 shadow-soft"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{tr('projects:projectModal.saving')}</span>
                </>
              ) : (
                <span>{tr('projects:projectModal.createProject')}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
