import React, { useState } from 'react';
import { LanChatModal } from '../../src/components/LanChatModal';
import { SharedFilesApi, type SharedRoot, type SharedEntry } from '../../src/services/sharedFiles';
import type { User } from '../../src/types';

export const SharedFilesFixture: React.FC<{ user: User; peer: User }> = ({ user, peer }) => {
  useState(() => {
    const roots: SharedRoot[] = [
      { id: 'read', name: '项目资料', isDirectory: true, writable: false, available: true, localPath: 'D:\\项目资料' },
      { id: 'write', name: '交付收集', isDirectory: true, writable: true, available: true, localPath: 'D:\\交付收集' },
      { id: 'file', name: '说明.pdf', isDirectory: false, writable: false, available: true, localPath: 'D:\\说明.pdf' },
    ];
    const items: Record<string, SharedEntry[]> = {
      'read:': [{ name: '设计文档', path: '设计文档', isDirectory: true, size: 0 }, { name: '计划.xlsx', path: '计划.xlsx', isDirectory: false, size: 1024 }],
      'read:设计文档': [{ name: '接口说明.pdf', path: '设计文档/接口说明.pdf', isDirectory: false, size: 2048 }, { name: '空目录', path: '设计文档/空目录', isDirectory: true, size: 0 }],
      'read:设计文档/空目录': [],
      'write:': [],
    };
    SharedFilesApi.localRoots = async () => [...roots];
    SharedFilesApi.roots = async () => {
      if (new URLSearchParams(location.search).has('offline')) throw new Error('SHARE_OFFLINE');
      return { roots: roots.map(({ localPath: _, ...root }) => root) };
    };
    SharedFilesApi.list = async (_user, id, path, offset = 0) => {
      const entries = items[`${id}:${path}`] ?? [];
      return { entries: entries.slice(offset, offset + 1), total: entries.length };
    };
    SharedFilesApi.permission = async (id, writable) => { roots.find(root => root.id === id)!.writable = writable; return [...roots]; };
    SharedFilesApi.remove = async id => { roots.splice(roots.findIndex(root => root.id === id), 1); return [...roots]; };
    SharedFilesApi.mkdir = async (_user, id, path, name) => {
      const entries = items[`${id}:${path}`] ??= [];
      if (entries.some(entry => entry.name === name)) throw new Error('SHARE_EXISTS');
      entries.push({ name, path: path ? `${path}/${name}` : name, isDirectory: true, size: 0 });
    };
    return true;
  });
  return <div className="flex h-screen min-h-0"><LanChatModal embedded isOpen currentUser={user} users={[user, peer]} projects={[]} /></div>;
};
