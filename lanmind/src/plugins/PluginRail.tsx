import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { currentLocale, tr, useLocale } from '../i18n';
import { pluginAppearance, pluginCall, pluginError, pluginText, subscribePlugins, type InstalledPlugin, type PluginSnapshot } from './client';
import { PluginDialog } from './PluginDialog';
import { PluginIcon } from './PluginIcon';

/** Shortcuts launch the same isolated plugin windows as the plugin center. */
export function PluginRail() {
  useLocale();
  const locale = currentLocale();
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<{ name: string; message: string } | null>(null);
  const lifecycle = useRef(0);
  const operation = useRef(0);
  const openingRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ overflow: false, above: false, below: false });
  const shortcuts = installed.filter(plugin => plugin.enabled && plugin.available);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const update = () => {
      const next = {
        overflow: content.scrollHeight > viewport.clientHeight + 1,
        above: viewport.scrollTop > 1,
        below: viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1,
      };
      setScrollState(previous => previous.overflow === next.overflow && previous.above === next.above && previous.below === next.below ? previous : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport); observer.observe(content);
    viewport.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer.disconnect(); viewport.removeEventListener('scroll', update); };
  }, [shortcuts.length]);

  useEffect(() => {
    const active = ++lifecycle.current;
    let request = 0;
    let stop: (() => void) | undefined;
    const refresh = async () => {
      const attempt = ++request;
      try {
        const snapshot = await pluginCall<PluginSnapshot>('list');
        if (lifecycle.current === active && attempt === request) setInstalled(snapshot.installed);
      } catch {
        if (lifecycle.current === active && attempt === request) setInstalled([]);
      }
    };
    void subscribePlugins(event => {
      if (lifecycle.current !== active) return;
      if (event === 'workspace://changed' || event === 'app-lock://state') {
        ++operation.current;
        setInstalled([]); setError(null); openingRef.current = null; setOpening(null);
      }
      if (['plugins://changed', 'workspace://changed', 'app-lock://state'].includes(event)) void refresh();
    }).then(unlisten => {
      if (lifecycle.current === active) { stop = unlisten; void refresh(); }
      else unlisten();
    }).catch(() => { if (lifecycle.current === active) setInstalled([]); });
    window.addEventListener('focus', refresh);
    return () => { ++lifecycle.current; ++request; stop?.(); window.removeEventListener('focus', refresh); };
  }, []);

  const open = async (plugin: InstalledPlugin) => {
    if (openingRef.current) return;
    const active = lifecycle.current;
    const attempt = ++operation.current;
    openingRef.current = plugin.pluginKey;
    setOpening(plugin.pluginKey); setError(null);
    try { await pluginCall('open', { pluginKey: plugin.pluginKey, theme: pluginAppearance(), locale }); }
    catch (cause) {
      if (lifecycle.current === active && operation.current === attempt) {
        setError({ name: pluginText(plugin.manifest, 'name', locale), message: pluginError(cause) });
      }
    } finally {
      if (lifecycle.current === active && operation.current === attempt) {
        openingRef.current = null; setOpening(null);
      }
    }
  };

  const scroll = (direction: number) => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollBy({ top: direction * Math.max(40, viewport.clientHeight - 32), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <>
    {shortcuts.length > 0 && <div role="group" aria-label={tr('settings:pluginCenter.installedPlugins')} className="flex min-h-0 w-full flex-1 flex-col items-center">
      <div className="my-1 h-px w-6 shrink-0 bg-edge" aria-hidden="true" />
      <div className="relative min-h-0 w-full flex-1">
      <div ref={scrollRef} data-plugin-scroll tabIndex={scrollState.overflow ? 0 : undefined} role="region" aria-label={tr('settings:pluginCenter.installedPlugins')}
        className="app-rail-plugin-scroll h-full w-full overflow-y-auto overscroll-y-contain outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
        style={{ paddingBlock: scrollState.overflow ? 16 : 0, scrollPaddingBlock: 16 }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
          const viewport = event.currentTarget;
          const distance = Math.max(40, viewport.clientHeight - 32);
          const offsets: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: distance, PageUp: -distance, Home: -viewport.scrollHeight, End: viewport.scrollHeight };
          if (!(event.key in offsets)) return;
          event.preventDefault(); event.stopPropagation();
          viewport.scrollBy({ top: offsets[event.key], behavior: 'auto' });
        }}>
      <div ref={contentRef} className="flex flex-col items-center gap-1">
      {shortcuts.map(plugin => {
        const name = pluginText(plugin.manifest, 'name', locale);
        return <button key={plugin.pluginKey} type="button" data-plugin-shortcut={plugin.pluginKey} aria-label={name} title={`${name} · v${plugin.manifest.version}`}
          disabled={opening !== null} aria-busy={opening === plugin.pluginKey || undefined} onClick={() => void open(plugin)}
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main disabled:opacity-60">
          {opening === plugin.pluginKey ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PluginIcon source={plugin.iconDataUrl} className="h-6 w-6" />}
        </button>;
      })}
      </div>
      </div>
      {scrollState.overflow && <>
        <button type="button" title={tr('settings:pluginCenter.scrollUp')} aria-label={tr('settings:pluginCenter.scrollUp')} disabled={!scrollState.above}
          style={{ visibility: scrollState.above ? 'visible' : 'hidden' }} onClick={() => scroll(-1)}
          className="app-rail-scroll-up absolute inset-x-1 top-0 z-10 flex h-4 items-center justify-center rounded text-quiet hover:text-main"><ChevronUp className="h-3 w-3" aria-hidden="true" /></button>
        <button type="button" title={tr('settings:pluginCenter.scrollDown')} aria-label={tr('settings:pluginCenter.scrollDown')} disabled={!scrollState.below}
          style={{ visibility: scrollState.below ? 'visible' : 'hidden' }} onClick={() => scroll(1)}
          className="app-rail-scroll-down absolute inset-x-1 bottom-0 z-10 flex h-4 items-center justify-center rounded text-quiet hover:text-main"><ChevronDown className="h-3 w-3" aria-hidden="true" /></button>
      </>}
      </div>
    </div>}
    {error && <PluginDialog title={`${tr('settings:pluginCenter.open')} · ${error.name}`} onClose={() => setError(null)}>
      <p role="alert" className="text-sm leading-6 text-danger">{error.message}</p>
      <div className="flex justify-end"><button type="button" className="ui-cancel-button rounded-lg px-4 py-2 text-sm" onClick={() => setError(null)}>{tr('settings:pluginCenter.close')}</button></div>
    </PluginDialog>}
  </>;
}
