export const REST_DAYS_STORAGE_KEY = 'lanmind_rest_days_v1';
export const REST_DAYS_CHANGE_EVENT = 'lanmind-rest-days-change';

export const DEFAULT_REST_DAYS = [6, 7];

export const getStoredRestDays = (): number[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(REST_DAYS_STORAGE_KEY) || JSON.stringify(DEFAULT_REST_DAYS));
    if (!Array.isArray(parsed)) return [...DEFAULT_REST_DAYS];
    return parsed.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7);
  } catch {
    return [...DEFAULT_REST_DAYS];
  }
};

export const setStoredRestDays = (days: number[]) => {
  const normalized = Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))).sort((a, b) => a - b);
  localStorage.setItem(REST_DAYS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(REST_DAYS_CHANGE_EVENT));
  return normalized;
};
