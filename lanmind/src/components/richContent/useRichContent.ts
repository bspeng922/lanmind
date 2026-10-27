import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createRichContentSession, reconcileRichMarkup, type RichContentSession } from './diagramRuntime';
import 'katex/dist/katex.min.css';
import './rich-content.css';

export function useRichContent(ref: RefObject<HTMLElement | null>, html: string): void {
  const session = useRef<RichContentSession | null>(null);
  useLayoutEffect(() => {
    const root = ref.current; if (!root) return;
    reconcileRichMarkup(root, html);
    session.current ??= createRichContentSession(root);
    void session.current.update();
  }, [html]);
  useLayoutEffect(() => () => { session.current?.dispose(); session.current = null; }, []);
}
