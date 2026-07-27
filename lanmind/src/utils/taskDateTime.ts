const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/;

export function splitTaskDueDate(value: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!value) return { date: '', time: '' };
  const match = value.match(DATE_TIME_PATTERN);
  if (!match) return { date: '', time: '' };
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: match[4] && match[5] ? `${match[4]}:${match[5]}` : '',
  };
}

export function combineTaskDueDate(date: string, time: string): string | null {
  if (!date) return null;
  return time ? `${date}T${time}` : date;
}

export function parseTaskDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = value.match(DATE_TIME_PATTERN);
  if (!match) return null;
  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0)
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatLocalTaskDateTime(date: Date, includeTime = true): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const datePart = `${year}-${month}-${day}`;
  if (!includeTime) return datePart;
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${datePart}T${hour}:${minute}`;
}

export function formatTaskDueDate(value: string | null | undefined): string {
  const parts = splitTaskDueDate(value);
  if (!parts.date) return '';
  return parts.time ? `${parts.date} ${parts.time}` : parts.date;
}

export function calculateReminderTime(
  dueDate: string | null | undefined,
  minutesBefore: number | null
): string | null {
  if (minutesBefore === null) return null;
  const due = parseTaskDateTime(dueDate);
  if (!due || !splitTaskDueDate(dueDate).time) return null;
  return formatLocalTaskDateTime(new Date(due.getTime() - minutesBefore * 60_000));
}

export function inferReminderMinutes(
  dueDate: string | null | undefined,
  reminderTime: string | null | undefined
): number | null {
  const due = parseTaskDateTime(dueDate);
  const reminder = parseTaskDateTime(reminderTime);
  if (!due || !reminder) return null;
  const minutes = Math.round((due.getTime() - reminder.getTime()) / 60_000);
  return minutes >= 0 ? minutes : null;
}
