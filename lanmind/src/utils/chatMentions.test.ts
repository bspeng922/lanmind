import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMentionIds,
  isUserMentioned,
  detectMentionQuery,
  formatMentionInsertion,
  MENTION_ALL_TAG,
} from './chatMentions';
import { LanChatMessage, User } from '../types';

const mockUsers: User[] = [
  { id: 'usr-1', nickname: 'Alice', username: 'alice', deviceId: 'dev-1', role: 'admin', ip: '127.0.0.1', isOnline: true, lastActive: '2026-10-10T12:00:00Z' },
  { id: 'usr-2', nickname: 'Bob', username: 'bob', deviceId: 'dev-2', role: 'user', ip: '127.0.0.1', isOnline: true, lastActive: '2026-10-10T12:00:00Z' },
  { id: 'usr-3', nickname: 'Charlie', username: 'charlie', deviceId: 'dev-3', role: 'user', ip: '127.0.0.1', isOnline: false, lastActive: '2026-10-10T12:00:00Z' },
];

describe('chatMentions utils', () => {
  describe('extractMentionIds', () => {
    it('returns empty array when text has no @', () => {
      assert.deepEqual(extractMentionIds('Hello world', mockUsers), []);
    });

    it('extracts mentioned member by nickname', () => {
      assert.deepEqual(extractMentionIds('Hello @Bob please review', mockUsers), ['usr-2']);
    });

    it('extracts multiple mentioned members', () => {
      const ids = extractMentionIds('cc @Alice and @Bob thanks', mockUsers);
      assert.ok(ids.includes('usr-1'));
      assert.ok(ids.includes('usr-2'));
      assert.ok(!ids.includes('usr-3'));
    });

    it('extracts all members when @所有人 is used', () => {
      const ids = extractMentionIds(`Notice ${MENTION_ALL_TAG} please check`, mockUsers);
      assert.deepEqual(ids, ['usr-1', 'usr-2', 'usr-3']);
    });

    it('extracts all members when @all is used', () => {
      const ids = extractMentionIds('Hello @all team meeting at 3pm', mockUsers);
      assert.deepEqual(ids, ['usr-1', 'usr-2', 'usr-3']);
    });
  });

  describe('isUserMentioned', () => {
    const baseMsg: LanChatMessage = {
      id: 'm1',
      senderId: 'usr-1',
      senderName: 'Alice',
      groupId: 'grp-1',
      type: 'text',
      content: 'hello',
      timestamp: '2026-10-10T12:00:00Z',
    };

    it('returns false for own message', () => {
      assert.equal(isUserMentioned({ ...baseMsg, senderId: 'usr-2' }, 'usr-2', 'Bob'), false);
    });

    it('returns true when currentUserId is in mentions array', () => {
      assert.equal(isUserMentioned({ ...baseMsg, mentions: ['usr-2'] }, 'usr-2', 'Bob'), true);
    });

    it('returns true when group message content mentions nickname', () => {
      assert.equal(
        isUserMentioned({ ...baseMsg, content: 'Hey @Bob take a look' }, 'usr-2', 'Bob'),
        true
      );
    });

    it('returns true when group message content mentions @所有人', () => {
      assert.equal(
        isUserMentioned({ ...baseMsg, content: 'Notice @所有人 check this' }, 'usr-2', 'Bob'),
        true
      );
    });

    it('returns false when user is not mentioned', () => {
      assert.equal(
        isUserMentioned({ ...baseMsg, content: 'Hey @Alice check this' }, 'usr-2', 'Bob'),
        false
      );
    });
  });

  describe('detectMentionQuery', () => {
    it('detects mention at beginning of text', () => {
      const res = detectMentionQuery('@', 1);
      assert.deepEqual(res, { active: true, query: '', atIndex: 0 });
    });

    it('detects mention with partial query', () => {
      const res = detectMentionQuery('hello @Bo', 9);
      assert.deepEqual(res, { active: true, query: 'Bo', atIndex: 6 });
    });

    it('returns inactive when space follows @query', () => {
      const res = detectMentionQuery('hello @Bob how are you', 15);
      assert.equal(res.active, false);
    });

    it('returns inactive when @ is inside an email', () => {
      const res = detectMentionQuery('contact@example.com', 9);
      assert.equal(res.active, false);
    });
  });

  describe('formatMentionInsertion', () => {
    it('replaces active query with formatted mention and trailing space', () => {
      const text = 'hello @Bo world';
      const { newText, newCursor } = formatMentionInsertion(text, 9, 'Bob');
      assert.equal(newText, 'hello @Bob  world');
      assert.equal(newCursor, 11);
    });

    it('inserts mention when just @ is typed', () => {
      const text = '@';
      const { newText, newCursor } = formatMentionInsertion(text, 1, 'Bob');
      assert.equal(newText, '@Bob ');
      assert.equal(newCursor, 5);
    });
  });
});
