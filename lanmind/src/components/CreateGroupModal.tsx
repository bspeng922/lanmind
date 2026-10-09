import { currentLocale } from '../i18n/core';
import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
/**
 * CreateGroupModal.tsx — Modal for creating project & LAN collaborative chat groups.
 *
 * CALLING SPEC:
 *   <CreateGroupModal
 *     isOpen={isCreateGroupOpen}
 *     onClose={() => setIsCreateGroupOpen(false)}
 *     currentUser={currentUser}
 *     users={users}
 *     projects={projects}
 *     localDirectory={localDirectory}
 *     canUserCreateGroup={canUserCreateGroup}
 *     onGroupCreated={(newGroup, systemMessage) => handleGroupCreated(newGroup, systemMessage)}
 *   />
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Users,
  FolderKanban,
  Smile,
  FileText,
  Search,
} from 'lucide-react';
import { User, LanChatGroup, LanChatMessage, Project, LocalDirectory } from '../types';
import { ApiService } from '../services/api';
import { isTauri } from '@tauri-apps/api/core';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { ThemeCheckbox } from './ThemeCheckbox';
import { GroupedMemberSelector, SelectableGroup } from './GroupedMemberSelector';

export interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  users: User[];
  projects?: Project[];
  localDirectory?: LocalDirectory;
  canUserCreateGroup: boolean;
  onGroupCreated: (newGroup: LanChatGroup, initialSystemMessage: LanChatMessage) => void;
}

const PRESET_GROUP_ICONS = ['👥', '🚀', '⚡', '💡', '📁', '⚙️', '📦', '🎯', '🔥', '📊'];

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  users = [],
  projects = [],
  localDirectory,
  canUserCreateGroup,
  onGroupCreated,
}) => {
  useLocale();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('👥');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([currentUser.id]);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberSource, setMemberSource] = useState<'people' | 'org'>('people');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const safeLocalDirectory: LocalDirectory = useMemo(() => {
    return localDirectory || { units: [], members: [] };
  }, [localDirectory]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setAvatar('👥');
      setSelectedProjectId('');
      setSelectedMemberIds([currentUser.id]);
      setSearchQuery('');
      setMemberSource('people');
      setIsSubmitting(false);
      setErrorMessage(null);
    }
  }, [isOpen, currentUser.id]);

  // Accessible / creatable projects
  const accessibleProjects = useMemo(() => {
    return (projects || []).filter(
      (project) =>
        project &&
        (project.createdBy === currentUser.id ||
          (Array.isArray(project.admins) && project.admins.includes(currentUser.id)) ||
          (Array.isArray(project.members) && project.members.includes(currentUser.id))),
    );
  }, [projects, currentUser.id]);

  const creatableProjects = useMemo(() => {
    return accessibleProjects.filter(
      (project) =>
        currentUser.role === 'admin' ||
        project.createdBy === currentUser.id ||
        (Array.isArray(project.admins) && project.admins.includes(currentUser.id)),
    );
  }, [accessibleProjects, currentUser.id, currentUser.role]);

  const selectedProject = useMemo(() => {
    return accessibleProjects.find((project) => project.id === selectedProjectId);
  }, [accessibleProjects, selectedProjectId]);

  const selectedProjectMemberIds = useMemo(() => {
    if (!selectedProject) return null;
    return new Set([
      selectedProject.createdBy,
      ...(Array.isArray(selectedProject.admins) ? selectedProject.admins : []),
      ...(Array.isArray(selectedProject.members) ? selectedProject.members : []),
    ]);
  }, [selectedProject]);

  const selectableGroupUsers = useMemo(() => {
    return selectedProjectMemberIds
      ? (users || []).filter((user) => selectedProjectMemberIds.has(user.id))
      : (users || []);
  }, [users, selectedProjectMemberIds]);

  const projectSelectOptions: ThemeSelectOption[] = useMemo(() => [
    { value: '', label: tr("chat:createGroupModal.noAssociatedProjectGeneralGroup"), tone: 'slate' },
    ...creatableProjects.map((project) => ({
      value: project.id,
      label: project.name,
      tone: 'blue' as const,
    })),
  ], [creatableProjects, currentLocale()]);

  const orgSelectableGroups: SelectableGroup[] = useMemo(() => {
    return safeLocalDirectory.units.map((unit) => {
      const directMemberIds = safeLocalDirectory.members
        .filter((m) => m.orgUnitId === unit.id)
        .map((m) => m.userId)
        .filter((id) => selectableGroupUsers.some((u) => u.id === id));
      return {
        id: unit.id,
        name: unit.name,
        parentId: unit.parentId || null,
        icon: <FolderKanban className="w-3.5 h-3.5 text-accent shrink-0" />,
        memberUserIds: directMemberIds,
      };
    });
  }, [safeLocalDirectory.units, safeLocalDirectory.members, selectableGroupUsers]);

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleSelectableGroupUsers = useMemo(() => {
    return selectableGroupUsers.filter((user) => {
      if (!normalizedSearchQuery) return true;
      return [user.nickname, user.username, user.deviceId, user.ip]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery));
    });
  }, [selectableGroupUsers, normalizedSearchQuery]);

  const handleToggleMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const handleSelectAllMembers = () => {
    const selectableIds = selectableGroupUsers.map((user) => user.id);
    if (selectableIds.every((id) => selectedMemberIds.includes(id))) {
      setSelectedMemberIds([currentUser.id]);
    } else {
      setSelectedMemberIds(selectableIds);
    }
  };

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    const project = accessibleProjects.find((item) => item.id === projectId);
    if (!project) return;
    const projectMemberIds = new Set([project.createdBy, ...project.admins, ...project.members]);
    setSelectedMemberIds((current) =>
      Array.from(new Set([currentUser.id, ...current.filter((id) => projectMemberIds.has(id))])),
    );
    if (!name) {
      setName(tr("chat:createGroupModal.project", { value0: project.name }));
      setDescription(project.description || '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUserCreateGroup) {
      setErrorMessage(tr("chat:createGroupModal.onlyGroupCreatorsAndAdministratorsCanCreate"));
      return;
    }
    if (!name.trim()) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const allowedMemberIds = selectedProjectMemberIds;
      const ensuredMemberIds = Array.from(
        new Set([
          currentUser.id,
          ...selectedMemberIds.filter((id) => !allowedMemberIds || allowedMemberIds.has(id)),
        ]),
      );

      const newGroup: LanChatGroup = {
        id: `group-${Date.now()}`,
        name: name.trim(),
        description: description.trim() || tr("chat:createGroupModal.privateLanCollaborationGroup"),
        avatar,
        memberIds: ensuredMemberIds,
        adminIds: [currentUser.id],
        createdBy: currentUser.id,
        createdAt: new Date().toISOString(),
        projectId: selectedProjectId || undefined,
      };

      const savedGroup = isTauri() ? await ApiService.saveChatGroup(newGroup) : newGroup;

      const systemMsg: LanChatMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        groupId: savedGroup.id,
        type: 'text',
        content: tr("chat:createGroupModal.createdTheProjectGroupMembersHaveJoined", { value0: currentUser.nickname, value1: newGroup.name, value2: ensuredMemberIds.length }),
        timestamp: new Date().toISOString(),
      };

      const savedSystemMessage = isTauri() ? await ApiService.sendChatMessage(systemMsg) : systemMsg;
      onGroupCreated(savedGroup, savedSystemMessage);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : tr("chat:createGroupModal.couldNotCreateGroup"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-md p-3 sm:p-5 overflow-hidden animate-in fade-in duration-150">
      <div className="lan-chat-submodal bg-surface border border-subtle rounded-2xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-popover animate-in zoom-in-95 duration-150 overflow-hidden">
        {/* Pinned Header */}
        <div className="flex-shrink-0 flex items-center justify-between border-b border-edge px-5 py-3.5 bg-canvas/40">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-accent/15 text-accent rounded-xl border border-accent/20">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-main">{tr("chat:createGroupModal.createAProjectOrLanGroup")}</h3>
              <p className="text-[11px] text-sub">{tr("chat:createGroupModal.createADedicatedGroupAndChooseLan")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-sub hover:text-main rounded-lg hover:bg-hover transition-colors"
            aria-label={tr("chat:createGroupModal.closeCreateGroupDialog")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          id="create-group-form"
          onSubmit={handleSubmit}
          className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar"
        >
          {errorMessage && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">
              {localizeMessage(errorMessage)}
            </p>
          )}

          {/* Group Name */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
              <Users className="h-3.5 w-3.5 text-info" />
              <span>{tr("chat:createGroupModal.groupName")}<span className="text-danger">*</span></span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr("chat:createGroupModal.eGFrontendAndAiTeam")}
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          {/* Project Association Dropdown */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
              <FolderKanban className="h-3.5 w-3.5 text-accent" />
              <span>{tr("chat:createGroupModal.associatedProjectOptional")}</span>
            </label>
            <ThemeSelect
              ariaLabel={tr("chat:createGroupModal.chooseAnAssociatedProject")}
              value={selectedProjectId}
              options={projectSelectOptions}
              onChange={handleProjectChange}
            />
          </div>

          {/* Group Avatar Picker */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
              <Smile className="h-3.5 w-3.5 text-warning" />
              <span>{tr("chat:createGroupModal.chooseAGroupIcon")}</span>
            </label>
            <div className="flex items-center space-x-2 overflow-x-auto pb-1">
              {PRESET_GROUP_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setAvatar(icon)}
                  className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center border transition-all ${
                    avatar === icon
                      ? 'bg-accent/20 border-accent text-accent scale-105 shadow-soft'
                      : 'bg-canvas border-edge text-sub hover:border-subtle hover:text-main'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* Group Description */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
              <FileText className="h-3.5 w-3.5 text-sub" />
              <span>{tr("chat:createGroupModal.groupPurposeDescription")}</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tr("chat:createGroupModal.eGShareArchitectureDiagramsAndPerformance")}
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          {/* Member Selection List */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-sub">
                <Users className="h-3.5 w-3.5 text-success" />
                <span>{tr("chat:createGroupModal.initialMembers", { value0: selectedMemberIds.length })}</span>
              </label>
              <button
                type="button"
                onClick={handleSelectAllMembers}
                className="btn-select-all text-[11px] text-accent hover:underline font-semibold"
              >
                {selectableGroupUsers.length > 0 && selectableGroupUsers.every((user) => selectedMemberIds.includes(user.id))
                  ? tr("chat:createGroupModal.invertSelection")
                  : tr("chat:createGroupModal.selectAll")}
              </button>
            </div>

            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-sub" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={tr("chat:createGroupModal.searchPeopleToAdd")}
                className="w-full rounded-lg border border-subtle bg-canvas py-1.5 pl-8 pr-3 text-xs text-main outline-none placeholder-quiet focus:border-accent"
                aria-label={tr("chat:createGroupModal.searchInitialMembers")}
              />
            </div>

            <div className="mb-2 flex rounded-lg border border-edge bg-canvas p-0.5" role="tablist" aria-label={tr("chat:createGroupModal.memberSource")}>
              <button
                type="button"
                role="tab"
                aria-selected={memberSource === 'people'}
                onClick={() => setMemberSource('people')}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-all ${
                  memberSource === 'people'
                    ? 'bg-accent text-on-accent shadow-soft'
                    : 'text-sub hover:bg-hover'
                }`}
              >{tr("chat:createGroupModal.people", { value0: visibleSelectableGroupUsers.length })}</button>
              <button
                type="button"
                role="tab"
                aria-selected={memberSource === 'org'}
                onClick={() => setMemberSource('org')}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-all ${
                  memberSource === 'org'
                    ? 'bg-accent text-on-accent shadow-soft'
                    : 'text-sub hover:bg-hover'
                }`}
              >{tr("chat:createGroupModal.localOrganizations", { value0: safeLocalDirectory.units.length })}</button>
            </div>

            {memberSource === 'org' ? (
              <GroupedMemberSelector
                groups={orgSelectableGroups}
                users={selectableGroupUsers}
                selectedUserIds={selectedMemberIds}
                disabledUserIds={[currentUser.id]}
                onToggleUser={(userId) => handleToggleMember(userId)}
                onUpdateSelection={(newIds) => {
                  const finalized = Array.from(new Set([currentUser.id, ...newIds]));
                  setSelectedMemberIds(finalized);
                }}
                searchQuery={searchQuery}
                emptyText={tr("chat:createGroupModal.noMatchingLocalOrganizations")}
                maxHeightClass="max-h-56"
                currentUserId={currentUser.id}
                creatorId={currentUser.id}
              />
            ) : (
              <div className="member-list-box max-h-56 overflow-y-auto space-y-1 bg-canvas/80 border border-edge rounded-xl p-2 custom-scrollbar">
                {visibleSelectableGroupUsers.length === 0 ? (
                  <div className="py-6 text-center text-xs text-quiet">{tr("chat:createGroupModal.noMatchingPeople")}</div>
                ) : (
                  visibleSelectableGroupUsers.map((u) => {
                    const isChecked = selectedMemberIds.includes(u.id);
                    const isSelf = u.id === currentUser.id;

                    return (
                      <div
                        key={u.id}
                        onClick={() => handleToggleMember(u.id)}
                        className="member-item flex items-center justify-between p-2 rounded-lg hover:bg-hover/80 cursor-pointer text-xs transition-colors"
                      >
                        <div className="flex items-center space-x-2">
                          <ThemeCheckbox
                            checked={isChecked}
                            onChange={() => handleToggleMember(u.id)}
                            size="sm"
                            ariaLabel={tr("chat:createGroupModal.selectMember", { value0: u.nickname })}
                          />
                          <span className="member-item-title text-main font-medium">{u.nickname}</span>
                          {isSelf && (
                            <span className="member-item-owner text-[9px] bg-blue-500/20 text-info px-1.5 py-0.5 rounded font-medium">
                              {tr("chat:createGroupModal.meOwner")}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-quiet font-mono">{u.ip || u.id}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </form>

        {/* Pinned Footer */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-3.5 border-t border-edge bg-canvas/40">
          <div className="text-xs text-sub">
            {tr("chat:createGroupModal.selected")}<span className="font-semibold text-accent">{selectedMemberIds.length}</span> {tr("chat:createGroupModal.members")}</div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-4 py-2 rounded-xl text-xs transition-colors"
            >
              {tr("chat:createGroupModal.cancel")}</button>
            <button
              type="submit"
              form="create-group-form"
              disabled={!name.trim() || isSubmitting}
              className="btn-confirm-group theme-btn-primary disabled:opacity-40 font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-soft"
            >
              {isSubmitting ? tr("chat:createGroupModal.creating") : tr("chat:createGroupModal.createGroup")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
