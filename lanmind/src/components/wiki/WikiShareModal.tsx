import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Share2 } from 'lucide-react';
import { ApiService, type WikiShare, type WebStatus } from '../../services/api';
import { getWorkspaceContext, sameWorkspace } from '../../utils/workspaceContext';
import { tr, useLocale } from '../../i18n';
import type { WikiDocument } from './wikiTypes';
import { loadWikiState, collectSubtreeIds } from './wikiStore';
import { syncWikiDocumentAssets } from './wikiAssetStore';
import { copyText } from '../../utils/clipboard';
export interface WikiShareModalProps {
    document: WikiDocument;
    isOpen: boolean;
    onClose: () => void;
}
export const WikiShareModal: React.FC<WikiShareModalProps> = ({ document: doc, isOpen, onClose }) => {
    useLocale();
    const [status, setStatus] = useState<WebStatus | null>(null);
    const [shares, setShares] = useState<WikiShare[]>([]);
    const [descendants, setDescendants] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const [copied, setCopied] = useState('');
    const generation = useRef(0);
    useEffect(() => {
        const current = ++generation.current;
        setStatus(null);
        setShares([]);
        setError(false);
        setDescendants(false);
        setCopied('');
        setBusy(false);
        if (!isOpen)
            return;
        Promise.all([ApiService.getWebStatus(), ApiService.getWikiShares(doc.id)]).then(([next, links]) => {
            if (current === generation.current) {
                setStatus(next);
                setShares(links);
            }
        }).catch(() => { if (current === generation.current)
            setError(true); });
        return () => { generation.current++; };
    }, [isOpen, doc.id]);
    if (!isOpen)
        return null;
    const url = (share: WikiShare) => `${status?.endpoint.replace(/\/+$/, '')}/?workspace=${encodeURIComponent(doc.workspaceId || getWorkspaceContext()?.workspaceId || '')}&wiki=${encodeURIComponent(doc.id)}&share=${encodeURIComponent(share.shareId)}#/wiki/${encodeURIComponent(doc.id)}`;
    const create = async () => {
        const current = generation.current;
        const scope = getWorkspaceContext();
        setBusy(true);
        setError(false);
        try {
            const documents = loadWikiState(doc.workspaceId).documents;
            const ids = new Set(descendants ? collectSubtreeIds(documents, doc.id) : [doc.id]);
            for (const page of [doc, ...documents.filter(page => page.id !== doc.id && ids.has(page.id))])
                await syncWikiDocumentAssets(page.content);
            if (scope && !sameWorkspace(scope))
                throw new Error('Workspace changed');
            const share = await ApiService.createWikiShare(doc.id, descendants);
            if (current === generation.current)
                setShares(items => [...items, share]);
        }
        catch {
            if (current === generation.current)
                setError(true);
        }
        finally {
            if (current === generation.current)
                setBusy(false);
        }
    };
    const revoke = async (share: WikiShare) => {
        const current = generation.current;
        setBusy(true);
        setError(false);
        try {
            await ApiService.revokeWikiShare(share.shareId);
            if (current === generation.current)
                setShares(items => items.filter(s => s.shareId !== share.shareId));
        }
        catch {
            if (current === generation.current)
                setError(true);
        }
        finally {
            if (current === generation.current)
                setBusy(false);
        }
    };
    return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-label={tr('wiki:wikiShare.ariaLabel')} className="w-full max-w-2xl rounded-2xl border border-edge bg-surface p-5 shadow-popover">
      <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-bold text-main"><Share2 className="h-4 w-4"/>{tr('wiki:wikiShare.title')}</h3><button onClick={onClose} aria-label={tr('common:header.close')}><X className="h-4 w-4"/></button></div>
      <p className="mt-4 text-sm font-semibold text-main">{doc.title || tr('wiki:wikiView.untitledPage')}</p>
      <p className="my-3 text-xs text-sub">{tr('wiki:wikiShare.scopedNotice')}</p>
      <label className="flex items-center gap-2 text-xs text-main"><input type="checkbox" checked={descendants} onChange={e => setDescendants(e.target.checked)}/>{tr('wiki:wikiShare.includeDescendants')}</label>
      <button className="theme-btn-primary my-4 px-3 py-2 text-xs" disabled={!status?.running || busy} onClick={() => void create()}>{tr('wiki:wikiShare.createLink')}</button>
      {!status?.running && <p className="text-xs text-sub">{tr('wiki:wikiShare.webDisabledTip')}</p>}
      <div className="max-h-72 space-y-3 overflow-auto">{shares.map(share => <div key={share.shareId} className="rounded-xl border border-edge p-3">
        <p className="mb-2 text-xs text-sub">{tr(share.includeDescendants ? 'wiki:wikiShare.pageAndDescendants' : 'wiki:wikiShare.pageOnly')}</p>
        <input className="w-full rounded-lg bg-input p-2 text-xs text-main" readOnly aria-label={tr('wiki:wikiShare.webLinkTitle')} value={status?.running ? url(share) : ''}/>
        <div className="mt-2 flex gap-3 text-xs"><button disabled={!status?.running || busy} onClick={() => { void copyText(url(share)).then(() => setCopied(share.shareId)).catch(() => setError(true)); }} className="flex items-center gap-1 text-accent"><Copy className="h-3 w-3"/>{tr(copied === share.shareId ? 'wiki:wikiShare.copied' : 'wiki:wikiShare.copyLink')}</button><button disabled={busy} className="text-danger" onClick={() => void revoke(share)}>{tr('wiki:wikiShare.revokeLink')}</button></div>
      </div>)}</div>
      {busy && <p role="status" className="mt-3 text-xs text-sub">{tr('wiki:wikiShare.preparingAssets')}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-danger">{tr('wiki:wikiShare.prepareFailed')}</p>}
    </div>
  </div>, document.body);
};
