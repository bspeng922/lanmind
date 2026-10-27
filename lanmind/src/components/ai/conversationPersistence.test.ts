/**
 * conversationPersistence.test.ts — AI 对话与局域网聊天会话持久化与恢复测试。
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
  clear() { this.map.clear(); }
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
  saveConversationConfig,
  getSavedConversationConfig,
  saveLastActiveAiConversationId,
  getLastActiveAiConversationId,
} = await import('./aiConversationConfig');

test('AI conversation config and active id persistence', () => {
  storage.clear();
  assert.equal(getLastActiveAiConversationId(), null);

  saveLastActiveAiConversationId('conv-123');
  assert.equal(getLastActiveAiConversationId(), 'conv-123');

  saveConversationConfig('conv-123', {
    mode: 'workspace',
    model: 'ollama:qwen2.5:latest',
    skills: ['code_review'],
    mcp: ['filesystem'],
    roots: ['d:/code/project'],
  });

  const saved = getSavedConversationConfig('conv-123');
  assert.notEqual(saved, null);
  assert.equal(saved?.mode, 'workspace');
  assert.equal(saved?.model, 'ollama:qwen2.5:latest');
  assert.deepEqual(saved?.skills, ['code_review']);
  assert.deepEqual(saved?.mcp, ['filesystem']);
  assert.deepEqual(saved?.roots, ['d:/code/project']);
});

test('LAN chat conversation reference serialization and recovery', () => {
  // Test user conversation
  const userConv = { kind: 'user', targetId: 'user-02' } as const;
  storage.setItem('lan-chat-active-conv', JSON.stringify(userConv));
  const recoveredUser = JSON.parse(storage.getItem('lan-chat-active-conv')!);
  assert.equal(recoveredUser.kind, 'user');
  assert.equal(recoveredUser.targetId, 'user-02');

  // Test group conversation
  const groupConv = { kind: 'group', targetId: 'group-proj-p1' } as const;
  storage.setItem('lan-chat-active-conv', JSON.stringify(groupConv));
  const recoveredGroup = JSON.parse(storage.getItem('lan-chat-active-conv')!);
  assert.equal(recoveredGroup.kind, 'group');
  assert.equal(recoveredGroup.targetId, 'group-proj-p1');

  // Test broadcast conversation
  const broadcastConv = { kind: 'broadcast' } as const;
  storage.setItem('lan-chat-active-conv', JSON.stringify(broadcastConv));
  const recoveredBroadcast = JSON.parse(storage.getItem('lan-chat-active-conv')!);
  assert.equal(recoveredBroadcast.kind, 'broadcast');

  // Test conversation switching flow
  const conversationKeyForTarget = (target: { type: string; user?: { id: string }; group?: { id: string } }) => {
    if (target.type === 'user') return `user:${target.user?.id}`;
    if (target.type === 'group') return `group:${target.group?.id}`;
    return 'broadcast';
  };

  let activeTarget: { type: string; user?: { id: string }; group?: { id: string } } = { type: 'group', group: { id: 'group-1' } };
  let currentKey = conversationKeyForTarget(activeTarget);
  assert.equal(currentKey, 'group:group-1');

  // Switch to user
  activeTarget = { type: 'user', user: { id: 'peer-cyber' } };
  currentKey = conversationKeyForTarget(activeTarget);
  assert.equal(currentKey, 'user:peer-cyber');

  // Switch to broadcast
  activeTarget = { type: 'broadcast' };
  currentKey = conversationKeyForTarget(activeTarget);
  assert.equal(currentKey, 'broadcast');
});

