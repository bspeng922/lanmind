/**
 * QuickAddWindow — Dedicated Standalone Floating Window for Global Quick Capture.
 *
 * CALLING SPEC:
 *   <QuickAddWindow />
 *
 * SIDE EFFECTS:
 *   - Listens to 'quick-add://opened' Tauri events to refresh session and refocus.
 *   - Auto-hides via getCurrentWindow().hide() on close or completion.
 *   - Uses ThemeProvider to synchronize the active theme preference.
 *   - Falls back gracefully to local cached user state if bootstrap is delayed or offline.
 */

import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { QuickAddModal } from './components/QuickAddModal';
import { ThemeProvider } from './context/ThemeContext';
import { ApiService } from './services/api';
import { Project, User } from './types';

const FALLBACK_USER: User = {
  id: 'local@desktop-node',
  username: 'local_user',
  deviceId: 'desktop-node',
  nickname: '本机用户',
  role: 'admin',
  ip: '127.0.0.1',
  isOnline: true,
  lastActive: new Date().toISOString(),
};

function QuickAddWindowContent() {
  const [currentUser, setCurrentUser] = useState<User>(() => {
    try {
      const cached = localStorage.getItem('lanmind_current_user');
      if (cached) return JSON.parse(cached);
    } catch {
      // ignore
    }
    return FALLBACK_USER;
  });
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const cached = localStorage.getItem('lanmind_cached_projects');
      if (cached) return JSON.parse(cached);
    } catch {
      // ignore
    }
    return [];
  });
  const [users, setUsers] = useState<User[]>([]);
  const [session, setSession] = useState(0);

  const loadData = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const bootstrap = await ApiService.getBootstrap();
      if (bootstrap?.currentUser) {
        setCurrentUser(bootstrap.currentUser);
        localStorage.setItem('lanmind_current_user', JSON.stringify(bootstrap.currentUser));

        const [nextUsers, nextProjects] = await Promise.all([
          ApiService.getUsers().catch(() => []),
          ApiService.getProjects(bootstrap.currentUser.id).catch(() => []),
        ]);
        if (nextUsers.length > 0) setUsers(nextUsers);
        if (nextProjects.length > 0) {
          setProjects(nextProjects);
          localStorage.setItem('lanmind_cached_projects', JSON.stringify(nextProjects));
        }
      }
    } catch (err) {
      console.warn('QuickAddWindow bootstrap sync deferred:', err);
    }
  }, []);

  const hideWindow = useCallback(() => {
    if (isTauri()) {
      getCurrentWindow().hide().catch((hideError) =>
        console.error('Failed to hide quick add window', hideError)
      );
    }
  }, []);

  useEffect(() => {
    void loadData();
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    listen('quick-add://opened', () => {
      setSession((current) => current + 1);
      void loadData();
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => unlisten?.();
  }, [loadData]);

  return (
    <div className="h-screen w-screen overflow-hidden select-none bg-transparent p-2">
      <QuickAddModal
        key={session}
        isOpen
        standalone
        onClose={hideWindow}
        projects={projects}
        users={users}
        currentUser={currentUser}
        onTaskCreated={() => {
          hideWindow();
        }}
      />
    </div>
  );
}

export default function QuickAddWindow() {
  return (
    <ThemeProvider>
      <QuickAddWindowContent />
    </ThemeProvider>
  );
}
