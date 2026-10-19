import React from 'react';
import { tr, useLocale } from '../../i18n';
import type { User } from '../../types';

interface MemberAvatarProps {
  user?: User;
  name?: string;
  avatar?: string;
  isOnline?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showPresence?: boolean;
  className?: string;
}

/**
 * 头像底色只是为了让相邻成员可区分，不承载语义，因此只从语义色里取一组，
 * 同一个名字在任何主题下都会落到同一个色。
 */
const AVATAR_TONES = [
  'bg-info/15 text-info',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-feature/15 text-feature',
  'bg-danger/15 text-danger',
  'bg-accent/15 text-accent',
];

export const MemberAvatar: React.FC<MemberAvatarProps> = ({
  user,
  name,
  avatar,
  isOnline,
  size = 'sm',
  showPresence = true,
  className = '',
}) => {
  useLocale();
  const displayName = user?.nickname || name || tr('tasks:memberAvatar.unassigned');
  const displayAvatar = user?.avatar || avatar;
  const online = isOnline !== undefined ? isOnline : Boolean(user?.isOnline);

  const sizeDimensions = {
    xs: { box: 'w-4 h-4', text: 'text-[9px]', dot: 'w-1.5 h-1.5' },
    sm: { box: 'w-5 h-5', text: 'text-[10px]', dot: 'w-1.5 h-1.5' },
    md: { box: 'w-6 h-6', text: 'text-xs', dot: 'w-2 h-2' },
    lg: { box: 'w-8 h-8', text: 'text-sm', dot: 'w-2.5 h-2.5' },
  }[size];

  const initial = displayName.charAt(0).toUpperCase();

  let hash = 0;
  for (let i = 0; i < displayName.length; i += 1) {
    hash = (hash << 5) - hash + displayName.charCodeAt(i);
  }
  const toneClass = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];

  const hasImage = Boolean(
    displayAvatar && (displayAvatar.startsWith('http') || displayAvatar.startsWith('data:image'))
  );

  const presenceLabel = online ? tr('tasks:memberAvatar.online') : tr('tasks:memberAvatar.offline');
  const address = user?.ip?.trim();
  const title = user
    ? address
      ? tr('tasks:memberAvatar.presenceWithAddress', { value0: displayName, value1: presenceLabel, value2: address })
      : tr('tasks:memberAvatar.presence', { value0: displayName, value1: presenceLabel })
    : displayName;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 rounded-full select-none ${sizeDimensions.box} ${className}`}
      title={title}
    >
      {hasImage ? (
        <img src={displayAvatar} alt={displayName} className="w-full h-full rounded-full object-cover" />
      ) : displayAvatar && displayAvatar.length <= 2 ? (
        <span className="flex items-center justify-center w-full h-full rounded-full bg-muted text-main text-[11px]">
          {displayAvatar}
        </span>
      ) : (
        <span
          className={`flex items-center justify-center w-full h-full rounded-full font-semibold ${sizeDimensions.text} ${toneClass} border border-subtle/50`}
        >
          {initial}
        </span>
      )}

      {showPresence && user && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-canvas ${sizeDimensions.dot}`}
          style={{ backgroundColor: online ? 'var(--success)' : 'var(--state-backlog)' }}
          aria-label={presenceLabel}
          title={presenceLabel}
        />
      )}
    </div>
  );
};
