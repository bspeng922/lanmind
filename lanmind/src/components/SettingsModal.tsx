import { ModelProvidersPanel } from './ai/ModelProvidersPanel';
import { AgentSettingsPanel } from './ai/AgentSettingsPanel';
import { ScheduleSettingsPanel } from './ai/ScheduleSettingsPanel';
import { AI, type Catalog } from './ai/aiClient';
import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import React, { useState, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useTheme } from '../context/ThemeContext';
import { LanguageSelect } from './LanguageSelect';
import {
  DESKTOP_CALENDAR_DEFAULT_OPACITY,
  DESKTOP_CALENDAR_MAX_OPACITY,
  DESKTOP_CALENDAR_MIN_OPACITY,
  DESKTOP_CALENDAR_SHOW_COMPLETED_KEY,
  normalizeDesktopCalendarOpacity,
} from '../utils/desktopCalendar';
import {
  X,
  Palette,
  Keyboard,
  Check,
  RotateCcw,
  Settings,
  Sparkles,
  Globe,
  Key,
  Cpu,
  Save,
  Sliders,
  Activity,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  Zap,
  ShieldCheck,
  Server,
  Wifi,
  Copy,
  RefreshCw,
  Eye,
  EyeOff,
  CircleHelp,
  Database,
  Download,
  Monitor,
  Power,
  Upload,
  Calendar,
  ListFilter,
  Bell,
  Volume2,
  Clock,
  Timer,
  Shuffle,
  Bot,
  Trash2,
} from 'lucide-react';
import { generateAccessPassword } from '../utils/accessPassword';
import { AppLockSettings } from './AppLockSettings';
import { WindowCloseSettings } from './WindowCloseSettings';
import { ShortcutItem, DEFAULT_SHORTCUTS } from './ShortcutModal';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { ApiService, McpStatus, WebStatus } from '../services/api';
import { LocalDirectory, Project, User, WeekStartDay, Workspace } from '../types';
import { SettingsImportPanel } from './SettingsImportPanel';
import { SettingsExportPanel } from './SettingsExportPanel';
import { SettingsCleanupPanel } from './SettingsCleanupPanel';
import { getStoredWeekStartDay, setStoredWeekStartDay } from '../utils/calendarGrid';
import { getStoredRestDays, setStoredRestDays } from '../utils/restDays';
import {
  NOTIFICATION_SOUND_TONES,
  NotificationSoundTone,
  getNotificationSoundSettings,
  previewNotificationSound,
  setNotificationSoundSettings,
} from '../utils/notificationSound';
import {
  getNotificationSettings,
  setNotificationSettings,
  MIN_NOTIFICATION_DURATION_SECONDS,
  MAX_NOTIFICATION_DURATION_SECONDS,
  DEFAULT_NOTIFICATION_DURATION_SECONDS,
} from '../utils/notificationSettings';
import {
  AI_ASSISTANT_NAME_MAX_LENGTH,
  getAIAssistantName,
  onAIAssistantNameChange,
  setAIAssistantName,
} from '../utils/aiAssistant';
import { useAppIcon } from '../utils/appIcon';

const NOTIFICATION_TONE_OPTIONS: ThemeSelectOption[] = [
  { value: 'chime', get label() { return tr("settings:settingsModal.chimeDefault"); }, tone: 'amber' },
  { value: 'gentle', get label() { return tr("settings:settingsModal.gentle"); }, tone: 'emerald' },
  { value: 'classic', get label() { return tr("settings:settingsModal.classicBell"); }, tone: 'blue' },
  { value: 'cyber', get label() { return tr("settings:settingsModal.digital"); }, tone: 'rose' },
];

export type SettingsTab =
  | 'basic'
  | 'theme'
  | 'shortcuts'
  | 'llm'
  | 'models'
  | 'skills'
  | 'mcp'
  | 'schedules'
  | 'web'
  | 'mcp_server'
  | 'about'
  | 'imports'
  | 'exports'
  | 'cleanup';

interface SettingsModalProps {
  isOpen: boolean;
  onClose?: () => void;
  shortcuts: ShortcutItem[];
  onSaveShortcuts: (newShortcuts: ShortcutItem[]) => Promise<void>;
  currentUserId: string;
  onTasksImported: () => Promise<void>;
  defaultTab?: SettingsTab;
  embedded?: boolean;
  /** 当前工作区与成员，供工作区设置页使用。 */
  workspace?: Workspace | null;
  users?: User[];
  currentUser?: User | null;
  projects?: Project[];
  onWorkspaceUpdated?: (next: Workspace) => void;
  localDirectory?: LocalDirectory;
  onLocalDirectoryChange?: (dir: LocalDirectory) => void;
}

const McpHelpTooltip: React.FC<{ content: string; align?: 'center' | 'left' }> = ({
  content,
  align = 'center',
}) => {
  useLocale();
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: align === 'left' ? rect.left : rect.left + rect.width / 2,
      top: rect.top,
    });
  };

  useEffect(() => {
    if (!visible) return;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [visible, align]);

  return (
    <span className="mcp-help">
      <button
        ref={triggerRef}
        type="button"
        className="mcp-help-trigger"
        aria-label={content}
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={() => { updatePosition(); setVisible(true); }}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => { updatePosition(); setVisible(true); }}
        onBlur={() => setVisible(false)}
      >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {visible && createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className={`mcp-help-tooltip mcp-help-tooltip-portal ${align === 'left' ? 'mcp-help-tooltip-left' : ''}`}
          style={{ left: position.left, top: position.top }}
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose = () => {},
  shortcuts,
  onSaveShortcuts,
  currentUserId,
  onTasksImported,
  defaultTab = 'basic',
  embedded = false,
  workspace = null,
  users = [],
  currentUser = null,
  projects = [],
  onWorkspaceUpdated,
  localDirectory,
  onLocalDirectoryChange,
}) => {
  useLocale();
  const { currentTheme, themePreference, setThemeId, allThemes } = useTheme();
  const { iconId, setIconTheme, availableIcons } = useAppIcon();
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab === 'llm' ? 'models' : defaultTab);
  const desktopAvailable = isTauri();
  const [aiCatalog, setAiCatalog] = useState<Catalog>({ schemaVersion: 2, connections: [], defaults: {} });

  useEffect(() => {
    if (isOpen || embedded) {
      void AI.call<Catalog>("catalog").then(setAiCatalog).catch(() => {});
    }
  }, [isOpen, embedded]);

  // AI 助手名称：为空表示使用界面文案里的默认名称。
  const defaultAssistantName = tr('settings:settingsModal.defaultAssistantName');
  const [assistantNameDraft, setAssistantNameDraft] = useState<string>(() => getAIAssistantName() ?? '');

  useEffect(() => {
    // 名称可能由其它窗口写入，保持输入框与存储一致。
    const unsubscribe = onAIAssistantNameChange((name) => setAssistantNameDraft(name ?? ''));
    return unsubscribe;
  }, []);

  // Basic settings state
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [autostartError, setAutostartError] = useState('');
  const [showSidebarTaskCounts, setShowSidebarTaskCounts] = useState(() => localStorage.getItem('lanmind_show_sidebar_task_counts') !== 'false');
  const [dataOperation, setDataOperation] = useState<'import' | 'export' | null>(null);
  const [dataResult, setDataResult] = useState<{ success: boolean; message: string } | null>(null);

  // Notification sound settings state
  const [notificationSoundSettings, setNotificationSoundState] = useState(() =>
    getNotificationSoundSettings(),
  );
  const [notificationDurationSettings, setNotificationDurationSettings] = useState(() =>
    getNotificationSettings(),
  );
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [testingNotification, setTestingNotification] = useState(false);
  const [testNotificationResult, setTestNotificationResult] = useState<string | null>(null);
  const [testNotificationFailed, setTestNotificationFailed] = useState(false);

  // Shortcuts state
  const [localShortcuts, setLocalShortcuts] = useState<ShortcutItem[]>(shortcuts);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [shortcutSavedSuccess, setShortcutSavedSuccess] = useState(false);
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [shortcutSaveError, setShortcutSaveError] = useState('');

  const contentAreaRef = useRef<HTMLDivElement>(null);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpPort, setMcpPort] = useState(45992);
  const [mcpTokenVisible, setMcpTokenVisible] = useState(false);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpError, setMcpError] = useState('');
  const [mcpSaved, setMcpSaved] = useState(false);
  const [webStatus, setWebStatus] = useState<WebStatus | null>(null);
  const [webEnabled, setWebEnabled] = useState(false);
  const [webBindAddress, setWebBindAddress] = useState<'0.0.0.0' | '127.0.0.1'>('0.0.0.0');
  const [webPort, setWebPort] = useState(45993);
  const [webPassword, setWebPassword] = useState('');
  const [webReadOnly, setWebReadOnly] = useState(true);
  const [webPasswordVisible, setWebPasswordVisible] = useState(false);
  const [webPasswordLoading, setWebPasswordLoading] = useState(false);
  const [webPasswordCopied, setWebPasswordCopied] = useState(false);
  const webPasswordCopiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const webDirtyRef = useRef(false);
  const webRevisionRef = useRef(0);
  const webSavedPasswordRef = useRef('');
  const markWebChanged = () => { webDirtyRef.current = true; webRevisionRef.current += 1; setWebSaved(false); setWebPasswordCopied(false); };
  const [webSaving, setWebSaving] = useState(false);
  const [webError, setWebError] = useState('');
  const [webSaved, setWebSaved] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // Desktop Calendar & Lunar state
  const [showLunarCalendar, setShowLunarCalendar] = useState<boolean>(() => {
    return localStorage.getItem('lanmind_show_lunar') !== 'false';
  });
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(getStoredWeekStartDay);
  const [restDays, setRestDays] = useState<number[]>(getStoredRestDays);

  const handleSelectWeekStartDay = (value: WeekStartDay) => {
    setWeekStartDay(value);
    setStoredWeekStartDay(value);
  };

  const handleToggleRestDay = (day: number) => {
    const next = restDays.includes(day) ? restDays.filter((item) => item !== day) : [...restDays, day];
    setRestDays(setStoredRestDays(next));
  };
  const [showCompletedDesktopTasks, setShowCompletedDesktopTasks] = useState<boolean>(() => {
    return localStorage.getItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY) !== 'false';
  });
  const [desktopCalOpacity, setDesktopCalOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('lanmind_desktop_cal_opacity');
    return normalizeDesktopCalendarOpacity(saved);
  });

  const handleDesktopCalOpacityChange = (val: number) => {
    const clamped = normalizeDesktopCalendarOpacity(val);
    setDesktopCalOpacity(clamped);
    localStorage.setItem('lanmind_desktop_cal_opacity', String(clamped));
    window.dispatchEvent(new CustomEvent('lanmind-desktop-cal-opacity-change', { detail: clamped }));
    void ApiService.setDesktopCalendarOpacity(clamped);
  };

  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setActiveTab(defaultTab === 'llm' ? 'models' : defaultTab);
      setLocalShortcuts(shortcuts);
      setRecordingId(null);
      setShortcutSaveError('');
      setDataResult(null);
      loadAutostart();
      loadDesktopCalendarConfig();

      loadMcpStatus();
      loadWebStatus();
      setWebPasswordVisible(false);
      setNotificationDurationSettings(getNotificationSettings());
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, defaultTab]);

  useEffect(() => {
    if (!recordingId) {
      setLocalShortcuts(shortcuts);
    }
  }, [shortcuts]);

  useEffect(() => {
    if (!isOpen) return;
    if (!desktopAvailable) {
      setAppVersion(null);
      return;
    }

    let active = true;
    getVersion()
      .then((version) => {
        if (active) setAppVersion(version);
      })
      .catch((error) => {
        console.error('Failed to read application version', error);
        if (active) setAppVersion('unknown');
      });

    return () => {
      active = false;
    };
  }, [isOpen, desktopAvailable]);



  const handleToggleLunarCalendar = () => {
    const next = !showLunarCalendar;
    setShowLunarCalendar(next);
    localStorage.setItem('lanmind_show_lunar', String(next));
    window.dispatchEvent(new CustomEvent('lanmind-lunar-change', { detail: next }));
  };

  const handleToggleShowCompletedDesktopTasks = () => {
    const next = !showCompletedDesktopTasks;
    setShowCompletedDesktopTasks(next);
    localStorage.setItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY, String(next));
    window.dispatchEvent(new CustomEvent('lanmind-desktop-cal-show-completed-change', { detail: next }));
    void ApiService.setDesktopCalendarShowCompleted(next);
  };

  const handleToggleNotificationSound = () => {
    const nextEnabled = !notificationSoundSettings.enabled;
    setNotificationSoundSettings({ enabled: nextEnabled });
    setNotificationSoundState((prev) => ({ ...prev, enabled: nextEnabled }));
  };

  const handleSelectNotificationTone = (tone: NotificationSoundTone) => {
    setNotificationSoundSettings({ tone });
    setNotificationSoundState((prev) => ({ ...prev, tone }));
  };

  const handlePreviewTone = (tone: NotificationSoundTone) => {
    previewNotificationSound(tone);
    setIsPlayingPreview(true);
    setTimeout(() => setIsPlayingPreview(false), 1100);
  };

  const handleToggleAutoDismiss = () => {
    const nextAutoDismiss = !notificationDurationSettings.autoDismiss;
    const updated = setNotificationSettings({ autoDismiss: nextAutoDismiss });
    setNotificationDurationSettings(updated);
  };

  const handleDurationSecondsChange = (seconds: number) => {
    const updated = setNotificationSettings({ durationSeconds: seconds });
    setNotificationDurationSettings(updated);
  };

  const handleSendTestNotification = async () => {
    setTestNotificationFailed(false);
    setTestingNotification(true);
    setTestNotificationResult(null);
    try {
      if (desktopAvailable) {
        await ApiService.showNotificationWindow({
          id: `test:${Date.now()}`,
          kind: 'reminder',
          title: tr("settings:settingsModal.testReminder"),
          body: tr("settings:settingsModal.notificationsAndSoundAreWorkingDueJust"),
          createdAt: new Date().toISOString(),
          themeId: currentTheme.id,
          themePreference,
        });
        setTestNotificationResult(tr("settings:settingsModal.testNotificationSent"));
      } else {
        previewNotificationSound(notificationSoundSettings.tone);
        setTestNotificationResult(tr("settings:settingsModal.testSoundPlayedInTheBrowser"));
      }
    } catch (err) {
      setTestNotificationFailed(true);
      setTestNotificationResult(tr("settings:settingsModal.couldNotSend", { value0: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTestingNotification(false);
      setTimeout(() => setTestNotificationResult(null), 3500);
    }
  };

  const loadAutostart = async () => {
    if (!desktopAvailable) return;
    setAutostartLoading(true);
    setAutostartError('');
    try {
      setAutostartEnabled(await ApiService.getAutostartEnabled());
    } catch (error) {
      setAutostartError(error instanceof Error ? error.message : String(error));
    } finally {
      setAutostartLoading(false);
    }
  };

  const loadDesktopCalendarConfig = async () => {
    if (!desktopAvailable) return;
    try {
      const config = await ApiService.getDesktopCalendarConfig();
      if (typeof config?.showCompleted === 'boolean') {
        setShowCompletedDesktopTasks(config.showCompleted);
        localStorage.setItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY, String(config.showCompleted));
      }
      if (typeof config?.opacity === 'number') {
        const normalized = normalizeDesktopCalendarOpacity(config.opacity);
        setDesktopCalOpacity(normalized);
        localStorage.setItem('lanmind_desktop_cal_opacity', String(normalized));
      }
    } catch (error) {
      console.warn('Failed to load desktop calendar config', error);
    }
  };

  const handleToggleAutostart = async () => {
    if (!desktopAvailable || autostartLoading) return;
    const requested = !autostartEnabled;
    setAutostartLoading(true);
    setAutostartError('');
    try {
      const applied = await ApiService.setAutostartEnabled(requested);
      setAutostartEnabled(applied);
      if (applied !== requested) {
        setAutostartError(tr("settings:settingsModal.couldNotApplyStartupSettingsPleaseTry"));
      }
    } catch (error) {
      setAutostartError(error instanceof Error ? error.message : String(error));
    } finally {
      setAutostartLoading(false);
    }
  };

  const handleToggleSidebarTaskCounts = () => {
    const next = !showSidebarTaskCounts;
    setShowSidebarTaskCounts(next);
    localStorage.setItem('lanmind_show_sidebar_task_counts', String(next));
    window.dispatchEvent(new Event('lanmind-sidebar-counts-change'));
  };

  const handleExportTasks = async () => {
    if (!desktopAvailable || dataOperation) return;
    setDataResult(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const selected = await save({
        title: tr("settings:settingsModal.exportTasks"),
        defaultPath: tr("settings:settingsModal.lanmindTasksJson", { value0: date }),
        filters: [{ name: tr("settings:settingsModal.lanmindTaskData"), extensions: ['json'] }],
      });
      if (!selected) return;
      setDataOperation('export');
      const result = await ApiService.exportTasks(selected, currentUserId);
      setDataResult({
        success: true,
        message: tr("settings:settingsModal.exportedTasksVisibleToYourAccount", { value0: result.exportedCount }),
      });
    } catch (error) {
      setDataResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDataOperation(null);
    }
  };

  const handleImportTasks = async () => {
    if (!desktopAvailable || dataOperation) return;
    setDataResult(null);
    try {
      const selected = await open({
        title: tr("settings:settingsModal.importTasks"),
        multiple: false,
        directory: false,
        filters: [{ name: tr("settings:settingsModal.lanmindTaskData"), extensions: ['json'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      setDataOperation('import');
      const result = await ApiService.importTasks(selected, currentUserId);
      await onTasksImported();
      setDataResult({
        success: true,
        message: tr("settings:settingsModal.importedTasksRestoredSkippedDuplicatesAndConverted", { value0: result.importedCount, value1: result.restoredCount, value2: result.skippedCount, value3: result.convertedCount }),
      });
    } catch (error) {
      setDataResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDataOperation(null);
    }
  };

  const applyMcpStatus = (status: McpStatus) => {
    setMcpStatus(status);
    setMcpEnabled(status.enabled);
    setMcpPort(status.port);
  };

  const loadMcpStatus = async () => {
    try {
      setMcpError('');
      applyMcpStatus(await ApiService.getMcpStatus());
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveMcp = async (customEnabled?: boolean, customPort?: number) => {
    const targetEnabled = customEnabled !== undefined ? customEnabled : mcpEnabled;
    const targetPort = customPort !== undefined ? customPort : mcpPort;
    setMcpSaving(true);
    setMcpError('');
    try {
      applyMcpStatus(await ApiService.updateMcpConfig(targetEnabled, targetPort));
      setMcpSaved(true);
      setTimeout(() => setMcpSaved(false), 1500);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpSaving(false);
    }
  };

  const handleToggleMcp = async (nextEnabled: boolean) => {
    setMcpEnabled(nextEnabled);
    await handleSaveMcp(nextEnabled, mcpPort);
  };

  const handlePortBlur = async () => {
    if (Number.isInteger(mcpPort) && mcpPort >= 1024 && mcpPort <= 65535 && mcpPort !== mcpStatus?.port) {
      await handleSaveMcp(mcpEnabled, mcpPort);
    }
  };

  const handleRotateMcpToken = async () => {
    setMcpSaving(true);
    setMcpError('');
    try {
      applyMcpStatus(await ApiService.rotateMcpToken());
      setMcpTokenVisible(true);
      setMcpSaved(true);
      setTimeout(() => setMcpSaved(false), 1500);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpSaving(false);
    }
  };

  const applyWebStatus = (status: WebStatus) => {
    setWebStatus(status);
    setWebEnabled(status.enabled);
    setWebBindAddress(status.bindAddress);
    setWebPort(status.port);
    setWebReadOnly(status.readOnly);
    setWebPassword('');
    webSavedPasswordRef.current = '';
  };

  const loadWebStatus = async () => {
    if (!desktopAvailable) return;
    try {
      setWebError('');
      const status = await ApiService.getWebStatus();
      if (webDirtyRef.current) setWebStatus(status);
      else applyWebStatus(status);
    } catch (error) {
      setWebError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveWeb = async (enabled = webEnabled) => {
    if (webSaving || !webDirtyRef.current) return;
    if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) { setWebError(tr("settings:settingsModal.portMustBeBetween1024And65535")); return; }
    if (webPassword && webPassword.trim().length < 8) { setWebError(tr("settings:settingsModal.accessPasswordMustContainAtLeast8")); return; }
    if (enabled && !webStatus?.passwordConfigured && webPassword.trim().length < 8) {
      setWebError(tr("settings:settingsModal.setAnAccessPasswordOfAtLeast"));
      return;
    }
    setWebSaving(true);
    const revision = webRevisionRef.current;
    webDirtyRef.current = false;
    setWebError('');
    try {
      const status = await ApiService.updateWebConfig({
        enabled,
        bindAddress: webBindAddress,
        port: webPort,
        readOnly: webReadOnly,
        ...(webPassword.trim() && webPassword !== webSavedPasswordRef.current ? { password: webPassword } : {}),
      });
      setWebStatus(status);
      webSavedPasswordRef.current = webPassword;
      if (revision === webRevisionRef.current) { setWebSaved(true); }
      setTimeout(() => setWebSaved(false), 1800);
    } catch (error) {
      setWebError(error instanceof Error ? error.message : String(error));
    } finally {
      setWebSaving(false);
    }
  };

  const readWebPassword = async (): Promise<string | undefined> => {
    if (webPassword) return webPassword;
    if (!webStatus?.passwordConfigured) return undefined;
    const revision = webRevisionRef.current;
    setWebPasswordLoading(true);
    try {
      const password = await ApiService.getWebPassword();
      if (revision !== webRevisionRef.current || !prevIsOpenRef.current) return;
      if (password === null) {
        setWebError(tr("settings:settingsModal.theOldPasswordWasStoredOnlyAs"));
        return;
      }
      webSavedPasswordRef.current = password;
      setWebPassword(password);
      setWebError('');
      return password;
    } catch (error) {
      setWebError(error instanceof Error ? error.message : String(error));
    } finally { setWebPasswordLoading(false); }
  };

  const toggleWebPassword = async () => {
    if (webPasswordVisible) { setWebPasswordVisible(false); return; }
    if (!webStatus?.passwordConfigured && !webPassword) { setWebPasswordVisible(true); return; }
    const password = await readWebPassword();
    if (password !== undefined) setWebPasswordVisible(true);
  };

  const copyWebPassword = async () => {
    const revision = webRevisionRef.current;
    setWebPasswordCopied(false);
    const password = await readWebPassword();
    if (password === undefined || revision !== webRevisionRef.current || !prevIsOpenRef.current) return;
    try {
      await navigator.clipboard.writeText(password);
      if (revision !== webRevisionRef.current || !prevIsOpenRef.current) return;
      setWebError(''); setWebPasswordCopied(true);
      clearTimeout(webPasswordCopiedTimer.current);
      webPasswordCopiedTimer.current = setTimeout(() => setWebPasswordCopied(false), 1800);
    } catch {
      setWebError(tr("settings:settingsModal.couldNotCopyThePasswordRetryOr"));
    }
  };

  useEffect(() => () => clearTimeout(webPasswordCopiedTimer.current), []);

  useEffect(() => {
    if (!webDirtyRef.current || !webStatus || webSaving) return;
    const timer = window.setTimeout(() => void handleSaveWeb(), 650);
    return () => window.clearTimeout(timer);
  }, [webEnabled, webBindAddress, webPort, webPassword, webReadOnly, webSaving, webStatus]);

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const saveShortcutsList = async (list: ShortcutItem[]) => {
    setShortcutSaving(true);
    setShortcutSaveError('');
    try {
      await onSaveShortcuts(list);
      setShortcutSavedSuccess(true);
      setTimeout(() => {
        setShortcutSavedSuccess(false);
      }, 1500);
    } catch (error) {
      setShortcutSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setShortcutSaving(false);
    }
  };

  // Key combo recorder listener for shortcuts
  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      return;
    }

    const ctrlKey = e.ctrlKey || e.metaKey;
    const altKey = e.altKey;
    const shiftKey = e.shiftKey;
    const code = e.code;

    const parts: string[] = [];
    if (ctrlKey) parts.push('Ctrl');
    if (altKey) parts.push('Alt');
    if (shiftKey) parts.push('Shift');

    let keyDisplay = e.key.toUpperCase();
    if (code === 'Space') keyDisplay = 'Space';
    else if (code.startsWith('Key')) keyDisplay = code.replace('Key', '');
    else if (code.startsWith('Digit')) keyDisplay = code.replace('Digit', '');
    else if (code.startsWith('Numpad')) keyDisplay = code.replace('Numpad', 'Num');
    else if (keyDisplay === 'PROCESS' || keyDisplay === 'UNIDENTIFIED') {
      if (code.startsWith('Key')) keyDisplay = code.replace('Key', '');
      else if (code.startsWith('Digit')) keyDisplay = code.replace('Digit', '');
      else keyDisplay = code;
    }

    parts.push(keyDisplay);
    const keyLabel = parts.join(' + ');

    const updated = localShortcuts.map((item) =>
      item.id === id
        ? {
            ...item,
            ctrlKey,
            altKey,
            shiftKey,
            code,
            keyLabel,
          }
        : item
    );
    setLocalShortcuts(updated);
    setRecordingId(null);
    void saveShortcutsList(updated);
  };

  const handleResetDefaults = () => {
    setLocalShortcuts(DEFAULT_SHORTCUTS);
    void saveShortcutsList(DEFAULT_SHORTCUTS);
  };

  const handleClose = () => {
    onClose();
  };

  if (!isOpen && !embedded) return null;

  /**
   * 左侧导航按信息架构分组：常规 / 工作区 / AI / 集成 / 关于。
   * 分组只影响呈现层，每个 tab 的身份与内容保持不变。
   */
  const menuGroups: { id: string; label: string; items: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] }[] = [
    {
      id: 'general',
      label: tr('settings:settingsModal.groupGeneral'),
      items: [
        { id: 'basic', label: tr('settings:settingsModal.general'), icon: Settings },
        { id: 'theme', label: tr('settings:settingsModal.appearance'), icon: Palette },
        { id: 'shortcuts', label: tr('settings:settingsModal.keyboardShortcuts'), icon: Keyboard },
      ],
    },
    {
      id: 'data',
      label: '数据管理',
      items: [
        { id: 'imports', label: '数据导入', icon: Upload },
        { id: 'exports', label: '数据导出', icon: Download },
        { id: 'cleanup', label: '数据清理', icon: Trash2 },
      ],
    },
    {
      id: 'ai',
      label: tr('settings:settingsModal.groupAi'),
      items: [
        { id: 'models', label: '模型供应商', icon: Sparkles },
        { id: 'skills', label: 'Skills', icon: Bot },
        { id: 'mcp', label: 'MCP', icon: Cpu },
        { id: 'schedules', label: '定时任务', icon: Clock },
      ],
    },
    {
      id: 'integration',
      label: tr('settings:settingsModal.groupIntegration'),
      items: [
        { id: 'web', label: tr('settings:settingsModal.webAccess'), icon: Globe },
        { id: 'mcp_server', label: tr('settings:settingsModal.mcpServer'), icon: Server },
      ],
    },
    {
      id: 'about',
      label: tr('settings:settingsModal.groupAbout'),
      items: [{ id: 'about', label: tr('settings:settingsModal.about'), icon: Info }],
    },
  ];

  /** 页面标题与说明：由当前分类决定，弹窗路径下不渲染。 */
  const activeMeta: { title: string; description: string } = (() => {
    switch (activeTab) {
      case 'theme':
        return { title: tr('settings:settingsModal.appearance'), description: tr('settings:settingsModal.chooseAThemeChangesApplyImmediatelyAnd') };
      case 'shortcuts':
        return { title: tr('settings:settingsModal.keyboardShortcuts'), description: tr('settings:settingsModal.globalKeyboardShortcutDescription') };
      case 'imports':
        return { title: '数据导入', description: '将外部任务、项目与工作项导入至 LanMind' };
      case 'exports':
        return { title: '数据导出', description: '将您的项目数据导出为多种格式，并查看导出历史与下载记录' };
      case 'cleanup':
        return { title: '数据清理', description: '安全清理本地数据库与缓存中的历史数据（任务、Wiki、聊天记录与AI对话）' };
      case 'models':
      case 'llm':
        return { title: '模型供应商', description: '配置本地与云端模型供应商连接、测试可用性及上游模型发现' };
      case 'skills':
        return { title: 'Skills 技能', description: '管理 AI 助手可用技能与专业能力扩展' };
      case 'mcp':
        return { title: 'MCP 扩展', description: '配置外部 MCP 工具服务，让 AI 助手调用外部工具与数据源' };
      case 'schedules':
        return { title: '定时任务', description: '配置周期性执行的 AI 问答分析、HTTP 接口调用或自动化脚本' };
      case 'web':
        return { title: tr('settings:settingsModal.webAccess'), description: tr('settings:settingsModal.accessTheLocalUserSTasksAnd') };
      case 'mcp_server':
        return { title: tr('settings:settingsModal.mcpServer'), description: tr('settings:settingsModal.allowTrustedLanModelsAndAgentsTo2') };
      case 'about':
        return { title: tr('settings:settingsModal.about'), description: tr('settings:settingsModal.applicationInformationAndFeatures') };
      default:
        return { title: tr('settings:settingsModal.general'), description: tr('settings:settingsModal.manageStartupWindowBehaviorAndTaskData') };
    }
  })();

  const navList = (
    <nav
      aria-label={tr('settings:settingsModal.settingsCategories')}
      className="settings-navigation shrink-0 overflow-y-auto border-r border-edge bg-canvas/60 px-2 py-3 select-none"
    >
      {menuGroups.map((group) => (
        <div key={group.id} className="mb-2 last:mb-0">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-quiet">{group.label}</div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition-colors ${
                    isActive ? 'bg-accent/15 text-accent' : 'text-sub hover:bg-hover hover:text-main'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const contentShell = (content: React.ReactNode) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <div ref={contentAreaRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {content}
      </div>
      {/* Bottom Footer Action Bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge bg-surface px-6 py-2.5 text-xs">
        {activeTab === 'shortcuts' ? (
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 rounded-lg border border-subtle bg-surface px-3 py-1.5 text-sub transition-colors hover:bg-hover hover:text-main"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{tr("settings:settingsModal.restoreDefaultShortcuts")}</span>
          </button>
        ) : activeTab === 'theme' ? (
          <div className="text-[11px] text-sub">
            {tr("settings:settingsModal.currentTheme")}<span className="font-bold text-main">{currentTheme.name}</span>
            {themePreference === 'system' && <span>{tr("settings:settingsModal.followSystem2")}</span>}
          </div>
        ) : activeTab === 'imports' || activeTab === 'exports' || activeTab === 'cleanup' ? (
          <div className="flex items-center gap-1.5 text-[11px] text-sub">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span>数据在本地安全解析与存储，绝不泄露给外部第三方</span>
          </div>
        ) : activeTab === 'mcp_server' || activeTab === 'web' ? (
          <div className="text-[11px] text-sub">{tr("settings:settingsModal.changesApplyImmediatelyAndPersistAcrossRestarts")}</div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-sub">
            <span className="h-2 w-2 rounded-full bg-success" />
            <span>{tr("settings:settingsModal.lanmind2")}</span>
          </div>
        )}
      </div>
    </div>
  );

  const settingsContent = <>
                {activeTab === 'basic' && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-bold text-main">
                        <Settings className="h-4 w-4 text-info" /> {tr("settings:settingsModal.general")}</h3>
                      <p className="mt-1 text-xs text-sub">
                        {tr("settings:settingsModal.manageStartupWindowBehaviorAndTaskData")}</p>
                    </div>

                    <section aria-labelledby="general-settings-heading" className="general-settings space-y-3">
                      <div>
                        <h4 id="general-settings-heading" className="flex items-center gap-2 text-xs font-bold text-main">
                          <Power className="h-3.5 w-3.5 text-success" /> {tr("settings:settingsModal.general2")}</h4>
                      </div>

                      <div className="settings-language-row flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-main">{tr('settings:language.label')}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">{tr('settings:language.description')}</p>
                        </div>
                        <LanguageSelect />
                      </div>
                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-main">{tr("settings:settingsModal.launchAtStartup")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">
                            {tr("settings:settingsModal.startLanmindInTheTrayWhenYou")}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={autostartEnabled}
                          aria-label={tr("settings:settingsModal.launchAtStartup")}
                          disabled={!desktopAvailable || autostartLoading}
                          onClick={handleToggleAutostart}
                          className="ui-switch"
                          data-state={autostartEnabled ? 'checked' : 'unchecked'}
                        >
                          <span className="ui-switch-thumb">
                            {autostartLoading && <Loader2 className="h-3 w-3 animate-spin text-quiet" />}
                          </span>
                        </button>
                      </div>
                      {!desktopAvailable && (
                        <p className="text-[11px] text-quiet">{tr("settings:settingsModal.startupIsOnlyAvailableInTheDesktop")}</p>
                      )}
                      {autostartError && (
                        <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
                          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>{localizeMessage(autostartError)}</span>
                        </div>
                      )}

                      <WindowCloseSettings available={desktopAvailable} />

                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-main flex items-center gap-1.5">
                            <ListFilter className="h-3.5 w-3.5 text-info" />
                            {tr("settings:settingsModal.showUnfinishedTaskCounts")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">{tr("settings:settingsModal.showCountsBesideTaskViewsAndProjects")}</p>
                        </div>
                        <button type="button" role="switch" aria-checked={showSidebarTaskCounts} aria-label={tr("settings:settingsModal.showUnfinishedTaskCounts")} onClick={handleToggleSidebarTaskCounts} className="ui-switch" data-state={showSidebarTaskCounts ? 'checked' : 'unchecked'}>
                          <span className="ui-switch-thumb" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-main flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-success" />
                            {tr("settings:settingsModal.showLunarDatesAndSolarTerms")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">
                            {tr("settings:settingsModal.showLunarDatesSolarTermsAndTraditional")}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={showLunarCalendar}
                          aria-label={tr("settings:settingsModal.showLunarDatesAndSolarTerms")}
                          onClick={handleToggleLunarCalendar}
                          className="ui-switch"
                          data-state={showLunarCalendar ? 'checked' : 'unchecked'}
                        >
                          <span className="ui-switch-thumb" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-main flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-info" />
                            {tr("settings:settingsModal.firstDayOfWeek")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">
                            {tr("settings:settingsModal.applyToCalendarsAndDatePickers")}</p>
                        </div>
                        <div className="flex items-center rounded-lg border border-edge bg-surface p-1">
                          <button
                            type="button"
                            onClick={() => handleSelectWeekStartDay('monday')}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                              weekStartDay === 'monday'
                                ? `${currentTheme.primaryButton} text-main shadow-soft`
                                : 'text-sub hover:text-main'
                            }`}
                          >
                            {tr("settings:settingsModal.mondayRecommended")}</button>
                          <button
                            type="button"
                            onClick={() => handleSelectWeekStartDay('sunday')}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                              weekStartDay === 'sunday'
                                ? `${currentTheme.primaryButton} text-main shadow-soft`
                                : 'text-sub hover:text-main'
                            }`}
                          >
                            {tr("settings:settingsModal.sunday")}</button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="mb-3">
                          <div className="text-xs font-bold text-main">{tr("settings:settingsModal.restDays")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">{tr("settings:settingsModal.markRestDaysInCalendarsTimelinesAnd")}</p>
                        </div>
                        <div className="grid grid-cols-7 gap-1.5">
                          {[[tr("settings:settingsModal.mon"), 1], [tr("settings:settingsModal.tue"), 2], [tr("settings:settingsModal.wed"), 3], [tr("settings:settingsModal.thu"), 4], [tr("settings:settingsModal.fri"), 5], [tr("settings:settingsModal.sat"), 6], [tr("settings:settingsModal.sun"), 7]].map(([label, value]) => {
                            const day = value as number;
                            const selected = restDays.includes(day);
                            return <button key={day} type="button" aria-pressed={selected} onClick={() => handleToggleRestDay(day)} className={`rounded-md border py-2 text-[11px] font-semibold transition-colors ${selected ? 'border-warning/50 bg-warning/10 text-warning' : 'border-subtle bg-surface text-sub hover:bg-hover hover:text-main'}`}>{label}</button>;
                          })}
                        </div>
                      </div>

                      <AppLockSettings />
                    </section>

                    <section aria-labelledby="notification-sound-settings-heading" className="space-y-3">
                      <div>
                        <h4
                          id="notification-sound-settings-heading"
                          className="flex items-center gap-2 text-xs font-bold text-main"
                        >
                          <Bell className="h-3.5 w-3.5 text-warning" /> {tr("settings:settingsModal.notificationsAndSound")}</h4>
                      </div>

                      {/* Switch row */}
                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-main flex items-center gap-1.5">
                            <Volume2 className="h-3.5 w-3.5 text-warning" />
                            {tr("settings:settingsModal.enableNotificationSound")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">
                            {tr("settings:settingsModal.playASoundForTaskRemindersAnd")}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={notificationSoundSettings.enabled}
                          aria-label={tr("settings:settingsModal.enableNotificationSound")}
                          onClick={handleToggleNotificationSound}
                          className="ui-switch"
                          data-state={notificationSoundSettings.enabled ? 'checked' : 'unchecked'}
                        >
                          <span className="ui-switch-thumb" />
                        </button>
                      </div>

                      {/* Tone selection & audition row */}
                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-main">{tr("settings:settingsModal.notificationSound")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">
                            {tr("settings:settingsModal.chooseAndPreviewANotificationSound")}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <ThemeSelect
                            ariaLabel={tr("settings:settingsModal.chooseNotificationSound")}
                            value={notificationSoundSettings.tone}
                            options={NOTIFICATION_TONE_OPTIONS}
                            onChange={(val) =>
                              handleSelectNotificationTone(val as NotificationSoundTone)
                            }
                            disabled={!notificationSoundSettings.enabled}
                            width="168px"
                          />
                          <button
                            type="button"
                            onClick={() => handlePreviewTone(notificationSoundSettings.tone)}
                            disabled={!notificationSoundSettings.enabled}
                            className={`theme-btn-secondary relative flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                              isPlayingPreview
                                ? 'border-warning/70 text-warning bg-warning/10 shadow-soft'
                                : ''
                            }`}
                            title={tr("settings:settingsModal.previewSound")}
                            aria-label={tr("settings:settingsModal.previewSound")}
                          >
                            {isPlayingPreview && (
                              <svg
                                className="absolute inset-0 h-full w-full pointer-events-none animate-audio-arc text-warning"
                                viewBox="0 0 32 32"
                                fill="none"
                              >
                                <circle
                                  cx="16"
                                  cy="16"
                                  r="13"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeDasharray="26 56"
                                />
                              </svg>
                            )}
                            <Volume2
                              className={`h-4 w-4 transition-transform duration-200 ${
                                isPlayingPreview ? 'text-warning scale-105' : 'text-sub'
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {/* Auto-dismiss switch row */}
                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-main flex items-center gap-1.5">
                            <Timer className="h-3.5 w-3.5 text-warning" />
                            {tr("settings:settingsModal.automaticallyCloseNotifications")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">
                            {tr("settings:settingsModal.closeNotificationsWhenTheTimerEndsOtherwise")}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={notificationDurationSettings.autoDismiss}
                          aria-label={tr("settings:settingsModal.automaticallyCloseNotifications")}
                          onClick={handleToggleAutoDismiss}
                          className="ui-switch"
                          data-state={notificationDurationSettings.autoDismiss ? 'checked' : 'unchecked'}
                        >
                          <span className="ui-switch-thumb" />
                        </button>
                      </div>

                      {/* Notification countdown duration slider & presets row */}
                      <div
                        className={`rounded-xl border border-edge bg-canvas/60 p-4 space-y-3 transition-opacity ${
                          notificationDurationSettings.autoDismiss ? 'opacity-100' : 'opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-main flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-warning" />
                              {tr("settings:settingsModal.autoCloseDuration")}</span>
                            <span className="mt-0.5 block text-[11px] text-sub">
                              {notificationDurationSettings.autoDismiss
                                ? tr("settings:settingsModal.showFor330SecondsHoverTo")
                                : tr("settings:settingsModal.notificationsStayOpenUntilYouCloseThem")}
                            </span>
                          </div>
                          <span className="font-mono text-xs font-bold text-warning">
                            {notificationDurationSettings.autoDismiss
                              ? tr("settings:settingsModal.seconds", { value0: notificationDurationSettings.durationSeconds })
                              : tr("settings:settingsModal.keepOpen")}
                          </span>
                        </div>

                        {/* Slider & Accurate Track Ruler */}
                        <div className="relative pt-1">
                          <input
                            type="range"
                            min={MIN_NOTIFICATION_DURATION_SECONDS}
                            max={MAX_NOTIFICATION_DURATION_SECONDS}
                            step="1"
                            disabled={!notificationDurationSettings.autoDismiss}
                            value={notificationDurationSettings.durationSeconds}
                            onChange={(e) => handleDurationSecondsChange(Number(e.target.value))}
                            className="w-full h-1.5 bg-card rounded-lg appearance-none cursor-pointer accent-[var(--warning)] disabled:cursor-not-allowed disabled:opacity-40"
                          />

                          {/* Precise scale ruler directly below the slider track */}
                          <div className="relative mt-1 h-4 text-[10px] text-quiet font-mono select-none">
                            <span className="absolute left-0">{tr("settings:settingsModal.3s")}</span>
                            <span
                              className="absolute -translate-x-1/2 text-center"
                              style={{
                                left: `${
                                  ((DEFAULT_NOTIFICATION_DURATION_SECONDS - MIN_NOTIFICATION_DURATION_SECONDS) /
                                    (MAX_NOTIFICATION_DURATION_SECONDS - MIN_NOTIFICATION_DURATION_SECONDS)) *
                                  100
                                }%`,
                              }}
                            >
                              {tr("settings:settingsModal.10s")}<span className="text-[9px] opacity-75">{tr("settings:settingsModal.default")}</span>
                            </span>
                            <span
                              className="absolute -translate-x-1/2 text-center"
                              style={{
                                left: `${
                                  ((20 - MIN_NOTIFICATION_DURATION_SECONDS) /
                                    (MAX_NOTIFICATION_DURATION_SECONDS - MIN_NOTIFICATION_DURATION_SECONDS)) *
                                  100
                                }%`,
                              }}
                            >
                              {tr("settings:settingsModal.20s")}</span>
                            <span className="absolute right-0 text-right">{tr("settings:settingsModal.30s")}</span>
                          </div>
                        </div>

                        {/* Quick Preset Buttons Row */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[10px] text-sub mr-1">{tr("settings:settingsModal.quickOptions")}</span>
                          {[3, 5, 10, 15, 20, 30].map((sec) => {
                            const isSelected =
                              notificationDurationSettings.autoDismiss &&
                              notificationDurationSettings.durationSeconds === sec;
                            const isDefault = sec === DEFAULT_NOTIFICATION_DURATION_SECONDS;
                            return (
                              <button
                                key={sec}
                                type="button"
                                disabled={!notificationDurationSettings.autoDismiss}
                                onClick={() => handleDurationSecondsChange(sec)}
                                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all border ${
                                  isSelected
                                    ? 'border-warning/50 bg-warning/15 font-bold text-warning'
                                    : 'bg-surface/80 border-edge text-sub hover:text-main hover:border-subtle disabled:opacity-50'
                                }`}
                              >{tr("settings:settingsModal.s", { value0: sec, value1: isDefault ? tr('common:labels.defaultSuffix') : '' })}</button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Test notification row */}
                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-main flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-warning" />
                            {tr("settings:settingsModal.testNotification")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">
                            {tr("settings:settingsModal.sendATestNotificationToTheBottom")}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            disabled={testingNotification}
                            onClick={handleSendTestNotification}
                            className="theme-btn-secondary px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-all"
                            title={tr("settings:settingsModal.sendTestNotification")}
                          >
                            {testingNotification ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Bell className="h-3.5 w-3.5 text-warning" />
                            )}
                            <span>{testingNotification ? tr("settings:settingsModal.sending") : tr("settings:settingsModal.sendTest")}</span>
                          </button>
                        </div>
                      </div>
                      {testNotificationResult && (
                        <div
                          className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                            testNotificationFailed
                              ? 'border-danger/40 bg-danger/10 text-danger'
                              : 'border-success/40 bg-success/10 text-success'
                          }`}
                        >
                          {testNotificationFailed ? (
                            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          ) : (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          )}
                          <span>{localizeMessage(testNotificationResult)}</span>
                        </div>
                      )}
                    </section>

                    <section aria-labelledby="desktop-calendar-settings-heading" className="space-y-3">
                      <div>
                        <h4 id="desktop-calendar-settings-heading" className="flex items-center gap-2 text-xs font-bold text-main">
                          <Monitor className="h-3.5 w-3.5 text-info" /> {tr("settings:settingsModal.desktopCalendar")}</h4>
                      </div>

                      <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-main flex items-center gap-1.5">
                            <Eye className="h-3.5 w-3.5 text-info" />
                            {tr("settings:settingsModal.showCompletedTasks")}</div>
                          <p className="mt-1 text-[11px] leading-5 text-sub">
                            {tr("settings:settingsModal.showCompletedTasksAfterUnfinishedTasksWith")}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={showCompletedDesktopTasks}
                          aria-label={tr("settings:settingsModal.showCompletedTasksInDesktopCalendar")}
                          onClick={handleToggleShowCompletedDesktopTasks}
                          className="ui-switch"
                          data-state={showCompletedDesktopTasks ? 'checked' : 'unchecked'}
                        >
                          <span className="ui-switch-thumb" />
                        </button>
                      </div>

                      <div className="rounded-xl border border-edge bg-canvas/60 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="block text-xs font-bold text-main">{tr("settings:settingsModal.desktopCalendarBackgroundOpacity")}</span>
                            <span className="mt-0.5 block text-[11px] text-sub">
                              {tr("settings:settingsModal.adjustTheBackgroundOnly0IsFully")}</span>
                          </div>
                          <span className="font-mono text-xs font-bold text-info">{desktopCalOpacity}%</span>
                        </div>
                        <input
                          type="range"
                          min={DESKTOP_CALENDAR_MIN_OPACITY}
                          max={DESKTOP_CALENDAR_MAX_OPACITY}
                          step="1"
                          value={desktopCalOpacity}
                          onChange={(e) => handleDesktopCalOpacityChange(Number(e.target.value))}
                          className="w-full h-1.5 bg-card rounded-lg appearance-none cursor-pointer accent-[var(--info)]"
                        />
                        <div className="flex items-center justify-between gap-2 text-[10px] text-quiet font-mono">
                          <button
                            type="button"
                            onClick={() => handleDesktopCalOpacityChange(0)}
                            className={`transition-colors ${desktopCalOpacity === 0 ? 'text-info font-bold' : 'hover:text-sub'}`}
                          >
                            {tr("settings:settingsModal.0TransparentDefault")}</button>
                          <button
                            type="button"
                            onClick={() => handleDesktopCalOpacityChange(30)}
                            className={`transition-colors ${desktopCalOpacity === 30 ? 'text-info font-bold' : 'hover:text-sub'}`}
                          >
                            {tr("settings:settingsModal.30")}</button>
                          <button
                            type="button"
                            onClick={() => handleDesktopCalOpacityChange(60)}
                            className={`transition-colors ${desktopCalOpacity === 60 ? 'text-info font-bold' : 'hover:text-sub'}`}
                          >
                            {tr("settings:settingsModal.60")}</button>
                          <button
                            type="button"
                            onClick={() => handleDesktopCalOpacityChange(90)}
                            className={`transition-colors ${desktopCalOpacity === 90 ? 'text-info font-bold' : 'hover:text-sub'}`}
                          >{tr("settings:settingsModal.darkBackground", { value0: DESKTOP_CALENDAR_MAX_OPACITY })}</button>
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {/* Tab 2: Theme Settings */}
                {activeTab === 'theme' && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-main flex items-center gap-2">
                        <Palette className="w-4 h-4 text-feature" /> {tr("settings:settingsModal.appearance")}</h3>
                      <p className="text-xs text-sub mt-1">
                        {tr("settings:settingsModal.chooseAThemeChangesApplyImmediatelyAnd")}</p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={themePreference === 'system'}
                      onClick={() => setThemeId(themePreference === 'system' ? currentTheme.id : 'system')}
                      className="flex w-full items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4 text-left transition-colors hover:border-subtle hover:bg-hover/50"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                          <Monitor className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-bold text-main">{tr("settings:settingsModal.followSystem")}</span>
                          <span className="mt-1 block text-[11px] leading-4 text-sub">
                            {tr("settings:settingsModal.useTitaniumLightInLightModeAnd")}</span>
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="ui-switch"
                        data-state={themePreference === 'system' ? 'checked' : 'unchecked'}
                      >
                        <span className="ui-switch-thumb" />
                      </span>
                    </button>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {allThemes.map((theme) => {
                        const isSelected = themePreference === theme.id;
                        // 预览色块展示的是该主题自身的强调色，属于数据驱动的样式；缺省时回落到当前主题的强调色。
                        const accentColor = theme.accentColor || 'var(--accent)';
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            onClick={() => setThemeId(theme.id)}
                            style={isSelected ? { borderColor: accentColor, boxShadow: `0 8px 24px color-mix(in srgb, ${accentColor} 15%, transparent)` } : undefined}
                            className={`p-3.5 rounded-xl border text-left transition-all duration-200 relative group flex flex-col justify-between ${
                              isSelected
                                ? 'bg-card/90 ring-1'
                                : 'bg-canvas/60 border-edge hover:border-subtle hover:bg-hover/50'
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center space-x-2.5">
                                  <div
                                    className="w-4 h-4 rounded-full shadow-inner flex-shrink-0 border border-subtle"
                                    style={{ background: theme.previewColor }}
                                  />
                                  <span className="text-xs font-bold text-main group-hover:text-info transition-colors">
                                    {theme.name}
                                  </span>
                                </div>

                                {isSelected && (
                                  <span
                                    className="w-4 h-4 rounded-full text-main flex items-center justify-center text-[10px] shadow-panel"
                                    style={{ backgroundColor: accentColor }}
                                  >
                                    <Check className="w-2.5 h-2.5" />
                                  </span>
                                )}
                              </div>

                              <p className="text-[11px] text-sub line-clamp-2 leading-relaxed">
                                {theme.description}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* App Icon Customization */}
                    <div className="pt-4 border-t border-edge">
                      <div className="mb-3">
                        <h4 className="text-xs font-bold text-main flex items-center gap-2">
                          <Zap className="w-3.5 h-3.5 text-info" />
                          {tr("settings:appIcon.title")}
                        </h4>
                        <p className="text-[11px] text-sub mt-0.5">
                          {tr("settings:appIcon.description")}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2.5">
                        {availableIcons.map((icon) => {
                          const isSelected = iconId === icon.id;
                          return (
                            <button
                              key={icon.id}
                              type="button"
                              onClick={() => setIconTheme(icon.id)}
                              title={icon.name}
                              aria-label={icon.name}
                              className={`relative p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${
                                isSelected
                                  ? 'bg-card/90 border-accent ring-2 ring-accent/40 shadow-sm scale-105'
                                  : 'bg-canvas/60 border-edge hover:border-subtle hover:bg-hover hover:scale-105'
                              }`}
                            >
                              <div
                                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow-soft"
                                style={{
                                  background: icon.gradient,
                                  boxShadow: `0 3px 10px ${icon.glow}`,
                                }}
                              >
                                <Zap className="w-4 h-4 text-white" />
                              </div>
                              {isSelected && (
                                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shadow-xs">
                                  <Check className="w-2.5 h-2.5" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: Hotkeys Shortcuts */}
                {activeTab === 'shortcuts' && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-main flex items-center gap-2">
                        <Keyboard className="w-4 h-4 text-warning" /> {tr("settings:settingsModal.globalKeyboardShortcuts")}</h3>
                      <p className="text-xs text-sub mt-1">
                        {tr("settings:settingsModal.selectAShortcutButtonAndPressA")}<span className="text-warning font-mono">{tr("settings:settingsModal.ctrlAltKey")}</span> {tr("settings:settingsModal.or")}<span className="text-warning font-mono">{tr("settings:settingsModal.altKey")}</span>{tr("settings:settingsModal.toAvoidCommonSystemAndApplicationShortcuts")}</p>
                    </div>

                    <div className="space-y-2.5 pt-1">
                      {localShortcuts.map((item) => {
                        const isRecording = recordingId === item.id;
                        return (
                          <div
                            key={item.id}
                            className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                              isRecording
                                ? 'border-warning/60 bg-warning/10 ring-1 ring-warning'
                                : 'bg-canvas/60 border-edge hover:bg-hover/40'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="text-xs font-bold text-main">{DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === item.id)?.name || item.name}</div>
                              <div className="text-[11px] text-sub">{DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === item.id)?.description || item.description}</div>
                            </div>

                            <button
                              type="button"
                              onClick={() => setRecordingId(item.id)}
                              onKeyDown={isRecording ? (e) => handleKeyDown(e, item.id) : undefined}
                              autoFocus={isRecording}
                              className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all min-w-[100px] text-center ${
                                isRecording
                                  ? 'animate-pulse border-warning/60 bg-warning/30 font-bold text-main'
                                  : 'bg-card hover:bg-hover text-warning border-subtle hover:border-warning/40'
                              }`}
                            >
                              {isRecording ? tr("settings:settingsModal.pressAShortcut") : item.keyLabel}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {shortcutSavedSuccess && (
                      <div className="p-2.5 bg-success/10 border border-success/40 text-success rounded-xl flex items-center gap-2 font-medium text-xs">
                        <Check className="w-4 h-4 text-success" />
                        <span>{tr("settings:settingsModal.shortcutsSavedAndApplied")}</span>
                      </div>
                    )}
                    {shortcutSaveError && (
                      <div className="p-2.5 bg-danger/10 border border-danger/40 text-danger rounded-xl flex items-start gap-2 font-medium text-xs">
                        <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                        <span>{localizeMessage(shortcutSaveError)}</span>
                      </div>
                    )}
                  </div>
                )}

                {(activeTab === 'models' || activeTab === 'llm') && (
                  <ModelProvidersPanel />
                )}

                {activeTab === 'skills' && (
                  <AgentSettingsPanel tab="skills" catalog={aiCatalog} />
                )}

                {activeTab === 'mcp' && (
                  <AgentSettingsPanel tab="mcp" catalog={aiCatalog} />
                )}

                {activeTab === 'schedules' && (
                  <ScheduleSettingsPanel catalog={aiCatalog} />
                )}

                {activeTab === 'web' && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-main">
                          <Globe className="h-4 w-4 shrink-0 text-success" />
                          {tr("settings:settingsModal.webAccess")}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-sub">
                          {tr("settings:settingsModal.accessTheLocalUserSTasksAnd")}</p>
                      </div>
                      <div className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        webStatus?.running ? 'mcp-status-running' : 'mcp-status-off'
                      }`}>
                        <span className={`h-2 w-2 rounded-full ${webStatus?.running ? 'bg-success' : 'bg-muted'}`} />
                        {webStatus?.running ? tr("settings:settingsModal.running") : tr("settings:settingsModal.stopped")}
                      </div>
                    </div>

                    <div className="mcp-warning rounded-xl p-3 text-[11px] leading-relaxed">
                      {tr("settings:settingsModal.passwordAndSessionProtectedUseOnA")}</div>

                    <div className="mcp-panel flex items-center justify-between gap-3 rounded-xl p-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-main">{tr("settings:settingsModal.enableWebAccess")}</div>
                        <div className="mt-0.5 text-[11px] text-sub">{tr("settings:settingsModal.startsWithLanmindAndStopsWhenThe")}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={webEnabled}
                        aria-label={tr("settings:settingsModal.enableWebAccess")}
                        onClick={() => { markWebChanged(); setWebEnabled((value) => !value); }}
                        className="ui-switch"
                        data-state={webEnabled ? 'checked' : 'unchecked'}
                      >
                        <span className="ui-switch-thumb" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-sub">{tr("settings:settingsModal.listenOn")}</label>
                        <ThemeSelect portal ariaLabel={tr("settings:settingsModal.webAccessNetworkScope")} value={webBindAddress} options={[{ value: '0.0.0.0', label: tr("settings:settingsModal.lanDevices") }, { value: '127.0.0.1', label: tr("settings:settingsModal.thisDeviceOnly") }]} onChange={(value) => { markWebChanged(); setWebBindAddress(value as '0.0.0.0' | '127.0.0.1'); }} />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-sub">{tr("settings:settingsModal.port")}</label>
                        <input
                          type="number"
                          min={1024}
                          max={65535}
                          value={webPort}
                          aria-label={tr("settings:settingsModal.webAccessPort")}
                          onChange={(event) => { markWebChanged(); setWebPort(Number(event.target.value)); }}
                          className="mcp-field w-full rounded-xl px-3 py-2 font-mono text-xs focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-sub">
                        <Key className="h-3.5 w-3.5" /> {tr("settings:settingsModal.accessPassword")}</label>
                      <div className="flex items-center gap-2"><input
                        aria-label={tr("settings:settingsModal.webAccessPassword")}
                        type={webPasswordVisible ? 'text' : 'password'}
                        value={webPassword}
                        maxLength={128}
                        autoComplete="new-password"
                        onChange={(event) => { markWebChanged(); setWebPassword(event.target.value); }}
                        placeholder={webStatus?.passwordConfigured ? tr("settings:settingsModal.alreadySetLeaveBlankToKeep") : tr("settings:settingsModal.atLeast8Characters")}
                        className="mcp-field min-w-0 flex-1 rounded-md px-3 py-2 text-xs focus:outline-none"
                      />
                        <button type="button" disabled={webPasswordLoading} title={webPasswordVisible ? tr("settings:settingsModal.hidePassword") : tr("settings:settingsModal.showPassword")} aria-label={webPasswordVisible ? tr("settings:settingsModal.hidePassword") : tr("settings:settingsModal.showPassword")} onClick={() => void toggleWebPassword()} className="project-toolbar-icon">{webPasswordLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : webPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                        <button type="button" disabled={webPasswordLoading || (!webPassword && !webStatus?.passwordConfigured)} title={webPasswordCopied ? tr("settings:settingsModal.accessPasswordCopied") : tr("settings:settingsModal.copyAccessPassword")} aria-label={tr("settings:settingsModal.copyAccessPassword")} onClick={() => void copyWebPassword()} className="project-toolbar-icon">{webPasswordCopied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}</button>
                        <button type="button" title={tr("settings:settingsModal.generateA16CharacterPassword")} aria-label={tr("settings:settingsModal.generateA16CharacterPassword")} onClick={() => { markWebChanged(); setWebPassword(generateAccessPassword()); setWebPasswordVisible(true); }} className="project-toolbar-icon"><Shuffle className="h-4 w-4" /></button>
                      </div>
                      {webPasswordCopied && <p role="status" className="mt-1 text-[11px] text-success">{tr("settings:settingsModal.passwordCopied")}</p>}
                    </div>

                    <div><label className="mb-1 block text-[11px] font-semibold text-sub">{tr("settings:settingsModal.accessMode")}</label><ThemeSelect portal ariaLabel={tr("settings:settingsModal.webAccessMode")} value={webReadOnly ? 'readOnly' : 'editable'} options={[{ value: 'readOnly', label: tr("settings:settingsModal.readOnly") }, { value: 'editable', label: tr("settings:settingsModal.editable") }]} onChange={(value) => { markWebChanged(); setWebReadOnly(value === 'readOnly'); }} /></div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-sub">{tr("settings:settingsModal.accessUrl")}</label>
                      <div className="flex min-w-0 gap-2">
                        <div className="mcp-field min-w-0 flex-1 truncate rounded-xl px-3 py-2 font-mono text-xs">
                          {webStatus?.endpoint || tr("settings:settingsModal.httpLanIp", { value0: webPort })}
                        </div>
                        <button
                          type="button"
                          disabled={!webStatus?.endpoint}
                          onClick={() => webStatus?.endpoint && copyText(webStatus.endpoint)}
                          className="mcp-button shrink-0 rounded-xl px-3 disabled:opacity-40"
                          title={tr("settings:settingsModal.copyAccessUrl")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {webSaving && <div className="flex items-center gap-2 text-xs text-sub" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />{tr("settings:settingsModal.saving")}</div>}

                    {(webError || webStatus?.error) && (
                      <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span className="flex-1">{localizeMessage(webError || webStatus?.error || '')}</span>
                        <button type="button" disabled={webSaving} onClick={() => { markWebChanged(); void handleSaveWeb(); }} className="shrink-0 underline">{tr("settings:settingsModal.retry")}</button>
                      </div>
                    )}
                    {webSaved && (
                      <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 p-2.5 text-xs text-success">
                        <Check className="h-4 w-4" /> {tr("settings:settingsModal.webAccessSettingsApplied")}</div>
                    )}
                  </div>
                )}

                {activeTab === 'mcp_server' && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="flex items-center gap-2 whitespace-nowrap text-sm font-bold text-main">
                          <Server className="h-4 w-4 shrink-0 text-info" />
                          <span className="shrink-0">{tr("settings:settingsModal.lanMcpServer")}</span>
                          <McpHelpTooltip content={tr("settings:settingsModal.allowTrustedLanModelsAndAgentsTo")} />
                        </h3>
                        <p className="text-xs text-sub mt-1 leading-relaxed">
                          {tr("settings:settingsModal.allowTrustedLanModelsAndAgentsTo2")}</p>
                      </div>
                      <div className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        mcpStatus?.running
                          ? 'mcp-status-running'
                          : 'mcp-status-off'
                      }`}>
                        <span className={`h-2 w-2 rounded-full ${mcpStatus?.running ? 'bg-success' : 'bg-muted'}`} />
                        {mcpStatus?.running ? tr("settings:settingsModal.running") : tr("settings:settingsModal.stopped")}
                      </div>
                    </div>

                    <div className="mcp-warning rounded-xl p-3 text-[11px] leading-relaxed">
                      {tr("settings:settingsModal.usesHttpAndABearerTokenEnable")}</div>

                    <div className="mcp-panel flex items-center justify-between gap-3 rounded-xl p-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-main">{tr("settings:settingsModal.enableMcpServer")}</div>
                        <div className="mt-0.5 text-[11px] text-sub">{tr("settings:settingsModal.startsWithLanmindAndStopsWhenThe2")}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={mcpEnabled}
                        onClick={() => void handleToggleMcp(!mcpEnabled)}
                        className="ui-switch"
                        data-state={mcpEnabled ? 'checked' : 'unchecked'}
                      >
                        <span className="ui-switch-thumb" />
                      </button>
                    </div>

                    <div className="grid grid-cols-[minmax(110px,130px)_minmax(0,1fr)] gap-3">
                      <div className="min-w-0">
                        <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-sub">{tr("settings:settingsModal.port")}<McpHelpTooltip content={tr("settings:settingsModal.localPortForMcpBetween1024And")} /></label>
                        <input
                          type="number"
                          min={1024}
                          max={65535}
                          value={mcpPort}
                          onChange={(event) => setMcpPort(Number(event.target.value))}
                          onBlur={handlePortBlur}
                          className="mcp-field w-full rounded-xl px-3 py-2 font-mono text-xs focus:outline-none"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-sub">{tr("settings:settingsModal.streamableHttpUrl")}<McpHelpTooltip content={tr("settings:settingsModal.useThisUrlInAnMcpClient")} /></label>
                        <div className="flex min-w-0 gap-2">
                          <div className="mcp-field min-w-0 flex-1 truncate rounded-xl px-3 py-2 font-mono text-xs">
                            {mcpStatus?.endpoint || tr("settings:settingsModal.httpLanIpMcp", { value0: mcpPort })}
                          </div>
                          <button
                            type="button"
                            disabled={!mcpStatus?.endpoint}
                            onClick={() => mcpStatus?.endpoint && copyText(mcpStatus.endpoint)}
                            className="mcp-button shrink-0 rounded-xl px-3 disabled:opacity-40"
                            title={tr("settings:settingsModal.copyUrl")}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-sub">Bearer Token <McpHelpTooltip content={tr("settings:settingsModal.requiredForAllMcpRequestsStoredOn")} align="left" /></label>
                      <div className="flex min-w-0 flex-wrap gap-2">
                        <div className="mcp-field min-w-[180px] flex-1 truncate rounded-xl px-3 py-2 font-mono text-xs">
                          {mcpTokenVisible ? mcpStatus?.token || '' : '••••••••••••••••••••••••••••••••'}
                        </div>
                        <button
                          type="button"
                          onClick={() => setMcpTokenVisible((visible) => !visible)}
                          className="mcp-button shrink-0 rounded-xl px-3"
                          title={mcpTokenVisible ? tr("settings:settingsModal.hideToken") : tr("settings:settingsModal.showToken")}
                        >
                          {mcpTokenVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          disabled={!mcpStatus?.token}
                          onClick={() => mcpStatus?.token && copyText(mcpStatus.token)}
                          className="mcp-button shrink-0 rounded-xl px-3 disabled:opacity-40"
                          title={tr("settings:settingsModal.copyToken")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={mcpSaving}
                          onClick={handleRotateMcpToken}
                          className="mcp-button flex shrink-0 items-center gap-1.5 rounded-xl px-3 text-[11px] font-semibold text-warning disabled:opacity-40"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> {tr("settings:settingsModal.rotate")}</button>
                      </div>
                    </div>

                    {(mcpError || mcpStatus?.error) && (
                      <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{localizeMessage(mcpError || mcpStatus?.error || '')}</span>
                      </div>
                    )}
                    {mcpSaved && (
                      <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 p-2.5 text-xs text-success">
                        <Check className="h-4 w-4" /> {tr("settings:settingsModal.mcpSettingsSavedAndApplied")}</div>
                    )}
                  </div>
                )}

                {/* Tab 4: About System */}
                {activeTab === 'about' && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div>
                      <h3 className="text-sm font-bold text-main flex items-center gap-2">
                        <Info className="w-4 h-4 text-info" /> {tr("settings:settingsModal.about2")}</h3>
                      <p className="text-xs text-sub mt-1">
                        {tr("settings:settingsModal.applicationInformationAndFeatures")}</p>
                    </div>

                    {/* Main Hero Card */}
                    <div className="p-4 bg-canvas/80 border border-edge rounded-2xl flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center shadow-soft flex-shrink-0 mt-0.5">
                        <Zap className="w-7 h-7 text-on-accent" />
                      </div>
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-extrabold text-main">{tr("settings:settingsModal.lanmind")}</h4>
                          <span className="rounded-md border border-subtle bg-surface px-2 py-0.5 font-mono text-[10px] font-semibold text-sub">
                            {appVersion
                              ? appVersion === 'unknown' ? tr("settings:settingsModal.unknownVersion") : `v${appVersion}`
                              : desktopAvailable ? tr("settings:settingsModal.readingVersion") : tr("settings:settingsModal.webPreview")}
                          </span>
                        </div>
                        <p className="text-xs text-sub leading-relaxed">
                          {tr("settings:settingsModal.taskManagementOverYourLanWithLocal")}</p>
                      </div>
                    </div>

                    {/* Key Architectural Features Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      <div className="p-3 bg-canvas/50 border border-edge/80 rounded-xl space-y-1">
                        <div className="flex items-center space-x-2 text-success text-xs font-bold">
                          <Wifi className="w-3.5 h-3.5" />
                          <span>{tr("settings:settingsModal.lanCollaboration")}</span>
                        </div>
                        <p className="text-[11px] text-sub leading-normal">
                          {tr("settings:settingsModal.automaticPeerDiscoveryAndIncrementalSyncWithout")}</p>
                      </div>

                      <div className="p-3 bg-canvas/50 border border-edge/80 rounded-xl space-y-1">
                        <div className="flex items-center space-x-2 text-feature text-xs font-bold">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{tr("settings:settingsModal.aiTools")}</span>
                        </div>
                        <p className="text-[11px] text-sub leading-normal">
                          {tr("settings:settingsModal.connectAModelApiForTaskAnalysis")}</p>
                      </div>

                      <div className="p-3 bg-canvas/50 border border-edge/80 rounded-xl space-y-1">
                        <div className="flex items-center space-x-2 text-info text-xs font-bold">
                          <Sliders className="w-3.5 h-3.5" />
                          <span>{tr("settings:settingsModal.viewsAndCollaboration")}</span>
                        </div>
                        <p className="text-[11px] text-sub leading-normal">
                          {tr("settings:settingsModal.listKanbanCalendarAndTimelineViewsWith")}</p>
                      </div>

                      <div className="p-3 bg-canvas/50 border border-edge/80 rounded-xl space-y-1">
                        <div className="flex items-center space-x-2 text-warning text-xs font-bold">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>{tr("settings:settingsModal.localData")}</span>
                        </div>
                        <p className="text-[11px] text-sub leading-normal">
                          {tr("settings:settingsModal.tasksAndMessagesAreStoredLocallyWork")}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Data Imports */}
                {activeTab === 'imports' && (
                  <SettingsImportPanel
                    projects={projects || []}
                    currentUserId={currentUserId}
                    onImportFinished={onTasksImported}
                  />
                )}

                {/* Tab: Data Exports */}
                {activeTab === 'exports' && (
                  <SettingsExportPanel
                    projects={projects || []}
                    users={users || []}
                    currentUserId={currentUserId}
                    currentUser={currentUser}
                  />
                )}

                {/* Tab: Data Cleanup */}
                {activeTab === 'cleanup' && (
                  <SettingsCleanupPanel
                    currentUserId={currentUserId}
                    onCleanupFinished={onTasksImported}
                  />
                )}
  </>;

  // 页面路径：填满画布，无遮罩、无居中、无对话框语义、无 Esc 关闭、无关闭按钮。
  if (embedded) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-canvas text-main">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {navList}
          {contentShell(settingsContent)}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr("settings:settingsModal.settings")}
        className="flex h-[620px] max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-edge bg-surface px-6 py-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-info" />
            <h2 className="text-sm font-bold text-main">{tr("settings:settingsModal.settings")}</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="ui-modal-close-btn"
            title={tr("settings:settingsModal.closeSettingsEsc")}
            aria-label={tr("settings:settingsModal.closeSettings")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {navList}
          {contentShell(settingsContent)}
        </div>
      </div>
    </div>
  );
};
