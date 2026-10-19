/**
 * useAssistantName — 读取并在变更时订阅 AI 助手名称。
 *
 * CALLING SPEC:
 *   const assistantName = useAssistantName();
 *
 * TOOL CONTRACT:
 *   - 名称由系统设置页写入 localStorage（见 src/utils/aiAssistant.ts），此处只读。
 *   - 未配置时回退到当前语言下的默认名称 ai:workspace.assistantFallbackName。
 *   - 订阅 onAIAssistantNameChange，改名后无需刷新即可更新界面。
 */

import { useSyncExternalStore } from 'react';
import { tr, useLocale } from '../../i18n';
import { getAIAssistantName, onAIAssistantNameChange } from '../../utils/aiAssistant';

const subscribe = (listener: () => void) => onAIAssistantNameChange(() => listener());

export const useAssistantName = (): string => {
  useLocale();
  const stored = useSyncExternalStore(subscribe, getAIAssistantName, () => null);
  return stored || tr('ai:workspace.assistantFallbackName');
};
