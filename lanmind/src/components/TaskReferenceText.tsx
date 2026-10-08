import React from 'react';
import { marked } from 'marked';
import { taskIdFromLink } from '../utils/taskLinks';

export const TaskReferenceText: React.FC<{ value: string }> = ({ value }) => <span className="task-reference-text">{marked.Lexer.lexInline(value).map((token, index) => token.type === 'link' && taskIdFromLink(token.href)
  ? <a key={index} className="task-reference" href={token.href} title="查看任务详情">{token.text.replace(/^任务[：:]\s*/, '')}</a>
  : <React.Fragment key={index}>{token.raw}</React.Fragment>)}</span>;
