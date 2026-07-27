import assert from 'node:assert/strict';
import test from 'node:test';
import { isThemePreference, resolveThemePreference } from './theme';

test('maps the system light appearance to the titanium light theme', () => {
  assert.equal(resolveThemePreference('system', true), 'titanium-light');
});

test('maps the system dark appearance to the navy star theme', () => {
  assert.equal(resolveThemePreference('system', false), 'navy-slate');
});

test('keeps an explicitly selected theme independent of system appearance', () => {
  assert.equal(resolveThemePreference('cyber-emerald', true), 'cyber-emerald');
  assert.equal(resolveThemePreference('cyber-emerald', false), 'cyber-emerald');
});

test('accepts only supported persisted theme preferences', () => {
  assert.equal(isThemePreference('system'), true);
  assert.equal(isThemePreference('navy-slate'), true);
  assert.equal(isThemePreference('legacy-theme'), false);
  assert.equal(isThemePreference(null), false);
});
