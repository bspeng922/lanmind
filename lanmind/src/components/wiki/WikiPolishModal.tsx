import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Loader2, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import { useTheme } from '../../context/ThemeContext';
import { getWorkspaceContext, sameWorkspace, scopedStorageKey, type WorkspaceContext } from '../../utils/workspaceContext';
import { aiError, parseModelKey, type Catalog } from '../ai/aiClient';
import { GroupedModelSelect } from '../ai/GroupedModelSelect';
import { LLMConfigModal } from '../LLMConfigModal';
import type { WikiPolishTarget } from './WikiMarkdownEditor';
import { WikiPagePreview } from './WikiPagePreview';
import { polishDiff, polishModel, wikiPolishClient, type PolishMode } from './wikiPolish';

interface Props {
  documentId: string;
  title: string;
  target: WikiPolishTarget;
  scope: WorkspaceContext;
  onClose: () => void;
  onApply: (selection: boolean, result: string) => boolean;
}
type Status = 'idle' | 'generating' | 'completed' | 'stopped' | 'error';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-main hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40';

export function WikiPolishModal({ documentId, title, target, scope, onClose, onApply }: Props) {
  useLocale();
  const { currentTheme } = useTheme();
  const [mode, setMode] = useState<PolishMode>(target.selection ? 'selection' : 'document');
  const [view, setView] = useState<'diff' | 'read'>('diff');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [model, setModel] = useState('');
  const [loadingModels, setLoadingModels] = useState(true);
  const [instructions, setInstructions] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);
  const active = useRef<{ id: string; starting?: Promise<unknown> } | null>(null);
  const subscription = useRef<Promise<() => void> | null>(null);
  const preferenceKey = scopedStorageKey('wiki-polish-model', scope);
  const source = mode === 'selection' ? target.selection?.markdown || '' : target.baseContent;
  const generating = status === 'generating';
  const diffs = useMemo(() => status === 'completed' ? polishDiff(source, result) : null, [source, result, status]);

  const cancelActive = useCallback(async () => {
    const run = active.current;
    active.current = null;
    if (!run) return;
    try { await run.starting; } catch { /* Nothing was registered if start failed. */ }
    try { await wikiPolishClient.cancel(run.id, scope); } catch { /* Scope changes also cancel on the backend. */ }
  }, [scope]);

  const loadCatalog = useCallback(async () => {
    setLoadingModels(true);
    try {
      const next = await wikiPolishClient.catalog();
      if (!mounted.current || !sameWorkspace(scope)) return;
      let remembered = '';
      try { remembered = localStorage.getItem(preferenceKey) || ''; } catch { /* optional preference */ }
      setCatalog(next);
      setModel(previous => polishModel(next, previous || remembered));
      setError('');
    } catch (reason) {
      if (mounted.current) setError(aiError(reason));
    } finally { if (mounted.current) setLoadingModels(false); }
  }, [scope, preferenceKey]);

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    void loadCatalog();
    const catalogSubscription = wikiPolishClient.subscribeCatalog(() => { void loadCatalog(); });
    void catalogSubscription.catch(() => {});
    subscription.current = wikiPolishClient.subscribe(event => {
      if (!mounted.current || event.requestId !== active.current?.id || !sameWorkspace(scope, event.workspaceContext) || !sameWorkspace(scope)) return;
      if (event.type === 'delta') { setResult(previous => previous + event.text); setCopied(false); }
      else {
        active.current = null;
        if (event.type === 'done') { setResult(event.text); setStatus('completed'); }
        else {
          setStatus(event.type === 'cancelled' ? 'stopped' : 'error');
          setError(event.error?.code === 'INCOMPLETE_RESULT' ? tr('wiki:polish.incomplete')
            : event.error?.code === 'EMPTY_RESULT' ? tr('wiki:polish.emptyResult') : event.type === 'cancelled' ? '' : event.error?.message || tr('wiki:polish.failed'));
        }
      }
    });
    void subscription.current.catch(reason => { if (mounted.current) setError(aiError(reason)); });
    promptRef.current?.focus();
    return () => {
      mounted.current = false;
      void cancelActive();
      void subscription.current?.then(unsubscribe => unsubscribe()).catch(() => {});
      void catalogSubscription.then(unsubscribe => unsubscribe()).catch(() => {});
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [cancelActive, loadCatalog, scope]);

  useEffect(() => {
    if (settingsOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); }
      if (event.key === 'Escape') {
        // A model popup owns the first Escape; it closes at document bubble phase.
        if (document.querySelector('[role="listbox"]')) return;
        event.preventDefault(); event.stopPropagation(); onClose();
      }
      if (event.key === 'Tab') {
        if (document.querySelector('[role="listbox"]')) return;
        const focusable = Array.from<HTMLElement>(rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, [tabindex="0"]') || [])
          .filter(element => element.offsetParent !== null);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || !rootRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !rootRef.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose, settingsOpen]);

  const generate = async () => {
    const reference = parseModelKey(model);
    if (!reference || !source.trim() || generating || !sameWorkspace(scope)) return;
    await cancelActive();
    if (!mounted.current) return;
    const run: NonNullable<typeof active.current> = { id: crypto.randomUUID() };
    active.current = run;
    setResult(''); setError(''); setCopied(false); setStatus('generating');
    try {
      await subscription.current;
      if (active.current !== run || !mounted.current || !sameWorkspace(scope)) return;
      try { localStorage.setItem(preferenceKey, model); } catch { /* optional preference */ }
      run.starting = wikiPolishClient.start({ requestId: run.id, documentId, mode, title, content: source, instructions, modelRef: reference });
      await run.starting;
    } catch (reason) {
      if (mounted.current && active.current === run) { active.current = null; setStatus('error'); setError(aiError(reason)); }
    }
  };

  const resetResult = () => { setResult(''); setStatus('idle'); setError(''); setCopied(false); };
  const changeMode = (next: PolishMode) => { if (mode !== next) { setMode(next); resetResult(); } };
  const copy = async () => {
    try { await navigator.clipboard.writeText(result); setCopied(true); }
    catch { setError(tr('wiki:polish.copyFailed')); }
  };
  const apply = () => {
    if (!sameWorkspace(scope) || !onApply(mode === 'selection', result)) { setError(tr('wiki:polish.stale')); return; }
    onClose();
  };
  const diffContent = (side: 'before' | 'after') => diffs?.filter(([operation]) => side === 'before' ? operation !== 1 : operation !== -1)
    .map(([operation, text], index) => operation === 0 ? <span key={index}>{text}</span>
      : operation < 0 ? <del key={index} className="rounded-sm bg-danger/15 text-danger decoration-danger/60">{text}</del>
      : <ins key={index} className="rounded-sm bg-success/15 text-success no-underline">{text}</ins>);

  return createPortal(<>
    <div data-theme={currentTheme.id} className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="wiki-polish-title"
        className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-popover">
        <header className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3">
          <h2 id="wiki-polish-title" className="flex items-center gap-2 text-sm font-semibold text-main"><Sparkles className="h-4 w-4 text-accent" />{tr('wiki:polish.title')}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-sub hover:bg-hover" aria-label={tr('wiki:polish.close')}><X className="h-4 w-4" /></button>
        </header>
        <section className="shrink-0 space-y-3 border-b border-edge px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label={tr('wiki:polish.range')} className="flex gap-1 rounded-lg bg-input p-1">
              {(['document', 'selection'] as const).map(value => <button key={value} type="button" disabled={generating || (value === 'selection' && !target.selection)}
                aria-pressed={mode === value} onClick={() => changeMode(value)} className={`${button} ${mode === value ? 'border-edge bg-surface' : 'border-transparent'}`}>{tr(`wiki:polish.${value}`)}</button>)}
            </div>
            {catalog && model && <GroupedModelSelect catalog={catalog} value={model} onChange={value => { if (value !== model) { setModel(value); resetResult(); } }} disabled={generating} label={tr('wiki:polish.model')} width="min(280px, 70vw)" />}
            {loadingModels && <span role="status" className="text-xs text-quiet">{tr('wiki:polish.loadingModels')}</span>}
            {!loadingModels && !model && <span className="text-xs text-sub">{tr('wiki:polish.noModels')}</span>}
            <button type="button" disabled={generating} className={button} onClick={() => setSettingsOpen(true)}>{tr('wiki:polish.configure')}</button>
          </div>
          <label className="block text-xs font-medium text-main" htmlFor="wiki-polish-instructions">{tr('wiki:polish.instructions')}</label>
          <textarea ref={promptRef} id="wiki-polish-instructions" value={instructions} disabled={generating} maxLength={5000}
            onChange={event => { setInstructions(event.target.value); resetResult(); }} placeholder={tr('wiki:polish.placeholder')} rows={2}
            className="block w-full resize-y rounded-lg border border-edge bg-input px-3 py-2 text-sm text-main placeholder:text-quiet focus:border-accent focus:outline-none disabled:opacity-60" />
          <div className="flex flex-wrap gap-2">
            {['concise', 'formal', 'structure', 'grammar'].map(preset => <button key={preset} type="button" disabled={generating} className={button}
              onClick={() => { setInstructions(tr(`wiki:polish.preset.${preset}Prompt`)); resetResult(); }}>{tr(`wiki:polish.preset.${preset}`)}</button>)}
          </div>
          {mode === 'selection' && <p className="text-xs text-quiet">{tr('wiki:polish.selectionContext')}</p>}
        </section>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-5 py-2">
          <span role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-sub">
            {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {tr(`wiki:polish.status.${status}`)}
          </span>
          <div role="group" aria-label={tr('wiki:polish.comparison')} className="flex gap-1">
            {(['diff', 'read'] as const).map(value => <button key={value} type="button" className={`${button} ${view === value ? 'bg-input' : ''}`} aria-pressed={view === value} onClick={() => setView(value)}>{tr(`wiki:polish.${value}`)}</button>)}
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-2 overflow-hidden md:grid-cols-2 md:grid-rows-1">
          {(['before', 'after'] as const).map(side => <section key={side} aria-label={tr(`wiki:polish.${side}`)} className={`flex min-h-0 min-w-0 flex-col ${side === 'before' ? 'border-b border-edge md:border-r md:border-b-0' : ''}`}>
            <h3 className="shrink-0 border-b border-edge bg-canvas/50 px-5 py-2 text-xs font-semibold text-main">{tr(`wiki:polish.${side}`)}</h3>
            <div className="min-h-0 flex-1 overflow-auto p-5 select-text">
              {view === 'read' ? <WikiPagePreview content={side === 'before' ? source : result} />
                : <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-main">{diffs ? diffContent(side) : side === 'before' ? source : result || tr('wiki:polish.resultPlaceholder')}</pre>}
            </div>
          </section>)}
        </div>
        {error && <p role="alert" className="shrink-0 border-t border-edge bg-danger/10 px-5 py-2 text-xs text-danger">{error}</p>}
        {status === 'completed' && result === source && <p role="status" className="shrink-0 px-5 py-2 text-xs text-sub">{tr('wiki:polish.unchanged')}</p>}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge px-5 py-3">
          <p className="text-xs text-quiet">{tr('wiki:polish.draftHint')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={copy} disabled={!result}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{tr(copied ? 'wiki:polish.copied' : 'wiki:polish.copy')}</button>
            {generating ? <button type="button" className={button} onClick={() => { setStatus('stopped'); void cancelActive(); }}><Square className="h-3.5 w-3.5" />{tr('wiki:polish.stop')}</button>
              : <button type="button" className={button} onClick={generate} disabled={!model || loadingModels || !source.trim()}>{status === 'idle' ? <Sparkles className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{tr(status === 'idle' ? 'wiki:polish.generate' : 'wiki:polish.regenerate')}</button>}
            <button type="button" className={`${button} border-accent bg-accent text-on-accent hover:bg-accent/90`} onClick={apply} disabled={status !== 'completed' || !result.trim() || result === source}>{tr('wiki:polish.apply')}</button>
          </div>
        </footer>
      </div>
    </div>
    {settingsOpen && <LLMConfigModal isOpen onClose={() => { setSettingsOpen(false); void loadCatalog(); promptRef.current?.focus(); }} />}
  </>, document.body);
}
