import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShortcutKey } from './platform';

test('formats Windows shortcuts correctly', () => {
  assert.equal(formatShortcutKey('Ctrl+Shift+F', false), 'Ctrl+Shift+F');
  assert.equal(formatShortcutKey('CommandOrControl+Alt+K', false), 'Ctrl+Alt+K');
  assert.equal(formatShortcutKey('Alt+F4', false), 'Alt+F4');
});

test('formats macOS shortcuts with native symbol glyphs', () => {
  assert.equal(formatShortcutKey('Ctrl+Shift+F', true), '⌘+⇧+F');
  assert.equal(formatShortcutKey('CommandOrControl+Alt+K', true), '⌘+⌥+K');
  assert.equal(formatShortcutKey('Control+Space', true), '⌘+Space');
});

test('handles empty input gracefully', () => {
  assert.equal(formatShortcutKey('', false), '');
  assert.equal(formatShortcutKey('', true), '');
});
