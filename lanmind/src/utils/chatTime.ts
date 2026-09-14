/**
 * chatTime.ts — Pure deterministic timestamp normalization and display formatting for chat messages.
 *
 * CALLING SPEC:
 *   import { formatMessageDisplayTime, parseMessageEpoch } from './utils/chatTime';
 *
 *   // Format message header timestamp: "HH:mm" for today, "MM-DD HH:mm" for past days
 *   formatMessageDisplayTime("2026-09-14T03:28:44.727Z", "msg-1789356524727") -> "11:28"
 *   formatMessageDisplayTime("2026-09-07T01:30:49.733Z", "msg-1788744649733") -> "09-07 09:30"
 *   formatMessageDisplayTime("14:03", "msg-1785909784019")                     -> "08-05 14:03"
 *
 *   // Chronological sorting key
 *   parseMessageEpoch(message) -> number (epoch milliseconds)
 *
 * TOOL CONTRACT:
 *   - Input: timestamp string (ISO 8601, MM-DD HH:mm, or HH:mm) and optional message ID
 *   - Output: formatted string ("HH:mm" if sent on the same calendar day as `now`, else "MM-DD HH:mm")
 *   - Deterministic: pure function without hidden state; accepts optional `now` Date parameter for testing
 *   - Side effects: None
 */

import { LanChatMessage } from '../types';

/**
 * Normalizes heterogeneous message timestamps (ISO 8601, HH:mm, or msg-epoch ID)
 * to numeric epoch milliseconds for strict ascending chronological ordering.
 */
export const parseMessageEpoch = (msg: LanChatMessage): number => {
  if (msg.timestamp) {
    const trimmed = msg.timestamp.trim();
    // 1. ISO 8601 or standard date format with year
    const parsed = Date.parse(trimmed.replace(' ', 'T'));
    if (!isNaN(parsed) && parsed > 1000000000000) {
      return parsed;
    }
    // 2. Format already in "MM-DD HH:mm"
    const mdTimeMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
    if (mdTimeMatch) {
      const idMatch = msg.id ? msg.id.match(/^msg-(\d{10,13})/) : null;
      const year = idMatch ? new Date(parseInt(idMatch[1], 10)).getFullYear() : new Date().getFullYear();
      const month = parseInt(mdTimeMatch[1], 10) - 1;
      const day = parseInt(mdTimeMatch[2], 10);
      const hours = parseInt(mdTimeMatch[3], 10);
      const minutes = parseInt(mdTimeMatch[4], 10);
      return new Date(year, month, day, hours, minutes, 0, 0).getTime();
    }
    // 3. Time-only format (HH:mm or HH:mm:ss)
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      const idMatch = msg.id.match(/^msg-(\d{10,13})/);
      const baseDate = idMatch ? new Date(parseInt(idMatch[1], 10)) : new Date();
      baseDate.setHours(hours, minutes, seconds, 0);
      return baseDate.getTime();
    }
  }
  // 4. Fallback to extracting millisecond timestamp from message ID
  const idMatch = msg.id.match(/^msg-(\d{10,13})/);
  if (idMatch) {
    const idNum = parseInt(idMatch[1], 10);
    return idNum < 10000000000 ? idNum * 1000 : idNum;
  }
  return 0;
};

/**
 * User-friendly display format for message timestamp.
 * Displays "HH:mm" for today's messages, or "MM-DD HH:mm" for messages before today.
 */
export const formatMessageDisplayTime = (
  rawTimestamp?: string | null,
  messageId?: string | null,
  now = new Date(),
): string => {
  const trimmed = (rawTimestamp || '').trim();
  let messageDate: Date | null = null;
  let parsedTimeStr = '';

  // 1. Full standard date/time formats (ISO 8601, "YYYY-MM-DD HH:mm", etc.)
  if (trimmed) {
    const epoch = Date.parse(trimmed.replace(' ', 'T'));
    if (!isNaN(epoch) && epoch > 1000000000000) {
      messageDate = new Date(epoch);
    }
  }

  // 2. Format already in "MM-DD HH:mm"
  if (!messageDate && trimmed) {
    const mdTimeMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
    if (mdTimeMatch) {
      const month = parseInt(mdTimeMatch[1], 10) - 1;
      const day = parseInt(mdTimeMatch[2], 10);
      const hours = parseInt(mdTimeMatch[3], 10);
      const minutes = parseInt(mdTimeMatch[4], 10);
      messageDate = new Date(now.getFullYear(), month, day, hours, minutes, 0, 0);
    }
  }

  // 3. Time-only format (HH:mm or HH:mm:ss)
  if (!messageDate && trimmed) {
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      parsedTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

      // Check if messageId contains epoch milliseconds, e.g. "msg-1785909784019"
      const idMatch = messageId ? messageId.match(/^msg-(\d{10,13})/) : null;
      if (idMatch) {
        const idNum = parseInt(idMatch[1], 10);
        const epochMs = idNum < 10000000000 ? idNum * 1000 : idNum;
        messageDate = new Date(epochMs);
        messageDate.setHours(hours, minutes, seconds, 0);
      }
    }
  }

  // 4. If still no date, fallback to epoch in messageId
  if (!messageDate && messageId) {
    const idMatch = messageId.match(/^msg-(\d{10,13})/);
    if (idMatch) {
      const idNum = parseInt(idMatch[1], 10);
      const epochMs = idNum < 10000000000 ? idNum * 1000 : idNum;
      messageDate = new Date(epochMs);
    }
  }

  // If no date could be parsed:
  if (!messageDate) {
    if (parsedTimeStr) return parsedTimeStr;
    return trimmed;
  }

  const isToday =
    messageDate.getFullYear() === now.getFullYear() &&
    messageDate.getMonth() === now.getMonth() &&
    messageDate.getDate() === now.getDate();

  const hours = String(messageDate.getHours()).padStart(2, '0');
  const minutes = String(messageDate.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (isToday) {
    return timeStr;
  }

  const month = String(messageDate.getMonth() + 1).padStart(2, '0');
  const day = String(messageDate.getDate()).padStart(2, '0');
  return `${month}-${day} ${timeStr}`;
};
