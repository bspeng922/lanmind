import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMessageDisplayTime, parseMessageEpoch } from './chatTime';
import { LanChatMessage } from '../types';

test('formatMessageDisplayTime returns HH:mm for messages sent today', () => {
  const fixedNow = new Date('2026-09-14T11:32:00');

  // Message sent earlier today via ISO string
  const todayIso = new Date('2026-09-14T10:15:00').toISOString();
  assert.equal(formatMessageDisplayTime(todayIso, 'msg-today-1', fixedNow), '10:15');

  // Message sent today with time-only timestamp and today's epoch id
  const todayEpoch = new Date('2026-09-14T11:28:00').getTime();
  assert.equal(formatMessageDisplayTime('11:28', `msg-${todayEpoch}`, fixedNow), '11:28');
});

test('formatMessageDisplayTime returns MM-DD HH:mm for messages before today', () => {
  const fixedNow = new Date('2026-09-14T11:32:00');

  // 1. Message from September 7
  const sep7Iso = new Date('2026-09-07T09:30:00').toISOString();
  assert.equal(formatMessageDisplayTime(sep7Iso, 'msg-sep7', fixedNow), '09-07 09:30');

  // 2. Historical message with time-only "14:03" and August 5 epoch in message ID
  const aug5Date = new Date('2026-08-05T14:03:00');
  const aug5Id = `msg-${aug5Date.getTime()}`;
  assert.equal(formatMessageDisplayTime('14:03', aug5Id, fixedNow), '08-05 14:03');

  // 3. Historical message with time-only "18:41" and September 6 epoch in message ID
  const sep6Date = new Date('2026-09-06T18:41:00');
  const sep6Id = `msg-${sep6Date.getTime()}`;
  assert.equal(formatMessageDisplayTime('18:41', sep6Id, fixedNow), '09-06 18:41');

  // 4. Message already formatted with "MM-DD HH:mm"
  assert.equal(formatMessageDisplayTime('09-07 09:30', 'msg-123', fixedNow), '09-07 09:30');
});

test('parseMessageEpoch accurately parses and sorts messages chronologically', () => {
  const tAug5 = new Date('2026-08-05T14:03:00').getTime();
  const tSep6 = new Date('2026-09-06T18:41:00').getTime();
  const tSep7 = new Date('2026-09-07T09:30:00').getTime();
  const tSep14 = new Date('2026-09-14T11:28:00').getTime();

  const messages: LanChatMessage[] = [
    {
      id: `msg-${tSep14}`,
      senderId: 'u1',
      senderName: 'moose',
      content: '你是谁',
      type: 'text',
      timestamp: new Date('2026-09-14T11:28:00').toISOString(),
    },
    {
      id: `msg-${tAug5}`,
      senderId: 'u1',
      senderName: 'moose',
      content: '你是谁？',
      type: 'text',
      timestamp: '14:03',
    },
    {
      id: `msg-${tSep7}`,
      senderId: 'u1',
      senderName: 'moose',
      content: 'test',
      type: 'text',
      timestamp: '09-07 09:30',
    },
    {
      id: `msg-${tSep6}`,
      senderId: 'u1',
      senderName: 'moose',
      content: '👍',
      type: 'text',
      timestamp: '18:41',
    },
  ];

  const sorted = [...messages].sort((a, b) => parseMessageEpoch(a) - parseMessageEpoch(b));

  assert.equal(sorted[0].content, '你是谁？'); // Aug 5
  assert.equal(sorted[1].content, '👍');       // Sep 6
  assert.equal(sorted[2].content, 'test');     // Sep 7
  assert.equal(sorted[3].content, '你是谁');   // Sep 14
});
