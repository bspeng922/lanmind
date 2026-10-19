import React from 'react';

export type DrawerMode = 'none' | 'ai' | 'peek';

interface RightDrawerRootProps {
  mode: DrawerMode;
  children?: React.ReactNode;
}

/** Shared mount point for contextual drawers. Drawer content is layered over the canvas. */
export const RightDrawerRoot: React.FC<RightDrawerRootProps> = ({ mode, children }) => (
  <>{mode !== 'none' && children}</>
);
