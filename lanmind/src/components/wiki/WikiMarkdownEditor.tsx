import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type Vditor from 'vditor';
import { tr, useLocale } from '../../i18n';
import { useTheme } from '../../context/ThemeContext';
import { getWorkspaceContext, sameWorkspace } from '../../utils/workspaceContext';
import type { EditorMode } from './WikiEditorTopBar';
import { createWikiToolbar } from './wikiEditorToolbar';
import { canonicalizeWikiAssetUrls } from './wikiAssetStore';
import { clipboardFiles, hydrateWikiAssets, wikiFilesMarkdown } from './wikiAssetHelper';
import { renderWikiMarkdown, wikiReferenceLinkUrl } from './wikiMarkdown';
import { wikiCodeLanguages } from '../richContent/codeHighlight';
import { installWikiSerializationCache } from './wikiEditorPerformance';
import { installWikiRichPreview } from './wikiRichPreview';
import { InlineReferencePicker } from '../common/InlineReferencePicker';
import type { ReferenceItem } from '../../utils/referenceSearch';
import { normalizeLatexMathDelimiters, preserveLatexMathDelimiters } from '../richContent/latexMath';
import { wikiIdFromLink, navigateReferenceUrl } from './wikiLinks';
import { installWikiEditorHint } from './wikiEditorHint';
import 'vditor/dist/index.css';
import './wiki-editor.css';

export interface WikiMarkdownEditorHandle {
  getValue(): string;
  insertMarkdown(markdown: string): void;
  replaceDocument(markdown: string): void;
  focus(): void;
  capturePolishTarget(): WikiPolishTarget | null;
  applyPolish(target: WikiPolishTarget, markdown: string, selection: boolean): boolean;
}

export interface WikiPolishTarget {
  baseContent: string;
  selection?: { markdown: string; token: string };
}

interface Props {
  documentKey: string;
  value: string;
  mode: EditorMode;
  readOnly: boolean;
  onChange: (markdown: string) => void;
  onReady?: () => void;
  onError?: (error: unknown) => void;
  onBlur?: () => void;
}

type EditMode = 'ir' | 'sv';
interface Position { range?: Range; start: number; end: number; scroll: number }
const scriptLoads = new Map<string, Promise<void>>();
function loadLocalScript(path: string, id: string): Promise<void> {
  const pending = scriptLoads.get(id);
  if (pending && document.getElementById(id)) return pending;
  if (document.getElementById(id)) return Promise.resolve();
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = id;
    script.src = `${import.meta.env.BASE_URL}vendor/vditor/dist/js/${path}`;
    script.onload = () => resolve();
    script.onerror = error => { script.remove(); scriptLoads.delete(id); reject(error); };
    document.head.appendChild(script);
  });
  scriptLoads.set(id, promise);
  return promise;
}

/** Vditor also records caret/DOM changes when switching modes. Keep undo steps tied to content. */
function installWikiUndoHistory(editor: Vditor, readValue: (editor: Vditor) => string) {
  const undo = editor.vditor.undo;
  if (!undo) return;
  const recorded = new Map([[editor.getCurrentMode(), readValue(editor)]]);
  const add = undo.addToUndoStack.bind(undo);
  undo.addToUndoStack = state => {
    const value = readValue(editor);
    if (recorded.get(editor.getCurrentMode()) === value) return;
    add(state);
    recorded.set(editor.getCurrentMode(), value);
  };
  for (const action of ['undo', 'redo'] as const) {
    const perform = undo[action].bind(undo);
    undo[action] = state => {
      perform(state);
      recorded.set(editor.getCurrentMode(), readValue(editor));
    };
  }
  const clear = undo.clearStack.bind(undo);
  undo.clearStack = state => {
    recorded.clear();
    clear(state);
  };
}

/** Owns the imperative editor. React updates never replace a live document. */
export const WikiMarkdownEditor = forwardRef<WikiMarkdownEditorHandle, Props>(function WikiMarkdownEditor(props, ref) {
  const { locale } = useLocale();
  const { currentTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<Vditor | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const valueRef = useRef(props.value);
  const kernelValueRef = useRef('');
  const composingRef = useRef(false);
  const suppressRef = useRef(false);
  const readyRef = useRef(false);
  const mountedRef = useRef(false);
  const filePositionRef = useRef<Position | null>(null);
  const positionsRef = useRef<Partial<Record<EditMode, Position>>>({});
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [assetError, setAssetError] = useState(false);
  const retryFilesRef = useRef<File[]>([]);
  const scopeRef = useRef(getWorkspaceContext());
  const themeRef = useRef(currentTheme.id);
  themeRef.current = currentTheme.id;
  const publishRef = useRef<(markdown?: string) => string>(() => valueRef.current);
  const polishSelectionRef = useRef<{ token: string; mode: string; position: Position; markdown: string } | null>(null);
  const fallbackUndoRef = useRef<{ before: string; after: string; undone: boolean } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const savedRangeRef = useRef<Range | null>(null);

  const checkInlineReferenceTrigger = () => {
    if (propsRef.current.readOnly) return;
    const editor = editorRef.current;
    if (!editor || !readyRef.current) return;

    const mode = editor.getCurrentMode();
    if (mode === 'ir') {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      const text = range.startContainer.textContent || '';
      const textBefore = text.substring(0, range.startOffset);
      if (textBefore.endsWith('[[') || textBefore.endsWith('((')) {
        savedRangeRef.current = range.cloneRange();
        let top = 0;
        let left = 0;
        try {
          if (range.startOffset >= 2) {
            const measureRange = range.cloneRange();
            measureRange.setStart(range.startContainer, range.startOffset - 2);
            const mRect = measureRange.getBoundingClientRect();
            if (mRect.bottom > 0) {
              top = mRect.bottom + 4;
              left = mRect.left;
            }
          }
        } catch {
          // ignore measurement errors
        }
        if (!top) {
          const rect = range.getBoundingClientRect();
          top = (rect.bottom > 0 ? rect.bottom : rect.top + 20) + 4;
          left = rect.left;
        }
        if (!top || (top === 4 && left === 0)) {
          const parentRect = range.startContainer.parentElement?.getBoundingClientRect();
          if (parentRect) {
            top = parentRect.bottom + 4;
            left = parentRect.left;
          }
        }
        top = top || 120;
        left = Math.max(16, Math.min(left || 120, window.innerWidth - 380));
        setPickerPos({ top, left });
        setPickerOpen(true);
      }
    } else if (mode === 'sv') {
      const textarea = editor.vditor.sv?.element;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = textarea.value.slice(0, cursor);
      if (before.endsWith('[[') || before.endsWith('((')) {
        const rect = textarea.getBoundingClientRect();
        setPickerPos({
          top: rect.top + 32,
          left: Math.max(16, Math.min(rect.left + 24, window.innerWidth - 380)),
        });
        setPickerOpen(true);
      }
    }
  };

  const handleSelectReference = (item: ReferenceItem) => {
    const editor = editorRef.current;
    setPickerOpen(false);
    setPickerPos(null);

    if (!editor || !readyRef.current) return;
    const mode = editor.getCurrentMode();

    if (mode === 'ir') {
      const irElement = editor.vditor.ir?.element;
      irElement?.focus();

      const selection = window.getSelection();
      const range = savedRangeRef.current || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
      if (range && selection) {
        selection.removeAllRanges();
        selection.addRange(range);

        if (range.startOffset >= 2 && range.startContainer.nodeType === Node.TEXT_NODE) {
          const text = range.startContainer.textContent || '';
          const before = text.substring(0, range.startOffset);
          if (before.endsWith('[[') || before.endsWith('((')) {
            range.setStart(range.startContainer, range.startOffset - 2);
            range.deleteContents();
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
      editor.insertMD(item.markdown + ' ');
      publishRef.current();
    } else if (mode === 'sv') {
      const textarea = editor.vditor.sv?.element;
      if (textarea) {
        textarea.focus();
        const cursor = textarea.selectionStart;
        const text = textarea.value;
        const before = text.slice(0, cursor);
        let start = cursor;
        if (before.endsWith('[[') || before.endsWith('((')) {
          start = cursor - 2;
        }
        const next = text.slice(0, start) + item.markdown + ' ' + text.slice(cursor);
        textarea.value = next;
        const newCursor = start + item.markdown.length + 1;
        textarea.setSelectionRange(newCursor, newCursor);
        publishRef.current();
      }
    }
    savedRangeRef.current = null;
  };

  const activeElement = () => {
    const editor = editorRef.current;
    return fallbackRef.current || (editor?.getCurrentMode() === 'sv' ? editor.vditor.sv?.element : editor?.vditor.ir?.element);
  };
  // Vditor.getValue() adds a newline in source mode. Source is lossless.
  const readKernelValue = (editor: Vditor) => canonicalizeWikiAssetUrls(
    editor.getCurrentMode() === 'sv' ? editor.vditor.sv.element.value : preserveLatexMathDelimiters(editor.getValue(), valueRef.current),
  );
  const canvas = () => hostRef.current?.closest<HTMLElement>('[data-wiki-canvas]');
  const snapshot = (): Position => {
    const element = activeElement();
    if (element instanceof HTMLTextAreaElement) return { start: element.selectionStart, end: element.selectionEnd, scroll: canvas()?.scrollTop || 0 };
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    let start = 0;
    if (element && range && element.contains(range.commonAncestorContainer)) {
      const before = range.cloneRange();
      before.selectNodeContents(element);
      before.setEnd(range.startContainer, range.startOffset);
      start = before.toString().length;
      return { range: range.cloneRange(), start, end: start + range.toString().length, scroll: canvas()?.scrollTop || 0 };
    }
    return { start, end: start, scroll: canvas()?.scrollTop || 0 };
  };
  const restore = (position: Position) => {
    const element = activeElement();
    if (!element) return;
    if (element instanceof HTMLTextAreaElement) element.setSelectionRange(position.start, position.end);
    else {
      let range = position.range;
      if (!range || !element.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let offset = position.start;
        while (walker.nextNode()) {
          if (offset <= (walker.currentNode.textContent?.length || 0)) {
            range.setStart(walker.currentNode, offset); range.collapse(true); break;
          }
          offset -= walker.currentNode.textContent?.length || 0;
        }
      }
      const selection = window.getSelection();
      selection?.removeAllRanges(); selection?.addRange(range);
    }
    if (canvas()) canvas()!.scrollTop = position.scroll;
  };
  const resize = () => {
    const element = editorRef.current?.vditor.sv?.element || fallbackRef.current;
    if (!element || element.offsetParent === null) return;
    const viewport = canvas();
    const scroll = viewport?.scrollTop;
    const followBottom = viewport && viewport.scrollTop > 0 && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 4;
    const minimum = viewport ? Math.max(320, viewport.clientHeight - (element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop) - 32) : 320;
    element.style.height = '0px';
    element.style.height = `${Math.max(minimum, element.scrollHeight + 2)}px`;
    element.scrollTop = 0;
    if (viewport && scroll !== undefined) viewport.scrollTop = followBottom ? viewport.scrollHeight - viewport.clientHeight : scroll;
  };
  const publish = (normalizedMarkdown?: string) => {
    const editor = editorRef.current;
    if (!editor || !readyRef.current || suppressRef.current || composingRef.current || propsRef.current.readOnly) return valueRef.current;
    const value = normalizedMarkdown !== undefined && editor.getCurrentMode() === 'ir'
      ? canonicalizeWikiAssetUrls(preserveLatexMathDelimiters(normalizedMarkdown, valueRef.current)) : readKernelValue(editor);
    if (value !== kernelValueRef.current) {
      kernelValueRef.current = value;
      valueRef.current = value;
      propsRef.current.onChange(value);
      resize();
    }
    return valueRef.current;
  };
  publishRef.current = publish;

  const insertMarkdown = (markdown: string) => {
    if (propsRef.current.readOnly) return;
    const editor = editorRef.current;
    if (editor && readyRef.current) {
      editor.insertMD(markdown);
      publish();
    } else if (fallbackRef.current) {
      const element = fallbackRef.current;
      const start = element.selectionStart;
      const next = valueRef.current.slice(0, start) + markdown + valueRef.current.slice(element.selectionEnd);
      valueRef.current = next; propsRef.current.onChange(next);
      requestAnimationFrame(() => { element.setSelectionRange(start + markdown.length, start + markdown.length); resize(); });
    }
  };

  const mountToolbarToSlot = () => {
    const slot = document.getElementById('wiki-toolbar-slot');
    const toolbar = editorRef.current?.vditor?.toolbar?.element || hostRef.current?.querySelector<HTMLElement>('.vditor-toolbar');
    if (slot && toolbar && toolbar.parentElement !== slot) {
      slot.innerHTML = '';
      slot.appendChild(toolbar);
    }
  };

  const applyMode = () => {
    const editor = editorRef.current;
    const { mode, readOnly } = propsRef.current;
    if (!editor || !readyRef.current) return;
    const target = mode === 'live' ? 'ir' : 'sv';
    const previous = editor.getCurrentMode() as EditMode;
    if (target !== previous) {
      publish();
      // Flush pending typing in its original mode before Vditor changes currentMode.
      window.clearTimeout(editor.vditor[previous]?.processTimeoutId);
      editor.vditor.undo?.addToUndoStack(editor.vditor);
      const position = snapshot();
      positionsRef.current[previous] = position;
      suppressRef.current = true;
      // Protect multiline LaTeX from Lute's Setext heading parser before it builds IR.
      if (target === 'ir') editor.vditor.sv.element.value = normalizeLatexMathDelimiters(valueRef.current);
      // Keep this bridge scoped to the pinned Vditor version; business UI never touches it.
      const button = editor.vditor.toolbar?.elements?.['edit-mode']?.querySelector<HTMLButtonElement>(`button[data-mode="${target}"]`);
      button?.dispatchEvent(new Event(navigator.userAgent.includes('iPhone') ? 'touchstart' : 'click', { bubbles: true, cancelable: true }));
      if (target === 'sv') {
        editor.setValue(valueRef.current);
        editor.vditor.sv.element.value = valueRef.current;
      }
      window.clearTimeout(editor.vditor[target]?.processTimeoutId);
      restore(positionsRef.current[target] || position);
      editor.vditor.undo?.addToUndoStack(editor.vditor);
      editor.vditor.undo?.resetIcon(editor.vditor);
      kernelValueRef.current = readKernelValue(editor);
      suppressRef.current = false;
    }
    if (target === 'ir') {
      if (editor.vditor.sv?.element) editor.vditor.sv.element.style.display = 'none';
      if (editor.vditor.preview?.element) editor.vditor.preview.element.style.display = 'none';
      if (editor.vditor.ir?.element?.parentElement) editor.vditor.ir.element.parentElement.style.display = 'block';
    } else {
      if (editor.vditor.ir?.element?.parentElement) editor.vditor.ir.element.parentElement.style.display = 'none';
      editor.setPreviewMode('editor');
    }
    if (readOnly) editor.disabled(); else editor.enable();
    mountToolbarToSlot();
    const slot = document.getElementById('wiki-toolbar-slot');
    const toolbar = slot?.querySelector<HTMLElement>('.vditor-toolbar') || hostRef.current?.querySelector<HTMLElement>('.vditor-toolbar');
    toolbar?.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = readOnly; });
    resize();
  };

  const replaceDocument = (markdown: string) => {
    const normalized = normalizeLatexMathDelimiters(markdown);
    valueRef.current = markdown;
    if (!editorRef.current || !readyRef.current) return;
    suppressRef.current = true;
    editorRef.current.setValue(normalized, true);
    if (editorRef.current.getCurrentMode() === 'sv') editorRef.current.vditor.sv.element.value = markdown;
    kernelValueRef.current = readKernelValue(editorRef.current);
    suppressRef.current = false;
    positionsRef.current = {};
    resize();
  };
  const serializePolishRange = (range: Range): string => {
    const fragment = document.createElement('div');
    fragment.appendChild(range.cloneContents());
    return canonicalizeWikiAssetUrls(editorRef.current!.vditor.lute.VditorIRDOM2Md(fragment.innerHTML)).replace(/\n$/, '');
  };
  const capturePolishTarget = (): WikiPolishTarget | null => {
    if (composingRef.current) return null;
    const baseContent = publish();
    const position = snapshot();
    const element = activeElement();
    let markdown = '';
    if (element instanceof HTMLTextAreaElement) {
      markdown = baseContent.slice(position.start, position.end);
    } else if (position.range && !position.range.collapsed && editorRef.current) {
      markdown = serializePolishRange(position.range);
    }
    if (!markdown.trim()) { polishSelectionRef.current = null; return { baseContent }; }
    const token = crypto.randomUUID();
    polishSelectionRef.current = { token, mode: propsRef.current.mode, position, markdown };
    return { baseContent, selection: { markdown, token } };
  };

  const applyPolish = (target: WikiPolishTarget, markdown: string, selection: boolean): boolean => {
    if (propsRef.current.readOnly || publish() !== target.baseContent || !markdown.trim()) return false;
    const captured = polishSelectionRef.current;
    const element = activeElement();
    if (!element) return false;
    if (selection) {
      if (!target.selection || !captured || captured.token !== target.selection.token || captured.mode !== propsRef.current.mode) return false;
      const range = captured.position.range;
      if (element instanceof HTMLTextAreaElement) {
        if (valueRef.current.slice(captured.position.start, captured.position.end) !== captured.markdown) return false;
      } else if (!range || range.collapsed || !element.contains(range.startContainer) || !element.contains(range.endContainer)
        || serializePolishRange(range) !== captured.markdown) return false;
    }
    const editor = editorRef.current;
    if (editor && readyRef.current) {
      const mode = editor.getCurrentMode() as EditMode;
      window.clearTimeout(editor.vditor[mode]?.processTimeoutId);
      editor.vditor.undo?.addToUndoStack(editor.vditor);
      if (selection && captured) {
        element.focus();
        restore(captured.position);
        const fragment = document.createElement('div');
        if (mode === 'ir') fragment.innerHTML = editor.vditor.lute.Md2VditorIRDOM(markdown);
        const paragraph = fragment.firstElementChild;
        if (paragraph?.tagName === 'P' && fragment.childElementCount === 1) {
          // insertMD trims inline whitespace; native replacement keeps word boundaries.
          const selectedText = captured.position.range?.toString() || '';
          paragraph.prepend(document.createTextNode(markdown.match(/^[ \t]+/)?.[0] || selectedText.match(/^[ \t]+/)?.[0] || ''));
          paragraph.append(document.createTextNode(markdown.match(/[ \t]+$/)?.[0] || selectedText.match(/[ \t]+$/)?.[0] || ''));
          editor.updateValue(paragraph.innerHTML);
        } else editor.insertMD(markdown);
      } else {
        editor.setValue(markdown, false);
        if (mode === 'sv') editor.vditor.sv.element.value = markdown;
      }
      publish();
      window.clearTimeout(editor.vditor[mode]?.processTimeoutId);
      editor.vditor.undo?.addToUndoStack(editor.vditor);
      editor.vditor.undo?.resetIcon(editor.vditor);
    } else if (element instanceof HTMLTextAreaElement) {
      const next = selection && captured
        ? target.baseContent.slice(0, captured.position.start) + markdown + target.baseContent.slice(captured.position.end)
        : markdown;
      fallbackUndoRef.current = { before: target.baseContent, after: next, undone: false };
      valueRef.current = next;
      propsRef.current.onChange(next);
    } else return false;
    polishSelectionRef.current = null;
    resize();
    return true;
  };
  useImperativeHandle(ref, () => ({ getValue: publish, insertMarkdown, replaceDocument, capturePolishTarget, applyPolish,
    focus: () => { editorRef.current?.focus(); fallbackRef.current?.focus(); } }));

  const addFiles = async (files: File[], position = snapshot()) => {
    if (!files.length || propsRef.current.readOnly) return;
    const key = propsRef.current.documentKey;
    const editor = editorRef.current;
    retryFilesRef.current = files;
    filePositionRef.current = position;
    setAssetError(false);
    try {
      const markdown = await wikiFilesMarkdown(files);
      if (!mountedRef.current || propsRef.current.documentKey !== key || propsRef.current.readOnly || (scopeRef.current && !sameWorkspace(scopeRef.current))) return;
      if (editor && editor !== editorRef.current) return;
      restore(position);
      insertMarkdown(markdown);
      retryFilesRef.current = [];
    } catch (error) {
      if (mountedRef.current) { setAssetError(true); propsRef.current.onError?.(error); }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    let initializationFailed = false;
    let editor: Vditor | undefined;
    let observer: MutationObserver | undefined;
    let sizeObserver: ResizeObserver | undefined;
    let disposeRichPreview: (() => void) | undefined;
    const fail = (error: unknown) => {
      if (disposed) return;
      initializationFailed = true;
      window.clearTimeout(timeout);
      readyRef.current = false;
      editorRef.current = null;
      setFailed(true);
      propsRef.current.onError?.(error);
    };
    const timeout = window.setTimeout(() => fail(new Error('Wiki editor initialization timed out')), 15_000);
    // Preload external scripts so failures reach our fallback and initialization
    // cannot start after unmount. Vditor's synchronous icon fallback violates CSP.
    const language = locale.startsWith('zh') ? 'zh_CN' : 'en_US';
    void Promise.all([
      import('vditor'),
      loadLocalScript('icons/ant.js', 'vditorIconScript'),
      loadLocalScript(`i18n/${language}.js`, `vditorI18nScript${language}`),
      loadLocalScript('lute/lute.min.js', 'vditorLuteScript'),
    ]).then(([{ default: Editor }]) => {
      if (disposed || initializationFailed || !hostRef.current) return;
      const initialContent = normalizeLatexMathDelimiters(valueRef.current);
      editor = new Editor(hostRef.current, {
        value: initialContent,
        mode: propsRef.current.mode === 'live' ? 'ir' : 'sv',
        cdn: `${import.meta.env.BASE_URL}vendor/vditor`,
        lang: language,
        i18n: window.VditorI18n,
        theme: themeRef.current === 'light' ? 'classic' : 'dark',
        cache: { enable: false },
        undoDelay: 150,
        height: 'auto',
        minHeight: 320,
        placeholder: tr('wiki:wikiEditor.contentPlaceholder'),
        toolbar: createWikiToolbar(accept => {
          if (propsRef.current.readOnly || !inputRef.current) return;
          filePositionRef.current = snapshot();
          inputRef.current.accept = accept; inputRef.current.click();
        }, (prefix, suffix) => {
          const instance = editorRef.current;
          if (!instance || propsRef.current.readOnly) return;
          instance.updateValue(prefix + instance.getSelection() + suffix);
          publishRef.current();
        }),
        preview: {
          mode: 'editor',
          delay: 200,
          maxWidth: 10000,
          markdown: { mark: true, autoSpace: false, fixTermTypo: false, toc: false, footnotes: false, callout: false, inlineMath: false, mathBlockPreview: false, codeBlockPreview: false, sanitize: true },
          theme: { current: 'light', path: `${import.meta.env.BASE_URL}vendor/vditor/dist/css/content-theme` },
          hljs: { enable: true, style: 'github', lineNumber: false, langs: wikiCodeLanguages } as any,
          transform: () => renderWikiMarkdown(valueRef.current),
          parse: element => {
            // Shared previews own these blocks. Never start Vditor's remote renderers.
            element.querySelectorAll('code[class]').forEach(code => {
              for (const language of ['mermaid', 'plantuml', 'markmap', 'smiles', 'flowchart', 'graphviz', 'wavedrom', 'echarts', 'mindmap', 'abc', 'math']) {
                if (code.classList.contains(`language-${language}`)) {
                  code.classList.replace(`language-${language}`, `wiki-language-${language}`);
                }
              }
            });
            void hydrateWikiAssets(element).catch(() => {});
          },
          actions: [],
          render: { media: { enable: false } },
        },
        hint: {
          emoji: {},
          emojiPath: `${import.meta.env.BASE_URL}vendor/vditor/dist/images/emoji`,
        },
        link: { isOpen: false },
        image: { isPreview: false },
        input: markdown => {
          publishRef.current(markdown);
          queueMicrotask(checkInlineReferenceTrigger);
        },
        blur: () => { publishRef.current(); propsRef.current.onBlur?.(); },
        after: () => {
          window.clearTimeout(timeout);
          if (disposed || initializationFailed || !editor) { editor?.destroy(); return; }
          editorRef.current = editor;
          // Wiki owns its navigation and disables [ToC]. Vditor still rebuilds
          // its hidden outline on every input, which is costly on long pages.
          editor.vditor.outline.render = () => '';
          suppressRef.current = true;
          const content = normalizeLatexMathDelimiters(valueRef.current);
          editor.setValue(content, true);
          if (editor.getCurrentMode() === 'sv') editor.vditor.sv.element.value = valueRef.current;
          kernelValueRef.current = readKernelValue(editor);
          suppressRef.current = false;
          readyRef.current = true;
          // Editing uses the same soft-break convention as existing Wiki previews.
          const lute = editor.vditor.lute as Lute & { SetSoftBreak2HardBreak?: (enabled: boolean) => void };
          lute.SetSoftBreak2HardBreak?.(true);
          installWikiSerializationCache(editor);
          disposeRichPreview = installWikiRichPreview(editor);
          installWikiEditorHint(editor);
          installWikiUndoHistory(editor, readKernelValue);
          const label = tr('wiki:wikiEditor.contentLabel');
          [editor.vditor.ir?.element, editor.vditor.sv?.element].forEach(element => {
            element?.setAttribute('aria-label', label);
            element?.setAttribute('role', 'textbox');
            element?.setAttribute('aria-multiline', 'true');
            element?.setAttribute('spellcheck', 'false');
          });
          observer = new MutationObserver(() => { if (hostRef.current) void hydrateWikiAssets(hostRef.current).catch(() => {}); });
          observer.observe(hostRef.current!, { childList: true, subtree: true });
          void hydrateWikiAssets(hostRef.current!).catch(() => {});
          let width = hostRef.current!.clientWidth;
          let height = canvas()?.clientHeight;
          sizeObserver = new ResizeObserver(() => {
            if (hostRef.current?.clientWidth !== width || canvas()?.clientHeight !== height) {
              width = hostRef.current!.clientWidth; height = canvas()?.clientHeight; resize();
            }
          });
          sizeObserver.observe(hostRef.current!);
          if (canvas()) sizeObserver.observe(canvas()!);
          mountToolbarToSlot();
          setReady(true);
          applyMode();
          propsRef.current.onReady?.();
        },
      });
    }).catch(fail);
    return () => {
      publishRef.current();
      disposed = true; mountedRef.current = false; readyRef.current = false;
      window.clearTimeout(timeout);
      observer?.disconnect(); sizeObserver?.disconnect();
      disposeRichPreview?.();
      if (editor?.vditor?.ir) window.clearTimeout(editor.vditor.ir.processTimeoutId);
      if (editor?.vditor?.sv) window.clearTimeout(editor.vditor.sv.processTimeoutId);
      editor?.destroy(); editorRef.current = null;
      const slot = document.getElementById('wiki-toolbar-slot');
      if (slot) slot.innerHTML = '';
    };
  }, [props.documentKey]);

  useLayoutEffect(() => { applyMode(); mountToolbarToSlot(); }, [props.mode, props.readOnly, ready]);
  useLayoutEffect(() => { if (props.value !== valueRef.current) replaceDocument(props.value); }, [props.value, ready]);
  useEffect(() => {
    if (!readyRef.current) return;
    editorRef.current?.setTheme(currentTheme.id === 'light' ? 'classic' : 'dark', undefined, currentTheme.id === 'light' ? 'github' : 'github-dark');
  }, [currentTheme.id, ready]);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const linkSelector = '[data-type="a"], [data-type="link-ref"], a[href]';
    const linkUrl = (target: EventTarget | null) => {
      const link = target instanceof Element ? target.closest<HTMLElement>(linkSelector) : null;
      if (!link) return '';
      if (link.tagName === 'A') return link.getAttribute('href') || '';
      // A linked image also has a link marker; only the outer link's marker is its destination.
      const marker = link.querySelector(':scope > .vditor-ir__marker--link');
      const value = marker?.textContent?.replace(/\u200b/g, '').trim() || '';
      return link.dataset.type === 'link-ref' ? wikiReferenceLinkUrl(valueRef.current, value) : value;
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || (!e.ctrlKey && !e.metaKey) || !linkUrl(e.target)) return;
      // Keep the editor from moving the caret or rebuilding the link before click arrives.
      e.preventDefault(); e.stopPropagation();
    };
    const handleContainerClick = (e: MouseEvent) => {
      if (e.button !== 0 || (!e.ctrlKey && !e.metaKey)) return;
      const url = linkUrl(e.target);
      if (url) {
        e.preventDefault();
        e.stopPropagation();
        navigateReferenceUrl(url);
      }
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const aElement = target.closest<HTMLElement>(linkSelector);
      if (aElement && !aElement.getAttribute('title')) {
        const hintText = tr('wiki:wikiEditor.followLinkHint') || 'Ctrl + 单击以访问链接';
        aElement.setAttribute('title', hintText);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === '[' || e.key === '(') {
        checkInlineReferenceTrigger();
      }
    };

    container.addEventListener('mousedown', handleMouseDown, true);
    container.addEventListener('click', handleContainerClick, true);
    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('keyup', handleKeyUp);
    return () => {
      container.removeEventListener('mousedown', handleMouseDown, true);
      container.removeEventListener('click', handleContainerClick, true);
      container.removeEventListener('mouseover', handleMouseOver);
      container.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const blockReadOnly = (event: React.SyntheticEvent) => {
    if (propsRef.current.readOnly) { event.preventDefault(); event.stopPropagation(); return true; }
    return false;
  };

  return <div className="wiki-markdown-editor" data-editor-ready={ready || failed ? 'true' : 'false'} data-editor-mode={props.mode}
    onCompositionStartCapture={() => { composingRef.current = true; }}
    onCompositionEndCapture={() => { composingRef.current = false; queueMicrotask(() => publishRef.current()); }}
    onBlurCapture={() => { queueMicrotask(() => { publishRef.current(); propsRef.current.onBlur?.(); }); }}
    onKeyDownCapture={event => {
      if (pickerOpen) return;
      if (event.nativeEvent.isComposing || composingRef.current) return;
      const undo = fallbackUndoRef.current;
      if (failed && undo && !props.readOnly && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        const redo = event.shiftKey || event.key.toLowerCase() === 'y';
        if ((!redo && !undo.undone && valueRef.current === undo.after) || (redo && undo.undone && valueRef.current === undo.before)) {
          event.preventDefault(); event.stopPropagation();
          undo.undone = !redo;
          valueRef.current = redo ? undo.after : undo.before;
          propsRef.current.onChange(valueRef.current);
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.altKey && ['7', '8', '9'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); return; }
      if (props.readOnly && (event.key.length === 1 && !(event.ctrlKey || event.metaKey) || ['Backspace', 'Delete', 'Enter', 'Tab'].includes(event.key))) { blockReadOnly(event); return; }
      if (editorRef.current && readyRef.current && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.stopPropagation();
        editorRef.current?.vditor.toolbar?.elements?.redo?.querySelector<HTMLButtonElement>('button')?.click();
      }
    }}
    onClickCapture={event => {
      const target = event.target as HTMLElement;
      if (props.readOnly && (target.closest('.vditor-toolbar') || target instanceof HTMLInputElement)) { blockReadOnly(event); return; }
      if (target instanceof HTMLInputElement && target.type === 'checkbox') queueMicrotask(() => publishRef.current());
    }}
    onPasteCapture={event => {
      if (blockReadOnly(event)) return;
      const files = clipboardFiles(event.clipboardData);
      if (files.length) { event.preventDefault(); event.stopPropagation(); void addFiles(files); return; }
      const text = event.clipboardData.getData('text/plain');
      if (text && (/\\\[[\s\S]*?\\\]/.test(text) || /\\\([^\n]+?\\\)/.test(text))) {
        event.preventDefault();
        event.stopPropagation();
        insertMarkdown(normalizeLatexMathDelimiters(text));
      }
    }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDropCapture={event => {
      if (blockReadOnly(event)) return;
      const files = Array.from<File>(event.dataTransfer.files);
      if (files.length) { event.preventDefault(); event.stopPropagation(); void addFiles(files); }
    }}>
    {!ready && !failed && <p role="status" className="py-4 text-sm text-quiet">{tr('wiki:wikiEditor.loading')}</p>}
    {failed && <>
      <p role="status" className="mb-3 text-xs text-warning">{tr('wiki:wikiEditor.fallback')}</p>
      <textarea ref={fallbackRef} aria-label={tr('wiki:wikiEditor.contentLabel')} value={props.value} readOnly={props.readOnly}
        className="w-full min-h-[320px] resize-none border-none bg-transparent font-mono text-sm text-main outline-none"
        onChange={event => { valueRef.current = event.target.value; props.onChange(event.target.value); resize(); }} />
    </>}
    <div ref={hostRef} className={failed ? 'hidden' : ''} />
    <input ref={inputRef} type="file" multiple className="hidden" aria-label={tr('wiki:toolbar.attachment')} onChange={event => {
      const files = Array.from<File>(event.target.files || []); event.target.value = '';
      void addFiles(files, filePositionRef.current || snapshot());
    }} />
    {assetError && <div role="alert" className="mt-2 text-xs text-danger">{tr('wiki:wikiEditor.assetFailed')}
      <button type="button" className="ml-2 underline" onClick={() => void addFiles(retryFilesRef.current, filePositionRef.current || snapshot())}>{tr('wiki:wikiEditor.retry')}</button>
    </div>}
    <InlineReferencePicker
      isOpen={pickerOpen}
      triggerPos={pickerPos}
      excludeId={props.documentKey}
      onSelect={handleSelectReference}
      onClose={() => {
        setPickerOpen(false);
        setPickerPos(null);
        savedRangeRef.current = null;
        editorRef.current?.focus();
      }}
    />
  </div>;
});
