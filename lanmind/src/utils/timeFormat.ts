/**
 * timeFormat — 统一时区与任务时间格式化纯函数工具。
 *
 * CALLING SPEC:
 *   import {
 *     formatTaskDateTime,
 *     formatTaskDate,
 *     getCurrentTimeInZone,
 *     getDeviceTimezone,
 *     COMMON_TIMEZONES,
 *     TimezoneOption,
 *   } from './utils/timeFormat';
 *
 *   // 1. 将 ISO 时间戳按指定时区或本地时区格式化为 YYYY-MM-DD HH:mm
 *   const display = formatTaskDateTime(task.createdAt, 'Asia/Shanghai'); // "2026-10-15 18:08"
 *
 *   // 2. 将 ISO 时间戳格式化为 YYYY-MM-DD
 *   const dateStr = formatTaskDate(task.updatedAt, 'Asia/Shanghai'); // "2026-10-15"
 *
 *   // 3. 获取指定时区下的当前时间字符串与偏移
 *   const nowStr = getCurrentTimeInZone('Asia/Shanghai'); // "18:08 (UTC+08:00)"
 *
 *   // 4. 获取当前浏览器/设备本地时区 IANA 名称
 *   const deviceZone = getDeviceTimezone(); // "Asia/Shanghai"
 *
 * TOOL CONTRACT:
 *   Input:  ISO 8601 字符串 (含 Z 或时区偏移) 与可选 IANA 时区字符串
 *   Output: 规范化的格式化时间文本
 *   Side effects: 无 (纯函数)
 *   Deterministic: 相同的时间与时区输入始终生成相同的输出
 */

export interface TimezoneOption {
  value: string;
  label: string;
  city: string;
  offset: string;
  region: string;
}

/** 常见全球代表性时区列表，按大洲与常用度排列 */
export const COMMON_TIMEZONES: TimezoneOption[] = [
  // 常用快捷 / 亚洲
  { value: 'Asia/Shanghai', label: '北京 / 上海时间 (UTC+08:00)', city: '北京/上海 (中国)', offset: 'UTC+08:00', region: '常用' },
  { value: 'Asia/Hong_Kong', label: '香港时间 (UTC+08:00)', city: '香港 (中国)', offset: 'UTC+08:00', region: '常用' },
  { value: 'Asia/Taipei', label: '台北时间 (UTC+08:00)', city: '台北 (中国台湾)', offset: 'UTC+08:00', region: '常用' },
  { value: 'Asia/Tokyo', label: '东京时间 (UTC+09:00)', city: '东京 (日本)', offset: 'UTC+09:00', region: '常用' },
  { value: 'Asia/Seoul', label: '首尔时间 (UTC+09:00)', city: '首尔 (韩国)', offset: 'UTC+09:00', region: '常用' },
  { value: 'Asia/Singapore', label: '新加坡时间 (UTC+08:00)', city: '新加坡', offset: 'UTC+08:00', region: '常用' },
  { value: 'Asia/Bangkok', label: '曼谷时间 (UTC+07:00)', city: '曼谷 (泰国)', offset: 'UTC+07:00', region: '亚洲' },
  { value: 'Asia/Dubai', label: '迪拜时间 (UTC+04:00)', city: '迪拜 (阿联酋)', offset: 'UTC+04:00', region: '亚洲' },
  { value: 'Asia/Kolkata', label: '印度时间 (UTC+05:30)', city: '加尔各答 (印度)', offset: 'UTC+05:30', region: '亚洲' },
  { value: 'Asia/Almaty', label: '阿拉木图时间 (UTC+05:00)', city: '阿拉木图 (哈萨克斯坦)', offset: 'UTC+05:00', region: '亚洲' },

  // 欧洲
  { value: 'Europe/London', label: '伦敦时间 (UTC+00:00 / +01:00)', city: '伦敦 (英国)', offset: 'UTC+00:00', region: '欧洲' },
  { value: 'Europe/Paris', label: '巴黎时间 (UTC+01:00 / +02:00)', city: '巴黎 (法国)', offset: 'UTC+01:00', region: '欧洲' },
  { value: 'Europe/Berlin', label: '柏林时间 (UTC+01:00 / +02:00)', city: '柏林 (德国)', offset: 'UTC+01:00', region: '欧洲' },
  { value: 'Europe/Moscow', label: '莫斯科时间 (UTC+03:00)', city: '莫斯科 (俄罗斯)', offset: 'UTC+03:00', region: '欧洲' },

  // 美洲
  { value: 'America/New_York', label: '纽约时间 - 东部时间 (UTC-05:00)', city: '纽约 (美国)', offset: 'UTC-05:00', region: '美洲' },
  { value: 'America/Chicago', label: '芝加哥时间 - 中部时间 (UTC-06:00)', city: '芝加哥 (美国)', offset: 'UTC-06:00', region: '美洲' },
  { value: 'America/Denver', label: '丹佛时间 - 山地时间 (UTC-07:00)', city: '丹佛 (美国)', offset: 'UTC-07:00', region: '美洲' },
  { value: 'America/Los_Angeles', label: '洛杉矶时间 - 太平洋时间 (UTC-08:00)', city: '洛杉矶 (美国)', offset: 'UTC-08:00', region: '美洲' },
  { value: 'America/Sao_Paulo', label: '圣保罗时间 (UTC-03:00)', city: '圣保罗 (巴西)', offset: 'UTC-03:00', region: '美洲' },

  // 大洋洲与太平洋
  { value: 'Australia/Sydney', label: '悉尼时间 (UTC+10:00 / +11:00)', city: '悉尼 (澳大利亚)', offset: 'UTC+10:00', region: '大洋洲' },
  { value: 'Pacific/Auckland', label: '奥克兰时间 (UTC+12:00 / +13:00)', city: '奥克兰 (新西兰)', offset: 'UTC+12:00', region: '大洋洲' },

  // UTC 标准
  { value: 'UTC', label: '协调世界时 (UTC)', city: 'UTC 零时区', offset: 'UTC+00:00', region: '标准' },
];

/** 获取本机时区标识 */
export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

/**
 * 格式化 ISO 时间字符串为 "YYYY-MM-DD HH:mm"。
 *
 * 优先使用指定 timezone；若无效或未提供，则自动使用本地系统时区。
 * 杜绝直接 slice(0, 16) 将 UTC 时间误当作本地时间展示的问题。
 */
export function formatTaskDateTime(
  isoString: string | null | undefined,
  timezone?: string | null
): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';

  const tz = timezone?.trim() || undefined;

  try {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    // 部分环境返回形式为 "2026/10/15 18:08"，统一转为 "2026-10-15 18:08"
    return formatter.format(date).replace(/\//g, '-');
  } catch {
    // 若指定的 timezone 非法，回退到本地时区解析
    try {
      const fallbackFormatter = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return fallbackFormatter.format(date).replace(/\//g, '-');
    } catch {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hour}:${minute}`;
    }
  }
}

/**
 * 格式化 ISO 时间字符串为 "YYYY-MM-DD"。
 */
export function formatTaskDate(
  isoString: string | null | undefined,
  timezone?: string | null
): string {
  if (!isoString) return '';
  const full = formatTaskDateTime(isoString, timezone);
  return full.slice(0, 10);
}

/**
 * 获取指定时区下的当前时间展示文本，例如 "18:08:30 (UTC+08:00)"
 */
export function getCurrentTimeInZone(timezone?: string | null): string {
  const now = new Date();
  const tz = timezone?.trim() || undefined;
  try {
    const timeStr = new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    const tzName = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || '';

    return `${timeStr} (${tzName || tz || '本地'})`;
  } catch {
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }
}
