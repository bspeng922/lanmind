/**
 * previewFixtures.tsx — 专用于生成 README 界面高清预览截图的真实场景组件。
 *
 * 包含：
 * 1. WikiPreviewFixture: 完整的 Wiki 知识库多级页面树与 Markdown 分栏实时预览
 * 2. WorkspaceSettingsPreviewFixture: 工作区设置与多层级组织架构树管理
 */

import React, { useEffect, useState } from 'react';
import { WikiView } from '../../src/components/wiki/WikiView';
import { WorkspaceSettingsPanel } from '../../src/components/workspace/WorkspaceSettingsPanel';
import { scopedStorageKey } from '../../src/utils/workspaceContext';
import { WIKI_STORAGE_KEY, getWikiStorageKey } from '../../src/components/wiki/wikiStore';
import type { LocalDirectory, User, Workspace } from '../../src/types';

export function WikiPreviewFixture() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const key = getWikiStorageKey('preview');
    const demoDocs = {
      version: 2,
      selectedId: 'doc-arch',
      expandedIds: ['doc-arch', 'doc-team'],
      documents: [
        {
          id: 'doc-arch',
          title: '🚀 智域协同技术架构与产品白皮书',
          icon: '🚀',
          tags: ['架构设计', '本地优先', '局域网P2P', '安全隔离'],
          content: `# 智域协同（LanMind）架构与设计规范

智域协同是一款面向团队办公、交付现场与隔离内网的**本地优先（Local-First）**去中心化协作平台。

## 核心架构原则

1. **零中心服务器依赖**：所有业务数据（任务、项目、Wiki 文档、聊天记录）均保存在本地 SQLite 数据库中，断网不影响正常使用。
2. **局域网多机 P2P 同步**：节点之间通过增量操作日志（Operation Log）进行状态对齐，支持离线编辑与重新上线对齐。
3. **工作区强隔离**：跨组织与跨业务环境逻辑物理双重隔离，防止机密信息意外越权。
4. **多模型智能体融合**：深度集成私有化大语言模型（Ollama / vLLM / SGLang）及 OpenAI 兼容接口，赋能智能助手与自主 Agent。

### 模块拓扑关系

| 模块名称 | 运行环境 | 数据存储 | 同步策略 |
| :--- | :--- | :--- | :--- |
| **Wiki 知识库** | Desktop / Web | Local SQLite | CRDT / OpLog 增量同步 |
| **任务卡片** | Desktop | Local SQLite | 局域网 P2P 向量时钟 |
| **AI 智能体** | Desktop Agent | 本地会话隔离 | 私有化不上传 |
| **光学传输** | WebAssembly | 内存流式 | 离线屏幕动态码恢复 |

> [!NOTE]
> 知识库支持 Markdown 实时解析、历史版本对比、多级父子页面嵌套与双向链接引用。
`,
          parentId: null,
          sortOrder: 1,
          favorite: true,
          projectId: 'theme-project',
          isLocked: false,
          createdBy: 'local-user@desktop',
          createdByName: '系统架构师',
          updatedBy: 'local-user@desktop',
          updatedByName: '系统架构师',
          createdAt: '2026-10-12T09:00:00Z',
          updatedAt: '2026-10-21T15:30:00Z',
        },
        {
          id: 'doc-sync',
          title: '局域网 P2P 增量同步协议详解',
          icon: '⚡',
          tags: ['通信协议', 'P2P'],
          content: '详细描述局域网节点组播发现、增量时钟对齐与冲突仲裁机制...',
          parentId: 'doc-arch',
          sortOrder: 1,
          favorite: false,
          projectId: 'theme-project',
          createdAt: '2026-10-15T10:00:00Z',
          updatedAt: '2026-10-20T11:00:00Z',
        },
        {
          id: 'doc-security',
          title: '离线安全防护与物理隔离传输',
          icon: '🛡️',
          tags: ['安全规范', '物理隔离'],
          content: '描述屏幕到摄像头的动态二维码传输与 RaptorQ 前向纠错原理...',
          parentId: 'doc-arch',
          sortOrder: 2,
          favorite: false,
          projectId: null,
          createdAt: '2026-10-16T14:00:00Z',
          updatedAt: '2026-10-19T16:00:00Z',
        },
        {
          id: 'doc-team',
          title: '📖 团队协同与任务交付规范',
          icon: '📖',
          tags: ['团队规范'],
          content: '团队日常基于卡片看板流转与汇报沉淀的标准化作业流程...',
          parentId: null,
          sortOrder: 2,
          favorite: true,
          projectId: null,
          createdAt: '2026-10-10T08:00:00Z',
          updatedAt: '2026-10-18T17:00:00Z',
        },
        {
          id: 'doc-ai',
          title: '🤖 多模型与本地私有化 Agent 接入指南',
          icon: '🤖',
          tags: ['大模型', 'Agent'],
          content: '支持本地 Ollama、GPU vLLM 及 MCP 外部工具生态接入...',
          parentId: null,
          sortOrder: 3,
          favorite: false,
          projectId: null,
          createdAt: '2026-10-18T09:00:00Z',
          updatedAt: '2026-10-21T10:00:00Z',
        },
      ],
    };
    localStorage.setItem(key, JSON.stringify(demoDocs));
    setReady(true);
  }, []);

  if (!ready) return null;
  return (
    <div className="flex h-screen w-screen flex-col bg-canvas text-main">
      <WikiView workspaceId="preview" />
    </div>
  );
}

export function WorkspaceSettingsPreviewFixture({ user, peer }: { user: User; peer: User }) {
  const [workspace, setWorkspace] = useState<Workspace>({
    id: 'ws-main',
    name: '智域协同核心研发工作区',
    description: '负责跨平台客户端、局域网 P2P 同步内核与多模型自主智能体的研发与协同',
    ownerId: user.id,
    timezone: 'Asia/Shanghai',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-10-21T12:00:00Z',
  });

  const [localDir, setLocalDir] = useState<LocalDirectory>({
    units: [
      { id: 'u-rd', name: '研发中心', parentId: null, sortOrder: 1 },
      { id: 'u-client', name: '桌面客户端组', parentId: 'u-rd', sortOrder: 1 },
      { id: 'u-ai', name: 'AI 与智能体内核组', parentId: 'u-rd', sortOrder: 2 },
      { id: 'u-qa', name: '安全与质量交付组', parentId: 'u-rd', sortOrder: 3 },
    ],
    members: [
      { userId: user.id, unitId: 'u-client', jobTitle: '架构师 / 前端负责人', sortOrder: 1 },
      { userId: peer.id, unitId: 'u-ai', jobTitle: 'AI 智能体算法专家', sortOrder: 2 },
      { userId: 'user-rust', unitId: 'u-client', jobTitle: 'Rust 内核开发工程师', sortOrder: 3 },
      { userId: 'user-sec', unitId: 'u-qa', jobTitle: '网络安全与离线传输测试', sortOrder: 4 },
    ],
  });

  const mockUsers: User[] = [
    user,
    peer,
    { id: 'user-rust', username: 'rust_dev', nickname: '李工-Rust内核', role: 'user', isOnline: true, deviceId: 'dev-2', ip: '192.168.1.109', lastActive: '' },
    { id: 'user-sec', username: 'sec_dev', nickname: '孙工-安全工程', role: 'user', isOnline: false, deviceId: 'dev-3', ip: '192.168.1.110', lastActive: '' },
  ];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black/60 p-6">
      <div className="flex h-full max-h-[820px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 font-bold">
              WS
            </div>
            <div>
              <h2 className="text-base font-semibold text-main">工作区设置与组织架构</h2>
              <p className="text-xs text-sub">管理多工作区隔离、成员权限、本地组织层级与网络安全伺服</p>
            </div>
          </div>
          <button className="rounded-lg p-1.5 text-sub hover:bg-elevated hover:text-main">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <WorkspaceSettingsPanel
            workspace={workspace}
            users={mockUsers}
            currentUser={user}
            onWorkspaceUpdated={setWorkspace}
            localDirectory={localDir}
            onLocalDirectoryChange={setLocalDir}
          />
        </div>
      </div>
    </div>
  );
}
