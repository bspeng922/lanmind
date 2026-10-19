import { scopedStorageKey } from "../../utils/workspaceContext";
/**
 * 知识库的协作项目列表来源。
 *
 * 调用约定：`WikiView` 不接受 props，App.tsx 也没有把项目列表传进来。
 * 因此这里按应用内既有做法自取：
 * 1. 项目列表先读 `localStorage` 的 `lanmind_cached_projects`（与 QuickAddWindow 使用同一个缓存键）。
 * 2. 缺少缓存时，从 `localStorage` 的 `lanmind_current_user` 取当前用户 id；
 *    该键不存在时退回 `ApiService.getBootstrap()`，再调用 `ApiService.getProjects(currentUserId)`。
 * 3. 两条路都拿不到数据时返回空列表，视图隐藏关联项目选择器。
 *
 * 全部失败路径都收敛为「空列表」，不抛错，保证知识库主体功能不受项目接口影响。
 */

import { useEffect, useState } from 'react';
import { ApiService } from '../../services/api';
import type { WikiProjectOption } from './wikiTypes';

const PROJECT_CACHE_KEY = 'lanmind_cached_projects';
const CURRENT_USER_KEY = 'lanmind_current_user';

/** 读取缓存的当前用户 id。 */
export function readCachedUserId(): string | null {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.id === 'string' ? parsed.id : null;
  } catch {
    return null;
  }
}

/** 读取缓存的项目列表。缓存里可能混入非项目对象，这里逐条校验。 */
function readCachedProjects(): WikiProjectOption[] | null {
  try {
    const raw = localStorage.getItem(scopedStorageKey(PROJECT_CACHE_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const options = parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .filter((item) => typeof item.id === 'string' && typeof item.name === 'string')
      .map((item) => ({
        id: item.id as string,
        name: item.name as string,
        color: typeof item.color === 'string' ? item.color : undefined,
      }));
    return options.length ? options : null;
  } catch {
    return null;
  }
}

/** 写入项目缓存，与 QuickAddWindow 保持同一形状。 */
function writeCachedProjects(projects: WikiProjectOption[]): void {
  try {
    localStorage.setItem(scopedStorageKey(PROJECT_CACHE_KEY), JSON.stringify(projects));
  } catch {
    // 存储不可用时忽略，界面仍使用内存中的列表。
  }
}

async function resolveCurrentUserId(): Promise<string | null> {
  const cached = readCachedUserId();
  if (cached) return cached;
  try {
    const bootstrap = await ApiService.getBootstrap();
    return bootstrap?.currentUser?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * 解析可选关联的项目列表。返回空数组时调用方应隐藏项目选择器。
 */
export function useWikiProjects(): WikiProjectOption[] {
  const [projects, setProjects] = useState<WikiProjectOption[]>(() => readCachedProjects() ?? []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const currentUserId = await resolveCurrentUserId();
      if (!currentUserId || cancelled) return;
      try {
        const list = await ApiService.getProjects(currentUserId);
        if (cancelled || !Array.isArray(list)) return;
        const options = list.map((project) => ({ id: project.id, name: project.name, color: project.color }));
        setProjects(options);
        writeCachedProjects(options);
      } catch {
        // 项目接口不可用时沿用缓存结果。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return projects;
}
