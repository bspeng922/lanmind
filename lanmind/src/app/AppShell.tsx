import React from 'react';

/**
 * Calling spec:
 * AppShell keeps the desktop frame predictable. The rail and secondary navigation
 * remain stable while the canvas and contextual drawer change with the active view.
 */
export interface AppShellProps {
  rail?: React.ReactNode;
  sidebar?: React.ReactNode;
  topbar: React.ReactNode;
  drawer?: React.ReactNode;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ rail, sidebar, topbar, drawer, children }) => (
  <div className="app-shell flex h-full w-full min-h-0 flex-1 select-none flex-col overflow-hidden bg-canvas font-sans text-main">
    {topbar}
    <div className="app-shell-body flex min-h-0 flex-1 overflow-hidden">
      {rail}
      {sidebar}
      <main className="app-shell-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
        {children}
      </main>
      {drawer}
    </div>
  </div>
);
