import test from 'node:test';
import assert from 'node:assert/strict';
import { aiConversationIdFromLink } from './aiLinks';
import { setWorkspaceContext } from '../../utils/workspaceContext';

test('aiConversationIdFromLink parses lanmind deep link', () => {
  setWorkspaceContext({ workspaceId: 'ws-123', userId: 'user-1', revision: 1 });
  assert.equal(
    aiConversationIdFromLink('lanmind://ai/conv-456?workspace=ws-123'),
    'conv-456',
  );
  assert.equal(
    aiConversationIdFromLink('lanmind://ai/conv-456'),
    'conv-456',
  );
  assert.equal(
    aiConversationIdFromLink('lanmind://ai/conv-456?workspace=other-ws'),
    null,
  );
});

test('aiConversationIdFromLink parses web share URL hash', () => {
  setWorkspaceContext({ workspaceId: 'ws-123', userId: 'user-1', revision: 1 });
  assert.equal(
    aiConversationIdFromLink('http://192.168.1.10:3000/?workspace=ws-123#/ai/conv-789'),
    'conv-789',
  );
  assert.equal(
    aiConversationIdFromLink('https://example.com/#/ai/conv-789'),
    'conv-789',
  );
  assert.equal(
    aiConversationIdFromLink('http://localhost:3000/?workspace=other#/ai/conv-789'),
    null,
  );
});

test('aiConversationIdFromLink returns null for invalid links', () => {
  assert.equal(aiConversationIdFromLink('invalid-string'), null);
  assert.equal(aiConversationIdFromLink('lanmind://wiki/page-1'), null);
  assert.equal(aiConversationIdFromLink('http://localhost:3000/#/wiki/page-1'), null);
});
