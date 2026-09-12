/**
 * LAN Task & PPT Studio Type Definitions
 */

export type ThemeId = 'navy-slate' | 'aurora-purple' | 'cyber-emerald' | 'warm-amber' | 'titanium-light';
export type ThemePreference = ThemeId | 'system';

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
  previewColor: string; // Hex or gradient string for swatch
  bgCanvas: string;
  bgHeader: string;
  bgSidebar: string;
  bgCard: string;
  textPrimary: string;
  textSecondary: string;
  borderAccent: string;
  primaryButton: string;
  primaryBadge: string;
  accentColor?: string;
  gradient?: string;
}

export type Role = 'admin' | 'user';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4'; // P1: Urgent & Important, P4: Low

export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'blocked';

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** ISO weekday number: Monday = 1, Sunday = 7. */
export type RecurrenceWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface RecurrenceRule {
  /** Repeat every N units of the selected recurrence type. */
  interval: number;
  daysOfWeek?: RecurrenceWeekday[];
  dayOfMonth?: number;
  monthOfYear?: number;
  /** Local wall-clock time (HH:mm), or null for an all-day task. */
  timeOfDay?: string | null;
}

export type ReportType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';

export interface User {
  id: string; // e.g. "zhangsan@dev-pc-02"
  username: string; // e.g. "zhangsan"
  deviceId: string; // e.g. "dev-pc-02"
  nickname: string;
  role: Role;
  ip: string;
  isOnline: boolean;
  lastActive: string;
  avatar?: string; // Emoji preset or avatar string
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string; // Hex color for UI tag
  createdBy: string; // User identity string
  admins: string[]; // List of user identity strings with Project Admin rights
  members: string[]; // List of user identity strings
  createdAt: string;
  updatedAt: string;
  /** The current user's project-access state, supplied by the desktop node. */
  membershipStatus?: 'member' | 'pending' | 'available';
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  dueDate: string | null; // Local YYYY-MM-DD or YYYY-MM-DDTHH:mm
  recurrence?: RecurrenceType;
  recurrenceRule?: RecurrenceRule | null;
  reminderTime?: string | null; // Absolute local reminder time, YYYY-MM-DDTHH:mm
  creatorId: string; // User identity
  assigneeId: string; // User identity
  projectId: string | null; // Null if personal task
  isShared: boolean; // For personal tasks shared with others
  sharedWith: string[]; // List of user identities
  subtasks: Subtask[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ChangeLog {
  id: string;
  entityType: 'task' | 'task_assignment' | 'project' | 'user_profile' | 'chat_message' | 'chat_group';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'transfer';
  payload: any;
  timestamp: string;
  nodeId: string;
  version: number;
}

export interface LLMConfig {
  protocol: 'openai';
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export interface TaskAssignmentNotification {
  id: string;
  taskId: string;
  taskTitle: string;
  recipientId: string;
  assignerId: string;
  assignerName: string;
  projectId?: string | null;
  createdAt: string;
  readAt?: string | null;
}

export interface PPTTemplateSlide {
  slideType: 'cover' | 'content' | 'summary' | 'roadmap';
  titlePlaceholder?: string; // e.g. "{{TITLE}}"
  subtitlePlaceholder?: string; // e.g. "{{SUBTITLE}}"
  sectionTitlePlaceholder?: string; // e.g. "{{SECTION_TITLE}}"
  bulletListPlaceholder?: string; // e.g. "{{BULLET_LIST}}"
}

export interface PPTTemplate {
  id: string;
  name: string;
  description: string;
  theme: 'business' | 'tech' | 'minimalist' | 'custom';
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  cardBgColor: string;
  accentColor: string;
  fontFamily: string;
  slidesLayout: PPTTemplateSlide[];
  isCustom?: boolean;
}

export interface ReportGenerationRequest {
  type: ReportType;
  projectId?: string; // Optional: filter by project
  dateRange: {
    startDate: string;
    endDate: string;
  };
  customNotes?: string;
  /** Editable model instruction shown in the report studio. */
  promptOverride?: string;
  currentUserId: string;
  pptTemplateId?: string;
}

export type ReportSectionKind = 'achievement' | 'progress' | 'risk' | 'plan' | 'support' | 'custom';

export interface ReportMetrics {
  relevantTasksCount: number;
  completedTasksCount: number;
  progressedTasksCount: number;
  pendingTasksCount: number;
  blockedTasksCount: number;
  overdueTasksCount: number;
  upcomingTasksCount: number;
}

export interface ReportSectionItem {
  headline: string;
  detail: string;
  impact?: string;
  nextAction?: string;
  taskIds: string[];
  severity?: 'high' | 'medium' | 'low';
  dueDate?: string | null;
}

export interface ReportSection {
  id: string;
  kind: ReportSectionKind;
  title: string;
  purpose?: string;
  conclusion?: string;
  summary?: string | null;
  items: ReportSectionItem[];
}

export interface GeneratedReport {
  title: string;
  type: ReportType;
  period: string;
  asOf: string;
  generatedAt: string;
  audience: string;
  keyTakeaway: string;
  executiveSummary: string;
  metrics: ReportMetrics;
  sections: ReportSection[];
  dataNotes: string[];
  rawMarkdown: string;
  generationMode: 'ai' | 'fallback';
}

export type PresentationRelationType = 'opening' | 'cause' | 'progression' | 'turn' | 'evidence' | 'decision' | 'closing';
export type PresentationLayout = 'cover' | 'conclusion' | 'metric-focus' | 'two-column' | 'comparison' | 'timeline' | 'process' | 'evidence-cards' | 'risk-action' | 'closing';
export type PresentationVisualKind = 'none' | 'metrics' | 'donut' | 'bar' | 'timeline' | 'process' | 'comparison';

export interface PresentationSupportingPoint {
  text: string;
  taskIds: string[];
}

export interface PresentationSlide {
  id: string;
  purpose: string;
  title: string;
  coreMessage: string;
  relationToPrevious: {
    type: PresentationRelationType;
    label: string;
  };
  layout: PresentationLayout;
  visual: {
    kind: PresentationVisualKind;
    title: string;
    metricKeys: Array<keyof ReportMetrics>;
  };
  supportingPoints: PresentationSupportingPoint[];
  speakerNotes: string;
}

export interface GeneratedPresentation {
  title: string;
  type: ReportType;
  period: string;
  asOf: string;
  generatedAt: string;
  audience: string;
  keyTakeaway: string;
  metrics: ReportMetrics;
  slides: PresentationSlide[];
  dataNotes: string[];
  generationMode: 'ai' | 'fallback';
}

export interface RiskWarning {
  id: string;
  level: 'high' | 'medium' | 'low';
  type: 'overdue' | 'imminent' | 'unassigned_p1' | 'overload';
  title: string;
  description: string;
  relatedTaskIds: string[];
  aiRecommendation: string;
}

export interface QuickParseResult {
  title: string;
  dueDate: string | null;
  reminderTime?: string | null; // Parsed due date-time when the input includes a clock time
  priority: Priority;
  projectName?: string | null;
  assigneeName?: string | null;
  recurrence?: RecurrenceType;
  recurrenceRule?: RecurrenceRule | null;
  tags: string[];
}

export type LanMessageType = 'text' | 'image' | 'file';

export interface LanChatGroup {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  memberIds: string[];
  adminIds?: string[];
  createdBy: string;
  createdAt: string;
  projectId?: string; // Linked project ID
}

export interface LanChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  receiverId?: string; // null or undefined means broadcast to LAN (if no groupId)
  groupId?: string; // if set, sent to this group
  type: LanMessageType;
  content: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  timestamp: string;
}
