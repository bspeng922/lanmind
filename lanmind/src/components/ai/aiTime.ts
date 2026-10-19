/**
 * aiTime.ts — AI 对话的时间展示。
 *
 * CALLING SPEC:
 *   formatConversationAge(updatedAt)      -> "3 分钟前" / "3 min ago"
 *   formatMessageTimestamp(createdAt, id) -> "14:06"（当天）或 "09-07 09:30"
 *
 * TOOL CONTRACT:
 *   - 消息时间复用 chatTime 的 formatMessageDisplayTime，与局域网聊天保持一致。
 *   - 会话年龄走当前语言文案，避免用 Intl 直接产出未收录的措辞。
 *   - 纯函数，无副作用。
 */

import { tr } from '../../i18n';
import { formatMessageDisplayTime } from '../../utils/chatTime';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 侧栏列表使用的相对时间：今天以内用分钟 / 小时，更早用天数。 */
export const formatConversationAge = (updatedAt: string, now: Date = new Date()): string => {
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return '';
  const diff = now.getTime() - parsed;
  if (diff < 0) return tr('ai:time.justNow');
  if (diff < MINUTE) return tr('ai:time.justNow');
  if (diff < HOUR) return tr('ai:time.minutesAgo', { value0: Math.floor(diff / MINUTE) });
  if (diff < DAY) return tr('ai:time.hoursAgo', { value0: Math.floor(diff / HOUR) });
  if (diff < 2 * DAY) return tr('ai:time.yesterday');
  return tr('ai:time.daysAgo', { value0: Math.floor(diff / DAY) });
};

/** 消息行的时间。沿用聊天模块的规则：当天只显示时分。 */
export const formatMessageTimestamp = (createdAt: string, messageId?: string): string =>
  formatMessageDisplayTime(createdAt, messageId);
