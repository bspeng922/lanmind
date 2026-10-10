/**
 * ChatMessageText — Renders chat message text with highlighted @mentions and task links.
 *
 * CALLING SPEC:
 *   <ChatMessageText
 *     content={message.content}
 *     currentUserId={currentUser.id}
 *     currentUserNickname={currentUser.nickname}
 *     currentUserUsername={currentUser.username}
 *   />
 */

import React from 'react';
import { TaskReferenceText } from './TaskReferenceText';

interface ChatMessageTextProps {
  content: string;
  currentUserId: string;
  currentUserNickname?: string;
  currentUserUsername?: string;
}

export const ChatMessageText: React.FC<ChatMessageTextProps> = ({
  content,
  currentUserNickname,
  currentUserUsername,
}) => {
  if (!content || !content.includes('@')) {
    return <TaskReferenceText value={content} />;
  }

  // Regex to match @mentions: @所有人, @all, or @[word/characters up to space/punctuation]
  // In Chinese or English: @[\u4e00-\u9fa5a-zA-Z0-9_\-\.]+
  const mentionRegex = /(@所有人|@all|@[\u4e00-\u9fa5a-zA-Z0-9_\-\.]+)/g;

  const parts = content.split(mentionRegex);

  return (
    <span>
      {parts.map((part, index) => {
        if (!part) return null;

        if (part.startsWith('@')) {
          const mentionName = part.slice(1);
          const isAll = part === '@所有人' || part.toLowerCase() === '@all';
          const isMe =
            (currentUserNickname && mentionName === currentUserNickname) ||
            (currentUserUsername && mentionName === currentUserUsername);

          if (isAll || isMe) {
            return (
              <span
                key={index}
                className="inline-flex items-center rounded bg-amber-500/20 text-warning font-bold px-1 py-0.5 mx-0.5 text-[11px] align-baseline border border-amber-500/30"
              >
                {part}
              </span>
            );
          }

          return (
            <span
              key={index}
              className="inline-flex items-center rounded bg-primary/10 text-primary font-semibold px-1 py-0.5 mx-0.5 text-[11px] align-baseline border border-primary/20"
            >
              {part}
            </span>
          );
        }

        return <TaskReferenceText key={index} value={part} />;
      })}
    </span>
  );
};
