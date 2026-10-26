import type Vditor from 'vditor';
import { tr } from '../../i18n';

type Toolbar = NonNullable<ConstructorParameters<typeof Vditor>[1]>['toolbar'];
const icon = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/** Use native commands so formatting and typing share selection and undo history. */
export function createWikiToolbar(selectFiles: (accept: string) => void, wrap: (prefix: string, suffix: string) => void): Toolbar {
  return [
    { name: 'headings', tipPosition: 'se' },
    '|',
    { name: 'bold', tipPosition: 's' },
    { name: 'italic', tipPosition: 's' },
    { name: 'wiki-underline', tip: tr('wiki:toolbar.underline'), tipPosition: 's', click: () => wrap('<u>', '</u>'), icon: icon('<path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16"/>') },
    { name: 'strike', tipPosition: 's' },
    { name: 'wiki-highlight', tip: tr('wiki:toolbar.highlight'), tipPosition: 's', click: () => wrap('==', '=='), icon: icon('<path d="m9 11 6-6 4 4-6 6M9 11l4 4-2 2H7v-4zM4 21h16"/>') },
    '|',
    { name: 'list', tipPosition: 's' },
    { name: 'ordered-list', tipPosition: 's' },
    { name: 'check', tipPosition: 's' },
    { name: 'outdent', tipPosition: 's' },
    { name: 'indent', tipPosition: 's' },
    '|',
    { name: 'quote', tipPosition: 's' },
    { name: 'inline-code', tipPosition: 's' },
    { name: 'code', tipPosition: 's' },
    { name: 'insert-after', tipPosition: 's' },
    '|',
    { name: 'link', tipPosition: 's' },
    { name: 'wiki-image', tip: tr('wiki:toolbar.image'), tipPosition: 's', icon: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m21 15-5-5L5 21"/>'), click: () => selectFiles('image/*') },
    { name: 'wiki-attachment', tip: tr('wiki:toolbar.attachment'), tipPosition: 's', icon: icon('<path d="m21 11-8 8a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8"/>'), click: () => selectFiles('') },
    { name: 'table', tipPosition: 'sw' },
    '|',
    { name: 'undo', tipPosition: 'sw' },
    { name: 'redo', tipPosition: 'sw' },
    // Vditor 4 has no public setMode API. The adapter activates this native control.
    { name: 'edit-mode', className: 'wiki-native-modes' },
  ];
}
