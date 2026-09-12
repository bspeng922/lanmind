/**
 * Legacy browser-prototype persistence.
 *
 * Despite the historical file name, this module stores JSON under `.data/`;
 * the packaged desktop app uses SQLite exclusively through `src-tauri/src/db.rs`.
 */
import fs from 'fs';
import path from 'path';
import { User, Project, Task, ChangeLog, LLMConfig, PPTTemplate, RiskWarning } from '../types.js';

const DB_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DB_DIR, 'lan_todo.sqlite.json');
const LEGACY_USER_IDS = new Set([
  'admin@dev-pc-01',
  'zhangsan@dev-pc-02',
  'lisi@dev-pc-03',
  'wangwu@dev-pc-04',
]);
const LEGACY_PROJECT_IDS = new Set(['proj-001', 'proj-002']);
const LEGACY_TASK_IDS = new Set(['task-101', 'task-102', 'task-103', 'task-104', 'task-201']);

const createLocalUser = (): User => {
  const username = process.env.USERNAME?.trim() || 'local-user';
  const deviceId = process.env.COMPUTERNAME?.trim() || 'desktop';
  const safeUsername = username.replace(/[@\s]/g, '_').toLowerCase();
  const safeDeviceId = deviceId.replace(/[@\s]/g, '_').toLowerCase();
  return {
    id: `${safeUsername}@${safeDeviceId}`,
    username,
    deviceId,
    nickname: username,
    role: 'admin',
    ip: '127.0.0.1',
    isOnline: true,
    lastActive: new Date().toISOString(),
  };
};

export interface DBData {
  users: User[];
  projects: Project[];
  tasks: Task[];
  changeLogs: ChangeLog[];
  llmConfig: LLMConfig;
  pptTemplates: PPTTemplate[];
  versionCounter: number;
}

// Initial Seed Data for Multi-User LAN Demo
const INITIAL_USERS: User[] = [
  {
    id: 'admin@dev-pc-01',
    username: 'admin',
    deviceId: 'dev-pc-01',
    nickname: '系统管理员 (Admin)',
    role: 'admin',
    ip: '192.168.1.100',
    isOnline: true,
    lastActive: new Date().toISOString(),
    avatar: '🛡️',
  },
  {
    id: 'zhangsan@dev-pc-02',
    username: 'zhangsan',
    deviceId: 'dev-pc-02',
    nickname: '张三 (架构师)',
    role: 'user',
    ip: '192.168.1.102',
    isOnline: true,
    lastActive: new Date().toISOString(),
    avatar: '👨‍💻',
  },
  {
    id: 'lisi@dev-pc-03',
    username: 'lisi',
    deviceId: 'dev-pc-03',
    nickname: '李四 (前端工程师)',
    role: 'user',
    ip: '192.168.1.103',
    isOnline: true,
    lastActive: new Date().toISOString(),
    avatar: '🎨',
  },
  {
    id: 'wangwu@dev-pc-04',
    username: 'wangwu',
    deviceId: 'dev-pc-04',
    nickname: '王五 (产品经理)',
    role: 'user',
    ip: '192.168.1.104',
    isOnline: false,
    lastActive: new Date(Date.now() - 3600000).toISOString(),
    avatar: '🧠',
  },
];

const INITIAL_PROJECTS: Project[] = [
  {
    id: 'proj-001',
    name: '局域网协同 Task & PPT 客户端研制',
    description: '基于大模型与局域网 P2P 增量同步的多人任务管理与 PPT 自动化生成系统',
    color: '#3b82f6',
    createdBy: 'admin@dev-pc-01',
    admins: ['admin@dev-pc-01', 'zhangsan@dev-pc-02'],
    members: ['admin@dev-pc-01', 'zhangsan@dev-pc-02', 'lisi@dev-pc-03', 'wangwu@dev-pc-04'],
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'proj-002',
    name: 'AI 营销智能体与汇报工具',
    description: '针对季度营销总结与 AI PPT 模版自动套用的项目',
    color: '#8b5cf6',
    createdBy: 'wangwu@dev-pc-04',
    admins: ['wangwu@dev-pc-04'],
    members: ['wangwu@dev-pc-04', 'zhangsan@dev-pc-02'],
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const INITIAL_TASKS: Task[] = [
  {
    id: 'task-101',
    title: '设计局域网 P2P 增量同步日志结构',
    description: '针对离线上线的节点，设计变更日志版本号与补齐比对逻辑，确保任务状态更新无死锁。',
    priority: 'P1',
    status: 'completed',
    dueDate: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    creatorId: 'admin@dev-pc-01',
    assigneeId: 'zhangsan@dev-pc-02',
    projectId: 'proj-001',
    isShared: true,
    sharedWith: [],
    subtasks: [
      { id: 'sub-1', title: '定义 change_log 数据结构', completed: true },
      { id: 'sub-2', title: '实现局域网版本比对 API', completed: true },
    ],
    tags: ['架构', 'P2P', '同步'],
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
  {
    id: 'task-102',
    title: '集成 pptxgenjs 导出现代化 16:9 演示文稿',
    description: '配合大模型结构化 JSON 输出，生成符合预设模版（商务、科技、极简）的 PPT 文件。',
    priority: 'P1',
    status: 'in_progress',
    dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    creatorId: 'zhangsan@dev-pc-02',
    assigneeId: 'lisi@dev-pc-03',
    projectId: 'proj-001',
    isShared: true,
    sharedWith: [],
    subtasks: [
      { id: 'sub-3', title: '配置内置 3 套 PPT 色彩与排版', completed: true },
      { id: 'sub-4', title: '开发模版实时预览 UI 模态框', completed: false },
      { id: 'sub-5', title: '支持用户自定义 .pptx 占位符解析', completed: false },
    ],
    tags: ['PPT生成', '前端', '大模型'],
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
  {
    id: 'task-103',
    title: '优化大模型月报与季度汇报 Prompt 生成逻辑',
    description: '支持兼容 OpenAI 与 Anthropic 格式 API，自动归纳任务完成率、阻塞点与下阶段规划。',
    priority: 'P2',
    status: 'in_progress',
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    creatorId: 'admin@dev-pc-01',
    assigneeId: 'admin@dev-pc-01',
    projectId: 'proj-001',
    isShared: true,
    sharedWith: [],
    subtasks: [
      { id: 'sub-6', title: '集成 Anthropic API 兼容层', completed: true },
      { id: 'sub-7', title: '自动任务风险扫描算法', completed: false },
    ],
    tags: ['LLM', '汇报', 'AI'],
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
  {
    id: 'task-104',
    title: '【风险预警】高优先 P1 任务逾期核查：系统性能压测',
    description: '必须在局域网 50 个节点并发写入场景下验证 SQLite 事务写入锁机制。',
    priority: 'P1',
    status: 'blocked',
    dueDate: new Date(Date.now() - 86400000 * 2).toISOString().split('T')[0],
    creatorId: 'wangwu@dev-pc-04',
    assigneeId: 'zhangsan@dev-pc-02',
    projectId: 'proj-001',
    isShared: true,
    sharedWith: [],
    subtasks: [
      { id: 'sub-8', title: '准备模拟多节点并发请求脚本', completed: false },
    ],
    tags: ['压测', 'SQLite', '风险'],
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
  {
    id: 'task-201',
    title: '个人工作准备：梳理下周 AI 汇报材料',
    description: '整理个人未关联项目的独立调研任务，并通过快捷键 Alt+Space 快速记录。',
    priority: 'P3',
    status: 'todo',
    dueDate: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
    creatorId: 'zhangsan@dev-pc-02',
    assigneeId: 'zhangsan@dev-pc-02',
    projectId: null,
    isShared: false,
    sharedWith: [],
    subtasks: [],
    tags: ['个人', '准备'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
];

const INITIAL_TEMPLATES: PPTTemplate[] = [
  {
    id: 'tpl-executive',
    name: '经营汇报',
    description: '结论先行、数据支撑、风险与动作闭环的管理汇报风格。',
    theme: 'business',
    primaryColor: '#111827',
    secondaryColor: '#64748b',
    backgroundColor: '#ffffff',
    textColor: '#111827',
    cardBgColor: '#f8fafc',
    accentColor: '#ea580c',
    fontFamily: 'Microsoft YaHei',
    slidesLayout: [
      { slideType: 'cover' },
      { slideType: 'summary' },
      { slideType: 'content' },
      { slideType: 'roadmap' },
    ],
  },
  {
    id: 'tpl-business',
    name: '商务精简风 (Slate Business)',
    description: '典雅深青与灰蓝对比，专为季度汇报与管理层成果展示设计的经典商务风格。',
    theme: 'business',
    primaryColor: '#0f172a',
    secondaryColor: '#2563eb',
    backgroundColor: '#f8fafc',
    textColor: '#1e293b',
    cardBgColor: '#ffffff',
    accentColor: '#3b82f6',
    fontFamily: 'Arial, sans-serif',
    slidesLayout: [
      { slideType: 'cover', titlePlaceholder: '{{TITLE}}', subtitlePlaceholder: '{{SUBTITLE}}' },
      { slideType: 'content', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
      { slideType: 'summary', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
      { slideType: 'roadmap', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
    ],
  },
  {
    id: 'tpl-tech',
    name: '科技质感风 (Cyber Tech Dark)',
    description: '深黑底色配高亮青蓝发光线，适合研发团队、架构演进与技术产出汇报。',
    theme: 'tech',
    primaryColor: '#020617',
    secondaryColor: '#06b6d4',
    backgroundColor: '#0f172a',
    textColor: '#f1f5f9',
    cardBgColor: '#1e293b',
    accentColor: '#22d3ee',
    fontFamily: 'Courier New, sans-serif',
    slidesLayout: [
      { slideType: 'cover', titlePlaceholder: '{{TITLE}}', subtitlePlaceholder: '{{SUBTITLE}}' },
      { slideType: 'content', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
      { slideType: 'summary', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
      { slideType: 'roadmap', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
    ],
  },
  {
    id: 'tpl-minimalist',
    name: '极简高阶风 (Minimal Executive)',
    description: '留白丰富、暖灰优雅与极致排版，适合个人周报、月报与极简项目汇报。',
    theme: 'minimalist',
    primaryColor: '#0f172a',
    secondaryColor: '#475569',
    backgroundColor: '#f8fafc',
    textColor: '#1e293b',
    cardBgColor: '#ffffff',
    accentColor: '#2563eb',
    fontFamily: 'Georgia, serif',
    slidesLayout: [
      { slideType: 'cover', titlePlaceholder: '{{TITLE}}', subtitlePlaceholder: '{{SUBTITLE}}' },
      { slideType: 'content', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
      { slideType: 'summary', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
      { slideType: 'roadmap', sectionTitlePlaceholder: '{{SECTION_TITLE}}', bulletListPlaceholder: '{{BULLET_LIST}}' },
    ],
  },
];

export class SQLiteStore {
  private data: DBData;

  constructor() {
    this.ensureDirExists();
    this.data = this.loadData();
  }

  private ensureDirExists() {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
  }

  private loadData(): DBData {
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const data = JSON.parse(raw) as DBData;
        // Migrate the built-in minimalist theme so existing browser data gets
        // the high-contrast palette immediately after upgrading.
        data.pptTemplates = Array.isArray(data.pptTemplates) ? data.pptTemplates : INITIAL_TEMPLATES;
        const minimalTemplate = INITIAL_TEMPLATES.find((template) => template.id === 'tpl-minimalist');
        const minimalIndex = data.pptTemplates.findIndex((template) => template.id === 'tpl-minimalist');
        if (minimalTemplate && minimalIndex >= 0) {
          data.pptTemplates[minimalIndex] = { ...data.pptTemplates[minimalIndex], ...minimalTemplate };
        }
        const originalCounts = [
          data.users?.length || 0,
          data.projects?.length || 0,
          data.tasks?.length || 0,
          data.changeLogs?.length || 0,
        ];
        data.users = (data.users || []).filter((user) => !LEGACY_USER_IDS.has(user.id));
        data.projects = (data.projects || []).filter(
          (project) => !LEGACY_PROJECT_IDS.has(project.id)
        );
        data.tasks = (data.tasks || []).filter((task) => !LEGACY_TASK_IDS.has(task.id));
        data.changeLogs = (data.changeLogs || []).filter(
          (log) =>
            !LEGACY_TASK_IDS.has(log.entityId) &&
            !LEGACY_PROJECT_IDS.has(log.entityId) &&
            !LEGACY_USER_IDS.has(log.nodeId)
        );
        if (data.users.length === 0) data.users.push(createLocalUser());
        const migratedCounts = [
          data.users.length,
          data.projects.length,
          data.tasks.length,
          data.changeLogs.length,
        ];
        if (originalCounts.some((count, index) => count !== migratedCounts[index])) {
          if (data.changeLogs.length === 0) data.versionCounter = 0;
          this.saveData(data);
        }
        return data;
      } catch (e) {
        console.error('Error reading SQLite JSON file, reinitializing', e);
      }
    }

    const defaultData: DBData = {
      users: [createLocalUser()],
      projects: [],
      tasks: [],
      changeLogs: [],
      llmConfig: {
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        modelName: 'gpt-4o-mini',
      },
      pptTemplates: INITIAL_TEMPLATES,
      versionCounter: 0,
    };

    this.saveData(defaultData);
    return defaultData;
  }

  private saveData(data: DBData = this.data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  // Users CRUD
  getUsers(): User[] {
    return this.data.users;
  }

  getUserById(id: string): User | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  upsertUser(user: Partial<User> & { id: string }): User {
    const existingIndex = this.data.users.findIndex((u) => u.id === user.id);
    if (existingIndex >= 0) {
      this.data.users[existingIndex] = {
        ...this.data.users[existingIndex],
        ...user,
        lastActive: new Date().toISOString(),
      };
      this.saveData();
      return this.data.users[existingIndex];
    } else {
      const newUser: User = {
        id: user.id,
        username: user.username || user.id.split('@')[0] || 'user',
        deviceId: user.deviceId || user.id.split('@')[1] || 'device',
        nickname: user.nickname || user.username || '用户',
        role: user.role || 'user',
        ip: user.ip || '192.168.1.100',
        isOnline: true,
        lastActive: new Date().toISOString(),
      };
      this.data.users.push(newUser);
      this.saveData();
      return newUser;
    }
  }

  // Projects CRUD
  getProjects(userId?: string): Project[] {
    if (!userId) return [];
    return this.data.projects.filter(
      (project) =>
        project.createdBy === userId ||
        project.admins.includes(userId) ||
        project.members.includes(userId),
    );
  }

  getProjectById(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  createProject(proj: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project {
    const newProj: Project = {
      ...proj,
      id: 'proj-' + Date.now().toString(36),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.data.projects.push(newProj);
    this.logChange('project', newProj.id, 'create', newProj, newProj.createdBy);
    this.saveData();
    return newProj;
  }

  updateProject(id: string, updates: Partial<Project>, operatorId: string): Project | null {
    const index = this.data.projects.findIndex((p) => p.id === id);
    if (index === -1) return null;

    const current = this.data.projects[index];
    // Check permission: only project admin can manage members/settings
    const isProjectAdmin = current.admins.includes(operatorId) || current.createdBy === operatorId;
    if (!isProjectAdmin) {
      throw new Error('只有项目管理员才可以修改项目权限及设置');
    }

    const safeUpdates = { ...updates };
    delete safeUpdates.id;
    delete safeUpdates.createdBy;
    delete safeUpdates.createdAt;

    const updated = {
      ...current,
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
    };
    this.data.projects[index] = updated;
    this.logChange('project', id, 'update', updated, operatorId);
    this.saveData();
    return updated;
  }

  deleteProject(id: string, operatorId: string): boolean {
    const index = this.data.projects.findIndex((project) => project.id === id);
    if (index === -1) return false;

    const project = this.data.projects[index];
    if (project.createdBy !== operatorId) {
      throw new Error('只有项目创建者可以删除项目');
    }

    this.data.projects.splice(index, 1);
    this.logChange(
      'project',
      id,
      'delete',
      { id, previousMemberIds: project.members },
      operatorId,
    );
    this.saveData();
    return true;
  }

  // Tasks CRUD
  getTasks(): Task[] {
    const activeProjectIds = new Set(this.data.projects.map((project) => project.id));
    return this.data.tasks.filter((task) => !task.projectId || activeProjectIds.has(task.projectId));
  }

  canReadTask(task: Task, userId: string): boolean {
    const directParticipant =
      task.creatorId === userId ||
      task.assigneeId === userId ||
      (task.sharedWith || []).includes(userId);
    if (!task.projectId) return task.isShared || directParticipant;
    const project = this.data.projects.find((item) => item.id === task.projectId);
    if (!project) return false;
    const isProjectAdmin = project.createdBy === userId || project.admins.includes(userId);
    if (isProjectAdmin) return true;
    if (!task.isShared) return directParticipant;
    return project.createdBy === userId || project.admins.includes(userId) || project.members.includes(userId);
  }

  canWriteTask(task: Task, userId: string): boolean {
    if (task.projectId) {
      const project = this.data.projects.find((item) => item.id === task.projectId);
      if (project && (project.createdBy === userId || project.admins.includes(userId))) {
        return true;
      }
    }
    if (task.creatorId === userId || task.assigneeId === userId) return true;
    if (task.projectId && task.isShared) return this.canReadTask(task, userId);
    return !task.isShared && (task.sharedWith || []).includes(userId);
  }

  getTasksForUser(userId: string): Task[] {
    return this.getTasks().filter((task) => this.canReadTask(task, userId));
  }

  getTaskById(id: string): Task | undefined {
    return this.data.tasks.find((t) => t.id === id);
  }

  createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'version'>, operatorId: string): Task {
    this.data.versionCounter++;
    const newTask: Task = {
      ...task,
      id: 'task-' + Date.now().toString(36),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: this.data.versionCounter,
    };
    this.data.tasks.push(newTask);
    this.logChange('task', newTask.id, 'create', newTask, operatorId);
    this.saveData();
    return newTask;
  }

  updateTask(id: string, updates: Partial<Task>, operatorId: string): Task | null {
    const index = this.data.tasks.findIndex((t) => t.id === id);
    if (index === -1) return null;

    const current = this.data.tasks[index];
    if (!this.canWriteTask(current, operatorId)) {
      throw new Error('只有任务创建者或指派人可以修改该局域网共享任务');
    }
    const safeUpdates = { ...updates };
    delete safeUpdates.id;
    delete safeUpdates.creatorId;
    delete safeUpdates.createdAt;
    delete safeUpdates.updatedAt;
    delete safeUpdates.version;
    this.data.versionCounter++;
    const updated: Task = {
      ...current,
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
      version: this.data.versionCounter,
    };
    this.data.tasks[index] = updated;
    const changePayload = updated.status !== current.status
      ? {
          ...updated,
          _statusTransition: { from: current.status, to: updated.status },
        }
      : updated;
    this.logChange('task', id, 'update', changePayload, operatorId);
    this.saveData();
    return updated;
  }

  deleteTask(id: string, operatorId: string): boolean {
    const index = this.data.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;
    const current = this.data.tasks[index];
    if (!this.canWriteTask(current, operatorId)) {
      throw new Error('只有任务创建者或指派人可以删除该局域网共享任务');
    }
    const [deleted] = this.data.tasks.splice(index, 1);
    this.logChange('task', id, 'delete', { id }, operatorId);
    this.saveData();
    return true;
  }

  // Sync Log
  private logChange(
    entityType: ChangeLog['entityType'],
    entityId: string,
    action: 'create' | 'update' | 'delete',
    payload: any,
    nodeId: string
  ) {
    this.data.versionCounter++;
    const log: ChangeLog = {
      id: 'log-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      entityType,
      entityId,
      action,
      payload,
      timestamp: new Date().toISOString(),
      nodeId,
      version: this.data.versionCounter,
    };
    this.data.changeLogs.push(log);
  }

  getChangeLogsSince(sinceVersion: number): ChangeLog[] {
    return this.data.changeLogs.filter((l) => l.version > sinceVersion);
  }

  getLatestVersion(): number {
    return this.data.versionCounter;
  }

  // LLM Config
  getLLMConfig(): LLMConfig {
    if (this.data.llmConfig.protocol !== 'openai') {
      this.data.llmConfig = { ...this.data.llmConfig, protocol: 'openai' };
      this.saveData();
    }
    return this.data.llmConfig;
  }

  updateLLMConfig(config: Partial<LLMConfig>): LLMConfig {
    this.data.llmConfig = {
      ...this.data.llmConfig,
      ...config,
      protocol: 'openai',
    };
    this.saveData();
    return this.data.llmConfig;
  }

  // PPT Templates
  getPPTTemplates(): PPTTemplate[] {
    return this.data.pptTemplates;
  }

  addPPTTemplate(tpl: PPTTemplate): PPTTemplate {
    this.data.pptTemplates.push(tpl);
    this.saveData();
    return tpl;
  }

  // Risk Scanner Logic
  getRiskWarnings(): RiskWarning[] {
    const now = new Date();
    const warnings: RiskWarning[] = [];

    // 1. Overdue Tasks
    const overdueTasks = this.data.tasks.filter(
      (t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'completed'
    );
    if (overdueTasks.length > 0) {
      warnings.push({
        id: 'warn-overdue',
        level: 'high',
        type: 'overdue',
        title: `存在 ${overdueTasks.length} 个逾期未完成任务`,
        description: `包含高优先级任务如：“${overdueTasks[0].title}”。请立即更新进度或重新调整截止日期。`,
        relatedTaskIds: overdueTasks.map((t) => t.id),
        aiRecommendation: '建议在 AI 月报/季报中标记这些项目为主要阻塞风险，并安排专人跟进。',
      });
    }

    // 2. High priority (P1) blocked or unassigned
    const p1Blocked = this.data.tasks.filter((t) => t.priority === 'P1' && t.status === 'blocked');
    if (p1Blocked.length > 0) {
      warnings.push({
        id: 'warn-p1-blocked',
        level: 'high',
        type: 'unassigned_p1',
        title: `有 ${p1Blocked.length} 个紧急 P1 任务处于阻塞状态`,
        description: `阻塞任务：“${p1Blocked[0].title}”。这可能影响整个项目交付进度。`,
        relatedTaskIds: p1Blocked.map((t) => t.id),
        aiRecommendation: '项目管理员需立即召开紧急站会解耦依赖项。',
      });
    }

    // 3. Imminent tasks in next 24 hours
    const next24h = new Date(Date.now() + 86400000);
    const imminentTasks = this.data.tasks.filter((t) => {
      if (!t.dueDate || t.status === 'completed') return false;
      const d = new Date(t.dueDate);
      return d >= now && d <= next24h;
    });
    if (imminentTasks.length > 0) {
      warnings.push({
        id: 'warn-imminent',
        level: 'medium',
        type: 'imminent',
        title: `未来 24 小时内有 ${imminentTasks.length} 个任务即将到期`,
        description: imminentTasks.map((t) => `• ${t.title}`).join('\n'),
        relatedTaskIds: imminentTasks.map((t) => t.id),
        aiRecommendation: '保持专注模式 (Pomodoro)，优先关闭即将到期的依赖任务。',
      });
    }

    return warnings;
  }
}

export const sqliteStore = new SQLiteStore();
