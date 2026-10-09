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
} from 'lucide-react';
import { generateAccessPassword } from '../utils/accessPassword';
import { AppLockSettings } from './AppLockSettings';
import { WindowCloseSettings } from './WindowCloseSettings';
import { ShortcutItem, DEFAULT_SHORTCUTS } from './ShortcutModal';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { ApiService, McpStatus, WebStatus } from '../services/api';
import { WeekStartDay } from '../types';
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

const NOTIFICATION_TONE_OPTIONS: ThemeSelectOption[] = [
  { value: 'chime', get label() { return tr("settings:settingsModal.chimeDefault"); }, tone: 'amber' },
  { value: 'gentle', get label() { return tr("settings:settingsModal.gentle"); }, tone: 'emerald' },
  { value: 'classic', get label() { return tr("settings:settingsModal.classicBell"); }, tone: 'blue' },
  { value: 'cyber', get label() { return tr("settings:settingsModal.digital"); }, tone: 'rose' },
];

export type SettingsTab = 'basic' | 'theme' | 'shortcuts' | 'llm' | 'web' | 'mcp' | 'about';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: ShortcutItem[];
  onSaveShortcuts: (newShortcuts: ShortcutItem[]) => Promise<void>;
  currentUserId: string;
  onTasksImported: () => Promise<void>;
  defaultTab?: SettingsTab;
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
  onClose,
  shortcuts,
  onSaveShortcuts,
  currentUserId,
  onTasksImported,
  defaultTab = 'basic',
}) => {
  useLocale();
  const { currentTheme, themePreference, setThemeId, allThemes } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);
  const desktopAvailable = isTauri();

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

  // LLM Config state
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o-mini');
  const [llmSavedSuccess, setLlmSavedSuccess] = useState(false);
  const [llmLoading, setLlmLoading] = useState(false);
  const [testingLLM, setTestingLLM] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [modelFilterQuery, setModelFilterQuery] = useState('');
  const [modelFetchMessage, setModelFetchMessage] = useState<{ success: boolean; message: string } | null>(null);
  const [dropdownPlacement, setDropdownPlacement] = useState<'up' | 'down'>('up');
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const modelSectionRef = useRef<HTMLDivElement>(null);
  const modelInputBoxRef = useRef<HTMLDivElement>(null);
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
      setActiveTab(defaultTab);
      setLocalShortcuts(shortcuts);
      setRecordingId(null);
      setShortcutSaveError('');
      setLlmTestResult(null);
      setDataResult(null);
      loadAutostart();
      loadDesktopCalendarConfig();
      loadLLMConfig();
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

  useEffect(() => {
    if (!showModelDropdown) return;

    const updatePlacement = () => {
      if (!modelInputBoxRef.current) return;
      const inputRect = modelInputBoxRef.current.getBoundingClientRect();
      const container = contentAreaRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const spaceBelow = containerRect.bottom - inputRect.bottom;
        const spaceAbove = inputRect.top - containerRect.top;
        setDropdownPlacement(spaceBelow < 260 && spaceAbove > spaceBelow ? 'up' : 'down');
      } else {
        const spaceBelow = window.innerHeight - inputRect.bottom;
        const spaceAbove = inputRect.top;
        setDropdownPlacement(spaceBelow < 260 && spaceAbove > spaceBelow ? 'up' : 'down');
      }
    };

    updatePlacement();

    const handlePointerDown = (e: MouseEvent) => {
      if (modelSectionRef.current && !modelSectionRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModelDropdown(false);
      }
    };

    const container = contentAreaRef.current;
    window.addEventListener('resize', updatePlacement);
    container?.addEventListener('scroll', updatePlacement);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updatePlacement);
      container?.removeEventListener('scroll', updatePlacement);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showModelDropdown]);

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

  const handleTestLLM = async () => {
    setTestingLLM(true);
    setLlmTestResult(null);
    try {
      const res = await ApiService.testLLMConnection({
        protocol: 'openai',
        baseUrl,
        apiKey,
        modelName,
      });
      if (res.success) {
        setLlmTestResult({ success: true, message: res.message || tr("settings:settingsModal.connectionSuccessful") });
      } else {
        setLlmTestResult({ success: false, message: res.error || tr("settings:settingsModal.connectionFailed") });
      }
    } catch (err: any) {
      setLlmTestResult({ success: false, message: err.message || tr("settings:settingsModal.connectionTestError") });
    } finally {
      setTestingLLM(false);
    }
  };

  const loadLLMConfig = async () => {
    try {
      setLlmLoading(true);
      const cfg = await ApiService.getLLMConfig();
      if (cfg) {
        setBaseUrl(cfg.baseUrl || 'https://api.openai.com/v1');
        setApiKey(cfg.apiKey || '');
        setModelName(cfg.modelName || 'gpt-4o-mini');
      }
    } catch (e) {
      console.error('Failed to load LLM config', e);
    } finally {
      setLlmLoading(false);
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

  const handleSaveLLM = async (e?: React.FormEvent, customModel?: string) => {
    if (e) e.preventDefault();
    const effectiveModel = customModel !== undefined ? customModel : modelName;
    try {
      await ApiService.updateLLMConfig({
        protocol: 'openai',
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: effectiveModel.trim(),
      });
      setLlmSavedSuccess(true);
      setTimeout(() => {
        setLlmSavedSuccess(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to save LLM config', err);
    }
  };

  const handleFetchModels = async () => {
    if (!baseUrl.trim()) {
      setModelFetchMessage({ success: false, message: tr("settings:settingsModal.enterTheApiUrlFirst") });
      return;
    }
    setFetchingModels(true);
    setModelFetchMessage(null);
    try {
      const res = await ApiService.fetchLLMModels({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      if (res.success && res.models && res.models.length > 0) {
        setAvailableModels(res.models);
        setShowModelDropdown(true);
        setModelFetchMessage({ success: true, message: tr("settings:settingsModal.foundAvailableModels", { value0: res.models.length }) });
      } else {
        setModelFetchMessage({ success: false, message: res.error || tr("settings:settingsModal.couldNotGetModelsCheckTheUrl") });
      }
    } catch (err: any) {
      setModelFetchMessage({ success: false, message: err.message || tr("settings:settingsModal.couldNotRetrieveModelList") });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleClose = () => {
    void handleSaveLLM();
    onClose();
  };

  if (!isOpen) return null;

  const menuItems = [
    {
      id: 'basic' as SettingsTab,
      label: tr("settings:settingsModal.general"),
      icon: Settings,
      badgeColor: 'text-info',
    },
    {
      id: 'theme' as SettingsTab,
      label: tr("settings:settingsModal.appearance"),
      icon: Palette,
      badgeColor: 'text-feature',
    },
    {
      id: 'shortcuts' as SettingsTab,
      label: tr("settings:settingsModal.keyboardShortcuts"),
      icon: Keyboard,
      badgeColor: 'text-warning',
    },
    {
      id: 'llm' as SettingsTab,
      label: tr("settings:settingsModal.modelSettings"),
      icon: Sparkles,
      badgeColor: 'text-feature',
    },
    {
      id: 'web' as SettingsTab,
      label: tr("settings:settingsModal.webAccess"),
      icon: Globe,
      badgeColor: 'text-success',
    },
    {
      id: 'mcp' as SettingsTab,
      label: tr("settings:settingsModal.mcpServer"),
      icon: Server,
      badgeColor: 'text-info',
    },
    {
      id: 'about' as SettingsTab,
      label: tr("settings:settingsModal.about"),
      icon: Info,
      badgeColor: 'text-info',
    },
  ];

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-4xl w-full h-[620px] max-h-[calc(100vh-2rem)] flex flex-col shadow-popover overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge bg-surface/80 flex-shrink-0">
          <div className="flex items-center space-x-2 text-info">
            <Sliders className="w-5 h-5 text-info" />
            <h2 className="text-base font-bold text-main">{tr("settings:settingsModal.settings")}</h2>
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

        {/* Side-by-side Body Layout */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Navigation Sidebar */}
          <nav aria-label={tr('settings:settingsModal.settingsCategories')} className="settings-navigation w-56 border-r border-edge bg-canvas/70 p-3 space-y-1.5 flex-shrink-0 select-none overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-bold text-quiet uppercase tracking-wider">
              {tr("settings:settingsModal.settingsCategories")}</div>
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-start gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left transition-all ${
                    isActive
                      ? `${currentTheme.primaryButton} !justify-start !gap-2.5 shadow-soft`
                      : 'text-sub hover:text-main hover:bg-hover/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-current' : item.badgeColor}`} />
                  <span className="min-w-0 whitespace-normal break-words">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Content Area */}
          <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-surface/60">
            <div ref={contentAreaRef} className="min-h-0 flex-1 overflow-y-auto p-6">
            {/* Tab 1: Basic Settings */}
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
                    <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-danger/10 p-2.5 text-xs text-danger">
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
                            ? 'border-amber-500/80 text-warning bg-amber-500/10 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
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
                        className="w-full h-1.5 bg-card rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
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
                                ? 'bg-amber-500/20 text-warning border-amber-500/50 font-bold shadow-xs'
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
                          ? 'border-rose-500/40 bg-danger/10 text-danger'
                          : 'border-emerald-500/40 bg-success/10 text-success'
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
                      className="w-full h-1.5 bg-card rounded-lg appearance-none cursor-pointer accent-blue-500"
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

                <section aria-labelledby="data-settings-heading" className="space-y-3">
                  <div>
                    <h4 id="data-settings-heading" className="flex items-center gap-2 text-xs font-bold text-main">
                      <Database className="h-3.5 w-3.5 text-info" /> {tr("settings:settingsModal.data")}</h4>
                    <p className="mt-1 text-[11px] leading-5 text-sub">
                      {tr("settings:settingsModal.transferVisibleTasksUsingJsonImportAdds")}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={!desktopAvailable || dataOperation !== null}
                      onClick={handleImportTasks}
                      className="group flex min-h-20 items-center gap-3 rounded-xl border border-edge bg-canvas/60 p-4 text-left transition-colors hover:border-cyan-500/40 hover:bg-hover/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-info">
                        {dataOperation === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-main">{tr("settings:settingsModal.importTasks2")}</span>
                        <span className="mt-1 block text-[11px] leading-4 text-sub">{tr("settings:settingsModal.chooseALanmindTaskDataFile")}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!desktopAvailable || dataOperation !== null}
                      onClick={handleExportTasks}
                      className="group flex min-h-20 items-center gap-3 rounded-xl border border-edge bg-canvas/60 p-4 text-left transition-colors hover:border-blue-500/40 hover:bg-hover/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-info">
                        {dataOperation === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-main">{tr("settings:settingsModal.exportTasks2")}</span>
                        <span className="mt-1 block text-[11px] leading-4 text-sub">{tr("settings:settingsModal.saveVisibleTasks")}</span>
                      </span>
                    </button>
                  </div>
                  {dataResult && (
                    <div className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                      dataResult.success
                        ? 'border-emerald-500/40 bg-success/10 text-success'
                        : 'border-rose-500/40 bg-danger/10 text-danger'
                    }`}>
                      {dataResult.success
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        : <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
                      <span>{localizeMessage(dataResult.message)}</span>
                    </div>
                  )}
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
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-info">
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
                    const accentColor = theme.accentColor || '#3b82f6';
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setThemeId(theme.id)}
                        style={isSelected ? { borderColor: accentColor, boxShadow: `0 8px 24px ${accentColor}25` } : undefined}
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
                                className="w-4 h-4 rounded-full shadow-inner flex-shrink-0 ring-1 ring-white/20"
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
                            ? 'bg-warning/10 border-amber-500/60 ring-1 ring-amber-500'
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
                              ? 'bg-amber-500 text-main border-amber-400 animate-pulse shadow-panel shadow-amber-500/20'
                              : 'bg-card hover:bg-hover text-warning border-subtle hover:border-amber-500/40'
                          }`}
                        >
                          {isRecording ? tr("settings:settingsModal.pressAShortcut") : item.keyLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {shortcutSavedSuccess && (
                  <div className="p-2.5 bg-success/10 border border-emerald-500/40 text-success rounded-xl flex items-center gap-2 font-medium text-xs">
                    <Check className="w-4 h-4 text-success" />
                    <span>{tr("settings:settingsModal.shortcutsSavedAndApplied")}</span>
                  </div>
                )}
                {shortcutSaveError && (
                  <div className="p-2.5 bg-danger/10 border border-rose-500/40 text-danger rounded-xl flex items-start gap-2 font-medium text-xs">
                    <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                    <span>{localizeMessage(shortcutSaveError)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: LLM AI Model API Config */}
            {activeTab === 'llm' && (
              <form onSubmit={handleSaveLLM} className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-main flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-feature" /> {tr("settings:settingsModal.modelApiSettings")}</h3>
                  <p className="text-xs text-sub mt-1">
                    {tr("settings:settingsModal.usedForTaskParsingRiskAnalysisReports")}</p>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                    <Sliders className="h-3.5 w-3.5 text-sub" />
                    <span>{tr("settings:settingsModal.apiFormat")}</span>
                  </label>
                  <div className="flex h-9 items-center rounded-xl border border-subtle bg-canvas px-3 text-xs font-semibold text-main">
                    {tr("settings:settingsModal.openaiCompatible")}</div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-sub font-semibold mb-1 text-xs flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-info" /> <span>{tr("settings:settingsModal.apiUrl")}</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    onBlur={() => void handleSaveLLM()}
                    placeholder={tr("settings:settingsModal.httpsApiOpenaiComV1OrA")}
                    className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main font-mono focus:outline-none focus:border-accent/50 text-xs"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-sub font-semibold mb-1 text-xs flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-warning" /> <span>{tr("settings:settingsModal.apiKey")}</span>
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={() => void handleSaveLLM()}
                    placeholder="sk-..."
                    className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main font-mono focus:outline-none focus:border-accent/50 text-xs"
                  />
                </div>

                {/* Model Name with fetch button and dropdown */}
                <div ref={modelSectionRef}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sub font-semibold text-xs flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-feature" /> <span>{tr("settings:settingsModal.modelName")}</span>
                    </label>
                    {availableModels.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowModelDropdown((v) => !v)}
                        className="text-[11px] text-info hover:text-info transition-colors"
                      >
                        {showModelDropdown ? tr("settings:settingsModal.collapseModelList") : tr("settings:settingsModal.viewModels", { value0: availableModels.length })}
                      </button>
                    )}
                  </div>
                  <div ref={modelInputBoxRef} className="relative">
                    <input
                      type="text"
                      required
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                      onBlur={() => void handleSaveLLM()}
                      placeholder={tr("settings:settingsModal.eGGpt4oMiniDeepseekChat")}
                      className="w-full bg-canvas border border-subtle rounded-xl pl-3 pr-10 py-2 text-main font-mono focus:outline-none focus:border-accent/50 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={fetchingModels}
                      className="absolute right-1.5 top-1.5 p-1 rounded-lg border border-subtle hover:border-subtle bg-surface text-sub hover:text-main transition-all disabled:opacity-50"
                      title={tr("settings:settingsModal.getModelsSupportedByThisApi")}
                      aria-label={tr("settings:settingsModal.getAvailableModels")}
                    >
                      {fetchingModels ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-info" />
                      ) : (
                        <ListFilter className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Model Dropdown Popover */}
                    {showModelDropdown && availableModels.length > 0 && (
                      <div className={`absolute left-0 right-0 z-50 rounded-xl border border-subtle bg-surface/95 backdrop-blur-md shadow-popover p-2 animate-in fade-in zoom-in-95 ${
                        dropdownPlacement === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                      }`}>
                        <div className="flex items-center justify-between px-2 pb-1.5 border-b border-edge">
                          <span className="text-[11px] font-bold text-sub">{tr("settings:settingsModal.chooseAModelAvailable", { value0: availableModels.length })}</span>
                          <button
                            type="button"
                            onClick={() => setShowModelDropdown(false)}
                            className="ui-modal-close-btn h-6 w-6 rounded-md"
                            title={tr("settings:settingsModal.closeDropdown")}
                            aria-label={tr("settings:settingsModal.closeDropdown")}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="mt-1.5 px-1">
                          <input
                            type="text"
                            placeholder={tr("settings:settingsModal.filterModels")}
                            value={modelFilterQuery}
                            onChange={(e) => setModelFilterQuery(e.target.value)}
                            className="w-full bg-canvas border border-edge rounded-lg px-2.5 py-1 text-[11px] text-main focus:outline-none focus:border-accent/50 font-mono"
                          />
                        </div>
                        <div className="mt-1.5 max-h-44 overflow-y-auto space-y-0.5 pr-1">
                          {availableModels.filter((m) => m.toLowerCase().includes(modelFilterQuery.toLowerCase())).length === 0 ? (
                            <div className="py-3 text-center text-[11px] text-quiet">{tr("settings:settingsModal.noMatchingModels")}</div>
                          ) : (
                            availableModels
                              .filter((m) => m.toLowerCase().includes(modelFilterQuery.toLowerCase()))
                              .map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => {
                                    setModelName(m);
                                    setShowModelDropdown(false);
                                    void handleSaveLLM(undefined, m);
                                  }}
                                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors flex items-center justify-between ${
                                    modelName === m
                                      ? 'bg-blue-600/20 text-info font-semibold border border-blue-500/30'
                                      : 'hover:bg-hover text-sub hover:text-main'
                                  }`}
                                >
                                  <span className="truncate">{m}</span>
                                  {modelName === m && <Check className="w-3.5 h-3.5 text-info shrink-0" />}
                                </button>
                              ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {modelFetchMessage && (
                    <div className={`mt-1.5 text-[11px] flex items-center gap-1.5 ${
                      modelFetchMessage.success ? 'text-success' : 'text-warning'
                    }`}>
                      {modelFetchMessage.success ? (
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 shrink-0" />
                      )}
                      <span>{localizeMessage(modelFetchMessage.message)}</span>
                    </div>
                  )}
                </div>

                {/* Test Status Feedback */}
                {llmTestResult && (
                  <div
                    className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                      llmTestResult.success
                        ? 'bg-success/10 border-emerald-500/40 text-success'
                        : 'bg-danger/10 border-rose-500/40 text-danger'
                    }`}
                  >
                    {llmTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 break-all leading-relaxed">{localizeMessage(llmTestResult.message)}</div>
                  </div>
                )}

                {llmSavedSuccess && (
                  <div className="p-2.5 bg-success/10 border border-emerald-500/40 text-success rounded-xl flex items-center gap-2 font-medium text-xs">
                    <Check className="w-4 h-4 text-success" />
                    <span>{tr("settings:settingsModal.modelSettingsSavedAutomatically")}</span>
                  </div>
                )}
              </form>
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
                    <span className={`h-2 w-2 rounded-full ${webStatus?.running ? 'bg-emerald-400' : 'bg-muted'}`} />
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
                  <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-danger/10 p-2.5 text-xs text-danger">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span className="flex-1">{localizeMessage(webError || webStatus?.error || '')}</span>
                    <button type="button" disabled={webSaving} onClick={() => { markWebChanged(); void handleSaveWeb(); }} className="shrink-0 underline">{tr("settings:settingsModal.retry")}</button>
                  </div>
                )}
                {webSaved && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-success/10 p-2.5 text-xs text-success">
                    <Check className="h-4 w-4" /> {tr("settings:settingsModal.webAccessSettingsApplied")}</div>
                )}
              </div>
            )}

            {activeTab === 'mcp' && (
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
                    <span className={`h-2 w-2 rounded-full ${mcpStatus?.running ? 'bg-emerald-400' : 'bg-muted'}`} />
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
                  <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-danger/10 p-2.5 text-xs text-danger">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{localizeMessage(mcpError || mcpStatus?.error || '')}</span>
                  </div>
                )}
                {mcpSaved && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-success/10 p-2.5 text-xs text-success">
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
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-panel shadow-blue-500/20 flex-shrink-0 mt-0.5">
                    <Zap className="w-7 h-7 text-main" />
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

            </div>

            {/* Bottom Footer Action Bar */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge px-6 py-4 text-xs">
              {activeTab === 'shortcuts' ? (
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="flex items-center gap-1.5 text-sub hover:text-main px-3 py-1.5 rounded-xl border border-subtle/60 bg-surface/60 hover:bg-hover transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{tr("settings:settingsModal.restoreDefaultShortcuts")}</span>
                </button>
              ) : activeTab === 'llm' ? (
                <button
                  type="button"
                  disabled={testingLLM}
                  onClick={handleTestLLM}
                  className="px-3.5 py-1.5 bg-card/90 hover:bg-hover disabled:opacity-50 text-main hover:text-main font-semibold rounded-xl border border-subtle hover:border-subtle transition-all flex items-center gap-1.5 text-xs shadow-soft"
                >
                  {testingLLM ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-info" />
                      <span>{tr("settings:settingsModal.testing")}</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-3.5 h-3.5 text-info" />
                      <span>{tr("settings:settingsModal.testApiConnection")}</span>
                    </>
                  )}
                </button>
              ) : activeTab === 'theme' ? (
                <div className="text-sub text-[11px]">
                  {tr("settings:settingsModal.currentTheme")}<span className="text-main font-bold">{currentTheme.name}</span>
                  {themePreference === 'system' && <span>{tr("settings:settingsModal.followSystem2")}</span>}
                </div>
              ) : activeTab === 'mcp' || activeTab === 'web' ? (
                <div className="text-[11px] text-sub">{tr("settings:settingsModal.changesApplyImmediatelyAndPersistAcrossRestarts")}</div>
              ) : (
                <div className="text-sub text-[11px] flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>{tr("settings:settingsModal.lanmind2")}</span>
                </div>
              )}

              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="ui-cancel-button px-5 py-2 rounded-xl text-xs font-semibold shadow-soft"
                >
                  {tr("settings:settingsModal.close")}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
