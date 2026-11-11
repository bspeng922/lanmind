import React, { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { tr } from '../i18n';

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

export const AppShell: React.FC<AppShellProps> = ({ rail, sidebar, topbar, drawer, children }) => {
  const [navigationOpen,setNavigationOpen]=useState(false);
  useEffect(()=>{
    if(!navigationOpen)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setNavigationOpen(false);};
    window.addEventListener('keydown',close);return ()=>window.removeEventListener('keydown',close);
  },[navigationOpen]);
  return (
  <div className="app-shell flex h-full w-full min-h-0 flex-1 select-none flex-col overflow-hidden bg-canvas font-sans text-main">
    <div className="flex shrink-0 items-center border-b border-edge bg-surface">
      {sidebar && <button type="button" data-testid="mobile-navigation-toggle" className="m-2 shrink-0 rounded p-2 text-sub lg:hidden" aria-label={tr(navigationOpen?'common:sidebar.collapseNavigation':'common:sidebar.expandNavigation')} aria-expanded={navigationOpen} onClick={()=>setNavigationOpen(value=>!value)}>{navigationOpen?<X className="h-4 w-4"/>:<Menu className="h-4 w-4"/>}</button>}
      <div className="min-w-0 flex-1">{topbar}</div>
    </div>
    <div className="app-shell-body relative flex min-h-0 flex-1 overflow-hidden">
      {rail}
      {navigationOpen && sidebar && <button type="button" className="absolute inset-0 z-30 bg-overlay lg:hidden" aria-label={tr('common:header.close')} onClick={()=>setNavigationOpen(false)}/>}
      {sidebar && <div className={navigationOpen?'absolute inset-y-0 left-12 z-40 flex lg:static lg:z-auto':'hidden shrink-0 lg:flex'} onClickCapture={event=>{if((event.target as Element).closest('button,[role="button"],[data-project-drag-id]'))setNavigationOpen(false);}}>{sidebar}</div>}
      <main className="app-shell-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
        {children}
      </main>
      {drawer}
    </div>
  </div>
  );
};
