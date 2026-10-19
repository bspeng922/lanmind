/**
 * AI 助手名称的读写契约。
 *
 * 名称由系统设置页写入，由 AI 对话界面读取，因此单独抽成一层，
 * 避免两处各自维护一份存储键而产生不一致。本机偏好，不参与对等同步。
 */

const STORAGE_KEY = 'lanmind_ai_assistant_name';
const CHANGE_EVENT = 'lanmind-ai-assistant-name-change';

/** 允许的最大长度，超出部分由界面与写入层共同截断。 */
export const AI_ASSISTANT_NAME_MAX_LENGTH = 32;

/**
 * 读取自定义的 AI 助手名称。
 * 返回 `null` 表示未配置，调用方应回退到界面文案里的默认名称。
 */
export const getAIAssistantName = (): string | null => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const trimmed = saved?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
};

/** 写入自定义名称。传入空值等同于清除配置，恢复默认名称。 */
export const setAIAssistantName = (name: string) => {
  const trimmed = name.trim().slice(0, AI_ASSISTANT_NAME_MAX_LENGTH);
  try {
    if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 存储不可用时保持静默：名称只是展示偏好，不应因此阻断界面。
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: trimmed || null }));
};

/** 订阅名称变化，返回取消订阅函数。用于同窗口内的即时更新。 */
export const onAIAssistantNameChange = (listener: (name: string | null) => void) => {
  const handleCustom = (event: Event) => listener((event as CustomEvent<string | null>).detail);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener(getAIAssistantName());
  };
  window.addEventListener(CHANGE_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
};
