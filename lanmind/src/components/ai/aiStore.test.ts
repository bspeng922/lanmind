import { scopedStorageKey } from "../../utils/workspaceContext";
/**
 * aiStore.test.ts — AI 对话存储的迁移、持久化与订阅行为。
 *
 * CALLING SPEC:
 *   npm run test:ai
 *
 * TOOL CONTRACT:
 *   - 在导入被测量模块前安装 localStorage 桩，因此不依赖浏览器环境。
 *   - 只断言存储层契约（键名、迁移结果、排序、搜索），不涉及 React 渲染。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
  get length() { return this.map.size; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
(globalThis as unknown as { window: unknown }).window = {
  isSecureContext: false,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const {
  appendMessage,
  createConversation,
  deleteConversation,
  editUserMessageAndTruncateAfter,
  getConversationSummaries,
  getConversationSummary,
  getMessages,
  patchMessage,
  migrateIndex,
  renameConversation,
  reloadAIConversations,
  retitleFromFirstUserMessage,
  searchConversations,
  togglePinned,
  deriveTitleFromMessage,
  SEARCH_RESULT_LIMIT,
} = await import('./aiStore');

const INDEX_KEY = scopedStorageKey('lanmind_ai_conversations_v1');
const messagesKey = (id: string) => scopedStorageKey('lanmind_ai_messages_v1:') + id;

/** 清空本机记录目录，让每个用例从空状态开始。 */
const clearAll = () => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
  reloadAIConversations();
};

test('deriveTitleFromMessage collapses the first meaningful line', () => {
  assert.equal(deriveTitleFromMessage('# 周报草稿\n正文', '未命名'), '周报草稿');
  assert.equal(deriveTitleFromMessage('   ', '未命名'), '未命名');
  const long = deriveTitleFromMessage('甲'.repeat(80), '未命名');
  assert.equal(long.length, 41);
  assert.ok(long.endsWith('…'));
});

test('migrateIndex upgrades a legacy bare array instead of dropping it', () => {
  const migrated = migrateIndex([
    { id: 'legacy-1', title: '旧会话', updatedAt: '2026-01-02T03:04:05.000Z' },
  ]);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].title, '旧会话');
  assert.equal(migrated[0].pinned, false);
  assert.equal(migrated[0].titleLocked, false);
  assert.equal(migrated[0].messageCount, 0);
  // 缺少 createdAt 时回退到已有的 updatedAt 语义之外，但必须仍是可解析的时间。
  assert.ok(!Number.isNaN(Date.parse(migrated[0].createdAt)));
  assert.equal(migrated[0].updatedAt, '2026-01-02T03:04:05.000Z');
});

test('migrateIndex drops only the unusable records', () => {
  const mixed = migrateIndex({
    version: 1,
    conversations: [null, { id: '' }, { id: 'ok' }, { id: 'ok' }, 42],
  });
  assert.deepEqual(mixed.map((item) => item.id), ['ok']);
});

test('migrateIndex tolerates garbage input', () => {
  assert.deepEqual(migrateIndex('nonsense'), []);
  assert.deepEqual(migrateIndex(null), []);
  assert.deepEqual(migrateIndex({ conversations: 'not-an-array' }), []);
});

test('first launch is empty and does not seed sample data', () => {
  clearAll();
  assert.deepEqual(getConversationSummaries(), []);
  // 空状态只是读取，不会写入任何键。
  assert.equal(storage.getItem(INDEX_KEY), null);
});

test('messages survive a reload through localStorage', () => {
  clearAll();
  const conversation = createConversation('');
  appendMessage(conversation.id, { role: 'user', content: '梳理当前逾期与高风险工作项' });
  appendMessage(conversation.id, { role: 'assistant', content: '# 结论\n\n共 3 项逾期。' });
  retitleFromFirstUserMessage(conversation.id, '未命名对话');

  assert.ok(storage.getItem(INDEX_KEY));
  assert.equal(JSON.parse(storage.getItem(messagesKey(conversation.id))!).length, 2);
  assert.equal(getConversationSummary(conversation.id)!.messageCount, 2);

  // 模拟重启：丢弃内存缓存后重新从存储读取。
  reloadAIConversations();
  assert.equal(getMessages(conversation.id).length, 2);
  assert.equal(getConversationSummary(conversation.id)!.title, '梳理当前逾期与高风险工作项');
});

test('a manual rename is never overwritten by auto-titling', () => {
  clearAll();
  const conversation = createConversation('');
  appendMessage(conversation.id, { role: 'user', content: '第一条问题' });
  retitleFromFirstUserMessage(conversation.id, '未命名对话');
  renameConversation(conversation.id, '手动命名');
  appendMessage(conversation.id, { role: 'user', content: '第二条问题' });
  retitleFromFirstUserMessage(conversation.id, '未命名对话');

  const summary = getConversationSummary(conversation.id)!;
  assert.equal(summary.title, '手动命名');
  assert.equal(summary.titleLocked, true);
});

test('search spans titles and user message bodies', () => {
  clearAll();
  const conversation = createConversation('复盘会议');
  appendMessage(conversation.id, { role: 'user', content: '关于局域网同步的疑问' });
  appendMessage(conversation.id, { role: 'assistant', content: '局域网同步为增量同步。' });

  const titleHit = searchConversations('复盘')[0];
  assert.equal(titleHit.scope, 'title');

  const messageHit = searchConversations('局域网')[0];
  assert.equal(messageHit.scope, 'message');
  assert.match(messageHit.snippet, /局域网同步/);

  assert.deepEqual(searchConversations('   '), []);
  assert.equal(searchConversations('不存在的关键词').length, 0);
});

test('pinned conversations float above more recent ones', () => {
  clearAll();
  const older = createConversation('较早');
  const newer = createConversation('较新');
  // 显式错开更新时间，避免依赖同一毫秒内的创建顺序。
  appendMessage(newer.id, { role: 'user', content: '更晚的更新' });

  const beforePin = getConversationSummaries();
  assert.equal(beforePin[0].id, newer.id);

  togglePinned(older.id);
  const ids = getConversationSummaries().map((item) => item.id);
  assert.equal(ids[0], older.id);
  assert.ok(ids.indexOf(newer.id) > 0);

  // 取消置顶后回到按更新时间排序，最新的一条重新排在最前。
  togglePinned(older.id);
  assert.equal(getConversationSummaries()[0].id, newer.id);
});

test('sorting is a total order even when timestamps collide', () => {
  clearAll();
  const created = [createConversation('甲'), createConversation('乙'), createConversation('丙')];
  const first = getConversationSummaries().map((item) => item.id);
  const second = getConversationSummaries().map((item) => item.id);
  assert.deepEqual(second, first);
  assert.equal(new Set(first).size, created.length);
});

test('deleting a conversation clears both the index and the message payload', () => {
  clearAll();
  const conversation = createConversation('待删除');
  appendMessage(conversation.id, { role: 'user', content: '临时内容' });
  deleteConversation(conversation.id);
  assert.equal(getConversationSummary(conversation.id), null);
  assert.equal(storage.getItem(messagesKey(conversation.id)), null);
});

test('a storage write failure leaves the in-memory session usable', () => {
  clearAll();
  const conversation = createConversation('配额受限');
  const original = storage.setItem.bind(storage);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    appendMessage(conversation.id, { role: 'user', content: '仍然可用' });
  } finally {
    storage.setItem = original;
  }
  assert.equal(getMessages(conversation.id).length, 1);
});

test('search result count is bounded', () => {
  clearAll();
  for (let index = 0; index < SEARCH_RESULT_LIMIT + 5; index += 1) {
    const conversation = createConversation(`命中关键词 ${index}`);
    void conversation;
  }
  assert.equal(searchConversations('命中关键词').length, SEARCH_RESULT_LIMIT);
});

test('patchMessage supports in-memory streaming and persisted completion', () => {
  clearAll();
  const conv = createConversation('流式测试');
  const msg = appendMessage(conv.id, { role: 'assistant', content: '' });

  // Stream in memory without touching disk every chunk
  patchMessage(conv.id, msg.id, { content: '部分输出' }, false);
  assert.equal(getMessages(conv.id)[0].content, '部分输出');

  // Stream completes and persists
  patchMessage(conv.id, msg.id, { content: '完整流式输出' }, true);
  assert.equal(getMessages(conv.id)[0].content, '完整流式输出');
  const disk = JSON.parse(storage.getItem(messagesKey(conv.id)) || '[]');
  assert.equal(disk[0].content, '完整流式输出');
});

test('editUserMessageAndTruncateAfter updates message content and discards subsequent messages', () => {
  clearAll();
  const conv = createConversation('编辑测试');
  const user1 = appendMessage(conv.id, { role: 'user', content: '原始提问' });
  appendMessage(conv.id, { role: 'assistant', content: '原始回答' });
  appendMessage(conv.id, { role: 'user', content: '追问' });
  appendMessage(conv.id, { role: 'assistant', content: '追问回答' });

  assert.equal(getMessages(conv.id).length, 4);

  const updatedList = editUserMessageAndTruncateAfter(conv.id, user1.id, '修改后的提问');
  assert.equal(updatedList.length, 1);
  assert.equal(updatedList[0].id, user1.id);
  assert.equal(updatedList[0].content, '修改后的提问');

  const disk = JSON.parse(storage.getItem(messagesKey(conv.id)) || '[]');
  assert.equal(disk.length, 1);
  assert.equal(disk[0].content, '修改后的提问');

  const summary = getConversationSummary(conv.id);
  assert.equal(summary?.messageCount, 1);
});
