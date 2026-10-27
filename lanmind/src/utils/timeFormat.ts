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

interface RawTimezoneDefinition {
  value: string;
  offset: string;
  region: 'common' | 'asia' | 'europe' | 'americas' | 'oceania' | 'africa' | 'standard';
  cityZh: string;
  cityEn: string;
  labelZh: string;
  labelEn: string;
}

const REGION_NAMES: Record<string, { zh: string; en: string }> = {
  common: { zh: '常用', en: 'Common' },
  asia: { zh: '亚洲', en: 'Asia' },
  europe: { zh: '欧洲', en: 'Europe' },
  americas: { zh: '美洲', en: 'Americas' },
  oceania: { zh: '大洋洲', en: 'Oceania' },
  africa: { zh: '非洲', en: 'Africa' },
  standard: { zh: '标准', en: 'Standard' },
};

export const TIMEZONE_DEFINITIONS: RawTimezoneDefinition[] = [
  // 常用快捷 (Common)
  { value: 'Asia/Shanghai', offset: 'UTC+08:00', region: 'common', cityZh: '北京 / 上海 (中国)', cityEn: 'Beijing / Shanghai (China)', labelZh: '北京 / 上海时间 (UTC+08:00)', labelEn: 'Beijing / Shanghai (UTC+08:00)' },
  { value: 'Asia/Hong_Kong', offset: 'UTC+08:00', region: 'common', cityZh: '香港 (中国)', cityEn: 'Hong Kong (China)', labelZh: '香港时间 (UTC+08:00)', labelEn: 'Hong Kong (UTC+08:00)' },
  { value: 'Asia/Taipei', offset: 'UTC+08:00', region: 'common', cityZh: '台北 (中国台湾)', cityEn: 'Taipei (Taiwan)', labelZh: '台北时间 (UTC+08:00)', labelEn: 'Taipei (UTC+08:00)' },
  { value: 'Asia/Tokyo', offset: 'UTC+09:00', region: 'common', cityZh: '东京 (日本)', cityEn: 'Tokyo (Japan)', labelZh: '东京时间 (UTC+09:00)', labelEn: 'Tokyo (UTC+09:00)' },
  { value: 'Asia/Seoul', offset: 'UTC+09:00', region: 'common', cityZh: '首尔 (韩国)', cityEn: 'Seoul (South Korea)', labelZh: '首尔时间 (UTC+09:00)', labelEn: 'Seoul (UTC+09:00)' },
  { value: 'Asia/Singapore', offset: 'UTC+08:00', region: 'common', cityZh: '新加坡', cityEn: 'Singapore', labelZh: '新加坡时间 (UTC+08:00)', labelEn: 'Singapore (UTC+08:00)' },
  { value: 'Europe/London', offset: 'UTC+00:00', region: 'common', cityZh: '伦敦 (英国)', cityEn: 'London (UK)', labelZh: '伦敦时间 (UTC+00:00)', labelEn: 'London (UTC+00:00)' },
  { value: 'Europe/Paris', offset: 'UTC+01:00', region: 'common', cityZh: '巴黎 (法国)', cityEn: 'Paris (France)', labelZh: '巴黎时间 (UTC+01:00)', labelEn: 'Paris (UTC+01:00)' },
  { value: 'Europe/Berlin', offset: 'UTC+01:00', region: 'common', cityZh: '柏林 (德国)', cityEn: 'Berlin (Germany)', labelZh: '柏林时间 (UTC+01:00)', labelEn: 'Berlin (UTC+01:00)' },
  { value: 'America/New_York', offset: 'UTC-05:00', region: 'common', cityZh: '纽约 / 东部时间 (美国)', cityEn: 'New York / Eastern Time (USA)', labelZh: '纽约时间 (UTC-05:00)', labelEn: 'New York (UTC-05:00)' },
  { value: 'America/Los_Angeles', offset: 'UTC-08:00', region: 'common', cityZh: '洛杉矶 / 太平洋时间 (美国)', cityEn: 'Los Angeles / Pacific Time (USA)', labelZh: '洛杉矶时间 (UTC-08:00)', labelEn: 'Los Angeles (UTC-08:00)' },
  { value: 'UTC', offset: 'UTC+00:00', region: 'common', cityZh: '协调世界时 (UTC)', cityEn: 'Coordinated Universal Time (UTC)', labelZh: '协调世界时 (UTC)', labelEn: 'Coordinated Universal Time (UTC)' },

  // 亚洲 (Asia)
  { value: 'Asia/Bangkok', offset: 'UTC+07:00', region: 'asia', cityZh: '曼谷 (泰国)', cityEn: 'Bangkok (Thailand)', labelZh: '曼谷时间 (UTC+07:00)', labelEn: 'Bangkok (UTC+07:00)' },
  { value: 'Asia/Jakarta', offset: 'UTC+07:00', region: 'asia', cityZh: '雅加达 (印度尼西亚)', cityEn: 'Jakarta (Indonesia)', labelZh: '雅加达时间 (UTC+07:00)', labelEn: 'Jakarta (UTC+07:00)' },
  { value: 'Asia/Ho_Chi_Minh', offset: 'UTC+07:00', region: 'asia', cityZh: '胡志明市 (越南)', cityEn: 'Ho Chi Minh City (Vietnam)', labelZh: '胡志明市时间 (UTC+07:00)', labelEn: 'Ho Chi Minh City (UTC+07:00)' },
  { value: 'Asia/Kuala_Lumpur', offset: 'UTC+08:00', region: 'asia', cityZh: '吉隆坡 (马来西亚)', cityEn: 'Kuala Lumpur (Malaysia)', labelZh: '吉隆坡时间 (UTC+08:00)', labelEn: 'Kuala Lumpur (UTC+08:00)' },
  { value: 'Asia/Manila', offset: 'UTC+08:00', region: 'asia', cityZh: '马尼拉 (菲律宾)', cityEn: 'Manila (Philippines)', labelZh: '马尼拉时间 (UTC+08:00)', labelEn: 'Manila (UTC+08:00)' },
  { value: 'Asia/Ulaanbaatar', offset: 'UTC+08:00', region: 'asia', cityZh: '乌兰巴托 (蒙古)', cityEn: 'Ulaanbaatar (Mongolia)', labelZh: '乌兰巴托时间 (UTC+08:00)', labelEn: 'Ulaanbaatar (UTC+08:00)' },
  { value: 'Asia/Dubai', offset: 'UTC+04:00', region: 'asia', cityZh: '迪拜 (阿联酋)', cityEn: 'Dubai (UAE)', labelZh: '迪拜时间 (UTC+04:00)', labelEn: 'Dubai (UTC+04:00)' },
  { value: 'Asia/Riyadh', offset: 'UTC+03:00', region: 'asia', cityZh: '利雅得 (沙特阿拉伯)', cityEn: 'Riyadh (Saudi Arabia)', labelZh: '利雅得时间 (UTC+03:00)', labelEn: 'Riyadh (UTC+03:00)' },
  { value: 'Asia/Jerusalem', offset: 'UTC+02:00', region: 'asia', cityZh: '耶路撒冷 (以色列)', cityEn: 'Jerusalem (Israel)', labelZh: '耶路撒冷时间 (UTC+02:00)', labelEn: 'Jerusalem (UTC+02:00)' },
  { value: 'Asia/Kolkata', offset: 'UTC+05:30', region: 'asia', cityZh: '加尔各答 / 孟买 (印度)', cityEn: 'Kolkata / Mumbai (India)', labelZh: '印度标准时间 (UTC+05:30)', labelEn: 'India Standard Time (UTC+05:30)' },
  { value: 'Asia/Dhaka', offset: 'UTC+06:00', region: 'asia', cityZh: '达卡 (孟加拉国)', cityEn: 'Dhaka (Bangladesh)', labelZh: '达卡时间 (UTC+06:00)', labelEn: 'Dhaka (UTC+06:00)' },
  { value: 'Asia/Yangon', offset: 'UTC+06:30', region: 'asia', cityZh: '仰光 (缅甸)', cityEn: 'Yangon (Myanmar)', labelZh: '仰光时间 (UTC+06:30)', labelEn: 'Yangon (UTC+06:30)' },
  { value: 'Asia/Karachi', offset: 'UTC+05:00', region: 'asia', cityZh: '卡拉奇 (巴基斯坦)', cityEn: 'Karachi (Pakistan)', labelZh: '卡拉奇时间 (UTC+05:00)', labelEn: 'Karachi (UTC+05:00)' },
  { value: 'Asia/Tashkent', offset: 'UTC+05:00', region: 'asia', cityZh: '塔什干 (乌兹别克斯坦)', cityEn: 'Tashkent (Uzbekistan)', labelZh: '塔什干时间 (UTC+05:00)', labelEn: 'Tashkent (UTC+05:00)' },
  { value: 'Asia/Almaty', offset: 'UTC+05:00', region: 'asia', cityZh: '阿拉木图 (哈萨克斯坦)', cityEn: 'Almaty (Kazakhstan)', labelZh: '阿拉木图时间 (UTC+05:00)', labelEn: 'Almaty (UTC+05:00)' },
  { value: 'Asia/Tehran', offset: 'UTC+03:30', region: 'asia', cityZh: '德黑兰 (伊朗)', cityEn: 'Tehran (Iran)', labelZh: '德黑兰时间 (UTC+03:30)', labelEn: 'Tehran (UTC+03:30)' },
  { value: 'Asia/Baku', offset: 'UTC+04:00', region: 'asia', cityZh: '巴库 (阿塞拜疆)', cityEn: 'Baku (Azerbaijan)', labelZh: '巴库时间 (UTC+04:00)', labelEn: 'Baku (UTC+04:00)' },
  { value: 'Asia/Tbilisi', offset: 'UTC+04:00', region: 'asia', cityZh: '第比利斯 (格鲁吉亚)', cityEn: 'Tbilisi (Georgia)', labelZh: '第比利斯时间 (UTC+04:00)', labelEn: 'Tbilisi (UTC+04:00)' },
  { value: 'Asia/Yerevan', offset: 'UTC+04:00', region: 'asia', cityZh: '埃里温 (亚美尼亚)', cityEn: 'Yerevan (Armenia)', labelZh: '埃里温时间 (UTC+04:00)', labelEn: 'Yerevan (UTC+04:00)' },
  { value: 'Asia/Vladivostok', offset: 'UTC+10:00', region: 'asia', cityZh: '符拉迪沃斯托克 / 海参崴 (俄罗斯)', cityEn: 'Vladivostok (Russia)', labelZh: '符拉迪沃斯托克时间 (UTC+10:00)', labelEn: 'Vladivostok (UTC+10:00)' },

  // 欧洲 (Europe)
  { value: 'Europe/Amsterdam', offset: 'UTC+01:00', region: 'europe', cityZh: '阿姆斯特丹 (荷兰)', cityEn: 'Amsterdam (Netherlands)', labelZh: '阿姆斯特丹时间 (UTC+01:00)', labelEn: 'Amsterdam (UTC+01:00)' },
  { value: 'Europe/Brussels', offset: 'UTC+01:00', region: 'europe', cityZh: '布鲁塞尔 (比利时)', cityEn: 'Brussels (Belgium)', labelZh: '布鲁塞尔时间 (UTC+01:00)', labelEn: 'Brussels (UTC+01:00)' },
  { value: 'Europe/Rome', offset: 'UTC+01:00', region: 'europe', cityZh: '罗马 (意大利)', cityEn: 'Rome (Italy)', labelZh: '罗马时间 (UTC+01:00)', labelEn: 'Rome (UTC+01:00)' },
  { value: 'Europe/Madrid', offset: 'UTC+01:00', region: 'europe', cityZh: '马德里 (西班牙)', cityEn: 'Madrid (Spain)', labelZh: '马德里时间 (UTC+01:00)', labelEn: 'Madrid (UTC+01:00)' },
  { value: 'Europe/Zurich', offset: 'UTC+01:00', region: 'europe', cityZh: '苏黎世 (瑞士)', cityEn: 'Zurich (Switzerland)', labelZh: '苏黎世时间 (UTC+01:00)', labelEn: 'Zurich (UTC+01:00)' },
  { value: 'Europe/Vienna', offset: 'UTC+01:00', region: 'europe', cityZh: '维也纳 (奥地利)', cityEn: 'Vienna (Austria)', labelZh: '维也纳时间 (UTC+01:00)', labelEn: 'Vienna (UTC+01:00)' },
  { value: 'Europe/Stockholm', offset: 'UTC+01:00', region: 'europe', cityZh: '斯德哥尔摩 (瑞典)', cityEn: 'Stockholm (Sweden)', labelZh: '斯德哥尔摩时间 (UTC+01:00)', labelEn: 'Stockholm (UTC+01:00)' },
  { value: 'Europe/Warsaw', offset: 'UTC+01:00', region: 'europe', cityZh: '华沙 (波兰)', cityEn: 'Warsaw (Poland)', labelZh: '华沙时间 (UTC+01:00)', labelEn: 'Warsaw (UTC+01:00)' },
  { value: 'Europe/Prague', offset: 'UTC+01:00', region: 'europe', cityZh: '布拉格 (捷克)', cityEn: 'Prague (Czech Republic)', labelZh: '布拉格时间 (UTC+01:00)', labelEn: 'Prague (UTC+01:00)' },
  { value: 'Europe/Athens', offset: 'UTC+02:00', region: 'europe', cityZh: '雅典 (希腊)', cityEn: 'Athens (Greece)', labelZh: '雅典时间 (UTC+02:00)', labelEn: 'Athens (UTC+02:00)' },
  { value: 'Europe/Helsinki', offset: 'UTC+02:00', region: 'europe', cityZh: '赫尔辛基 (芬兰)', cityEn: 'Helsinki (Finland)', labelZh: '赫尔辛基时间 (UTC+02:00)', labelEn: 'Helsinki (UTC+02:00)' },
  { value: 'Europe/Kyiv', offset: 'UTC+02:00', region: 'europe', cityZh: '基辅 (乌克兰)', cityEn: 'Kyiv (Ukraine)', labelZh: '基辅时间 (UTC+02:00)', labelEn: 'Kyiv (UTC+02:00)' },
  { value: 'Europe/Bucharest', offset: 'UTC+02:00', region: 'europe', cityZh: '布加勒斯特 (罗马尼亚)', cityEn: 'Bucharest (Romania)', labelZh: '布加勒斯特时间 (UTC+02:00)', labelEn: 'Bucharest (UTC+02:00)' },
  { value: 'Europe/Moscow', offset: 'UTC+03:00', region: 'europe', cityZh: '莫斯科 (俄罗斯)', cityEn: 'Moscow (Russia)', labelZh: '莫斯科时间 (UTC+03:00)', labelEn: 'Moscow (UTC+03:00)' },
  { value: 'Europe/Istanbul', offset: 'UTC+03:00', region: 'europe', cityZh: '伊斯坦布尔 (土耳其)', cityEn: 'Istanbul (Turkey)', labelZh: '伊斯坦布尔时间 (UTC+03:00)', labelEn: 'Istanbul (UTC+03:00)' },
  { value: 'Europe/Dublin', offset: 'UTC+00:00', region: 'europe', cityZh: '都柏林 (爱尔兰)', cityEn: 'Dublin (Ireland)', labelZh: '都柏林时间 (UTC+00:00)', labelEn: 'Dublin (UTC+00:00)' },
  { value: 'Europe/Lisbon', offset: 'UTC+00:00', region: 'europe', cityZh: '里斯本 (葡萄牙)', cityEn: 'Lisbon (Portugal)', labelZh: '里斯本时间 (UTC+00:00)', labelEn: 'Lisbon (UTC+00:00)' },

  // 美洲 (Americas)
  { value: 'America/Chicago', offset: 'UTC-06:00', region: 'americas', cityZh: '芝加哥 / 中部时间 (美国)', cityEn: 'Chicago / Central Time (USA)', labelZh: '芝加哥时间 (UTC-06:00)', labelEn: 'Chicago (UTC-06:00)' },
  { value: 'America/Denver', offset: 'UTC-07:00', region: 'americas', cityZh: '丹佛 / 山地时间 (美国)', cityEn: 'Denver / Mountain Time (USA)', labelZh: '丹佛时间 (UTC-07:00)', labelEn: 'Denver (UTC-07:00)' },
  { value: 'America/Phoenix', offset: 'UTC-07:00', region: 'americas', cityZh: '菲尼克斯 / 凤凰城 (美国)', cityEn: 'Phoenix (USA)', labelZh: '菲尼克斯时间 (UTC-07:00)', labelEn: 'Phoenix (UTC-07:00)' },
  { value: 'America/Anchorage', offset: 'UTC-09:00', region: 'americas', cityZh: '安克雷奇 / 阿拉斯加 (美国)', cityEn: 'Anchorage / Alaska (USA)', labelZh: '阿拉斯加时间 (UTC-09:00)', labelEn: 'Alaska (UTC-09:00)' },
  { value: 'Pacific/Honolulu', offset: 'UTC-10:00', region: 'americas', cityZh: '檀香山 / 夏威夷 (美国)', cityEn: 'Honolulu / Hawaii (USA)', labelZh: '夏威夷时间 (UTC-10:00)', labelEn: 'Hawaii (UTC-10:00)' },
  { value: 'America/Toronto', offset: 'UTC-05:00', region: 'americas', cityZh: '多伦多 (加拿大)', cityEn: 'Toronto (Canada)', labelZh: '多伦多时间 (UTC-05:00)', labelEn: 'Toronto (UTC-05:00)' },
  { value: 'America/Vancouver', offset: 'UTC-08:00', region: 'americas', cityZh: '温哥华 (加拿大)', cityEn: 'Vancouver (Canada)', labelZh: '温哥华时间 (UTC-08:00)', labelEn: 'Vancouver (UTC-08:00)' },
  { value: 'America/Mexico_City', offset: 'UTC-06:00', region: 'americas', cityZh: '墨西哥城 (墨西哥)', cityEn: 'Mexico City (Mexico)', labelZh: '墨西哥城时间 (UTC-06:00)', labelEn: 'Mexico City (UTC-06:00)' },
  { value: 'America/Bogota', offset: 'UTC-05:00', region: 'americas', cityZh: '波哥大 (哥伦比亚)', cityEn: 'Bogota (Colombia)', labelZh: '波哥大时间 (UTC-05:00)', labelEn: 'Bogota (UTC-05:00)' },
  { value: 'America/Lima', offset: 'UTC-05:00', region: 'americas', cityZh: '利马 (秘鲁)', cityEn: 'Lima (Peru)', labelZh: '利马时间 (UTC-05:00)', labelEn: 'Lima (UTC-05:00)' },
  { value: 'America/Santiago', offset: 'UTC-04:00', region: 'americas', cityZh: '圣地亚哥 (智利)', cityEn: 'Santiago (Chile)', labelZh: '圣地亚哥时间 (UTC-04:00)', labelEn: 'Santiago (UTC-04:00)' },
  { value: 'America/Buenos_Aires', offset: 'UTC-03:00', region: 'americas', cityZh: '布宜诺斯艾利斯 (阿根廷)', cityEn: 'Buenos Aires (Argentina)', labelZh: '布宜诺斯艾利斯时间 (UTC-03:00)', labelEn: 'Buenos Aires (UTC-03:00)' },
  { value: 'America/Sao_Paulo', offset: 'UTC-03:00', region: 'americas', cityZh: '圣保罗 (巴西)', cityEn: 'Sao Paulo (Brazil)', labelZh: '圣保罗时间 (UTC-03:00)', labelEn: 'Sao Paulo (UTC-03:00)' },
  { value: 'America/Caracas', offset: 'UTC-04:00', region: 'americas', cityZh: '加拉加斯 (委内瑞拉)', cityEn: 'Caracas (Venezuela)', labelZh: '加拉加斯时间 (UTC-04:00)', labelEn: 'Caracas (UTC-04:00)' },

  // 大洋洲与太平洋 (Oceania & Pacific)
  { value: 'Australia/Sydney', offset: 'UTC+10:00', region: 'oceania', cityZh: '悉尼 (澳大利亚)', cityEn: 'Sydney (Australia)', labelZh: '悉尼时间 (UTC+10:00)', labelEn: 'Sydney (UTC+10:00)' },
  { value: 'Australia/Melbourne', offset: 'UTC+10:00', region: 'oceania', cityZh: '墨尔本 (澳大利亚)', cityEn: 'Melbourne (Australia)', labelZh: '墨尔本时间 (UTC+10:00)', labelEn: 'Melbourne (UTC+10:00)' },
  { value: 'Australia/Brisbane', offset: 'UTC+10:00', region: 'oceania', cityZh: '布里斯班 (澳大利亚)', cityEn: 'Brisbane (Australia)', labelZh: '布里斯班时间 (UTC+10:00)', labelEn: 'Brisbane (UTC+10:00)' },
  { value: 'Australia/Adelaide', offset: 'UTC+09:30', region: 'oceania', cityZh: '阿德莱德 (澳大利亚)', cityEn: 'Adelaide (Australia)', labelZh: '阿德莱德时间 (UTC+09:30)', labelEn: 'Adelaide (UTC+09:30)' },
  { value: 'Australia/Perth', offset: 'UTC+08:00', region: 'oceania', cityZh: '珀斯 (澳大利亚)', cityEn: 'Perth (Australia)', labelZh: '珀斯时间 (UTC+08:00)', labelEn: 'Perth (UTC+08:00)' },
  { value: 'Pacific/Auckland', offset: 'UTC+12:00', region: 'oceania', cityZh: '奥克兰 (新西兰)', cityEn: 'Auckland (New Zealand)', labelZh: '奥克兰时间 (UTC+12:00)', labelEn: 'Auckland (UTC+12:00)' },
  { value: 'Pacific/Fiji', offset: 'UTC+12:00', region: 'oceania', cityZh: '苏瓦 (斐济)', cityEn: 'Suva (Fiji)', labelZh: '斐济时间 (UTC+12:00)', labelEn: 'Fiji (UTC+12:00)' },
  { value: 'Pacific/Guam', offset: 'UTC+10:00', region: 'oceania', cityZh: '关岛 (美国)', cityEn: 'Guam (USA)', labelZh: '关岛时间 (UTC+10:00)', labelEn: 'Guam (UTC+10:00)' },

  // 非洲 (Africa)
  { value: 'Africa/Cairo', offset: 'UTC+02:00', region: 'africa', cityZh: '开罗 (埃及)', cityEn: 'Cairo (Egypt)', labelZh: '开罗时间 (UTC+02:00)', labelEn: 'Cairo (UTC+02:00)' },
  { value: 'Africa/Johannesburg', offset: 'UTC+02:00', region: 'africa', cityZh: '约翰内斯堡 (南非)', cityEn: 'Johannesburg (South Africa)', labelZh: '约翰内斯堡时间 (UTC+02:00)', labelEn: 'Johannesburg (UTC+02:00)' },
  { value: 'Africa/Lagos', offset: 'UTC+01:00', region: 'africa', cityZh: '拉各斯 (尼日利亚)', cityEn: 'Lagos (Nigeria)', labelZh: '拉各斯时间 (UTC+01:00)', labelEn: 'Lagos (UTC+01:00)' },
  { value: 'Africa/Nairobi', offset: 'UTC+03:00', region: 'africa', cityZh: '内罗毕 (肯尼亚)', cityEn: 'Nairobi (Kenya)', labelZh: '内罗毕时间 (UTC+03:00)', labelEn: 'Nairobi (UTC+03:00)' },
  { value: 'Africa/Casablanca', offset: 'UTC+01:00', region: 'africa', cityZh: '卡萨布兰卡 (摩洛哥)', cityEn: 'Casablanca (Morocco)', labelZh: '卡萨布兰卡时间 (UTC+01:00)', labelEn: 'Casablanca (UTC+01:00)' },
];

/** 获取支持国际化（中英文）的时区选项列表 */
export function getTimezoneOptions(locale?: string): TimezoneOption[] {
  const isZh = (locale || '').toLowerCase().startsWith('zh');
  return TIMEZONE_DEFINITIONS.map((def) => ({
    value: def.value,
    label: isZh ? def.labelZh : def.labelEn,
    city: isZh ? def.cityZh : def.cityEn,
    offset: def.offset,
    region: isZh ? REGION_NAMES[def.region]?.zh || def.region : REGION_NAMES[def.region]?.en || def.region,
  }));
}

/** 常见全球代表性时区列表（默认中文快捷兼容视图） */
export const COMMON_TIMEZONES: TimezoneOption[] = getTimezoneOptions('zh-CN');

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
