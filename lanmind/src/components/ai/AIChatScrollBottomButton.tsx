/**
 * AIChatScrollBottomButton — 对话流快速滚动到底部的浮动圆钮。
 *
 * CALLING SPEC:
 *   <AIChatScrollBottomButton visible={boolean} onClick={() => void} />
 */

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { tr } from '../../i18n';

interface AIChatScrollBottomButtonProps {
  visible: boolean;
  onClick: () => void;
  className?: string;
}

export const AIChatScrollBottomButton: React.FC<AIChatScrollBottomButtonProps> = ({
  visible,
  onClick,
  className = '',
}) => {
  return (
    <button
      type="button"
      aria-label={tr('ai:v2.scrollToBottom')}
      title={tr('ai:v2.scrollToBottom')}
      onClick={onClick}
      className={`absolute -top-4 left-1/2 -translate-x-1/2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-edge/80 bg-surface/95 text-sub shadow-md backdrop-blur-md transition-all duration-200 hover:bg-hover hover:text-main hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-accent ${
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-2 pointer-events-none'
      } ${className}`}
    >
      <ChevronDown className="h-4 w-4" />
    </button>
  );
};
