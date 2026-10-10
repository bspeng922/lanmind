/**
 * chatMentions — Pure utility functions for chat @mention parsing, extraction, and detection.
 *
 * CALLING SPEC:
 *   import {
 *     extractMentionIds,
 *     isUserMentioned,
 *     detectMentionQuery,
 *     formatMentionInsertion,
 *   } from '../utils/chatMentions';
 *
 *   // Extract all user IDs mentioned in a message
 *   const ids = extractMentionIds(text, members);
 *
 *   // Check if the current user was mentioned in a message
 *   const isMentioned = isUserMentioned(message, currentUserId, nickname);
 *
 *   // Detect if cursor is currently typing a mention
 *   const { active, query, atIndex } = detectMentionQuery(inputText, cursorPosition);
 *
 *   // Format text after selecting a mention from the picker
 *   const { newText, newCursor } = formatMentionInsertion(inputText, cursorPosition, memberNickname);
 */

import { LanChatMessage, User } from '../types';

export const MENTION_ALL_TAG = '@所有人';
export const MENTION_ALL_ID = '__ALL__';

/**
 * Extracts all mentioned user IDs from a message's text based on group members.
 * Supports individual user mentions (@Nickname, @username) and @所有人 (@all).
 */
export function extractMentionIds(text: string, groupMembers: User[]): string[] {
  if (!text || !text.includes('@')) return [];

  const mentionedIds = new Set<string>();

  // Check for @所有人 or @all
  const hasMentionAll =
    text.includes(MENTION_ALL_TAG) ||
    /(?:^|\s)@all(?:\s|$)/i.test(text);

  if (hasMentionAll) {
    for (const member of groupMembers) {
      mentionedIds.add(member.id);
    }
    return Array.from(mentionedIds);
  }

  // Check each member's nickname or username
  for (const member of groupMembers) {
    if (member.nickname && text.includes(`@${member.nickname}`)) {
      mentionedIds.add(member.id);
    } else if (member.username && text.includes(`@${member.username}`)) {
      mentionedIds.add(member.id);
    }
  }

  return Array.from(mentionedIds);
}

/**
 * Checks whether the current user is mentioned in a given chat message.
 */
export function isUserMentioned(
  message: LanChatMessage,
  currentUserId: string,
  currentUserNickname?: string,
  currentUserUsername?: string
): boolean {
  if (!message || message.senderId === currentUserId) return false;

  // 1. Explicit mentions array
  if (Array.isArray(message.mentions) && message.mentions.includes(currentUserId)) {
    return true;
  }

  // 2. Only check group messages for text-based mention fallbacks
  if (!message.groupId || !message.content || !message.content.includes('@')) {
    return false;
  }

  // 3. Check @所有人 or @all
  if (
    message.content.includes(MENTION_ALL_TAG) ||
    /(?:^|\s)@all(?:\s|$)/i.test(message.content)
  ) {
    return true;
  }

  // 4. Check @Nickname
  if (currentUserNickname && message.content.includes(`@${currentUserNickname}`)) {
    return true;
  }

  // 5. Check @Username
  if (currentUserUsername && message.content.includes(`@${currentUserUsername}`)) {
    return true;
  }

  return false;
}

/**
 * Detects if the caret is currently in the middle of typing an @mention.
 * Returns the query string after '@' and the index of '@'.
 */
export function detectMentionQuery(
  text: string,
  cursorIndex: number
): { active: boolean; query: string; atIndex: number } {
  if (cursorIndex <= 0 || cursorIndex > text.length) {
    return { active: false, query: '', atIndex: -1 };
  }

  const textBeforeCursor = text.slice(0, cursorIndex);
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');

  if (lastAtIndex === -1) {
    return { active: false, query: '', atIndex: -1 };
  }

  // Ensure '@' is either at the beginning or preceded by whitespace/punctuation
  if (lastAtIndex > 0) {
    const charBeforeAt = textBeforeCursor[lastAtIndex - 1];
    if (charBeforeAt && !/[\s\n\r\t,;:!?()[\]{}]/.test(charBeforeAt)) {
      return { active: false, query: '', atIndex: -1 };
    }
  }

  const query = textBeforeCursor.slice(lastAtIndex + 1);

  // If query contains whitespace or newlines, the user is no longer actively typing this mention
  if (/[\s\n\r]/.test(query)) {
    return { active: false, query: '', atIndex: -1 };
  }

  return {
    active: true,
    query,
    atIndex: lastAtIndex,
  };
}

/**
 * Replaces the current mention query with `@${targetName} ` and returns the new text and cursor position.
 */
export function formatMentionInsertion(
  text: string,
  cursorIndex: number,
  targetName: string
): { newText: string; newCursor: number } {
  const { active, atIndex } = detectMentionQuery(text, cursorIndex);
  const mentionText = `@${targetName} `;

  if (!active || atIndex === -1) {
    // Fallback: append or insert directly at cursor
    const before = text.slice(0, cursorIndex);
    const after = text.slice(cursorIndex);
    return {
      newText: `${before}${mentionText}${after}`,
      newCursor: cursorIndex + mentionText.length,
    };
  }

  const before = text.slice(0, atIndex);
  const after = text.slice(cursorIndex);
  const newText = `${before}${mentionText}${after}`;
  const newCursor = atIndex + mentionText.length;

  return { newText, newCursor };
}
