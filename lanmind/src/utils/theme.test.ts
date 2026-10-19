import assert from 'node:assert/strict';
import test from 'node:test';
import { isThemePreference, migrateThemePreference, resolveThemePreference } from './theme';

test('maps the system light appearance to the light theme', () => {
  assert.equal(resolveThemePreference('system', true), 'light');
});

test('maps the system dark appearance to the dark theme', () => {
  assert.equal(resolveThemePreference('system', false), 'dark');
});

test('keeps an explicitly selected theme independent of system appearance', () => {
  assert.equal(resolveThemePreference('dark', true), 'dark');
  assert.equal(resolveThemePreference('light', false), 'light');
});

test('accepts only supported persisted theme preferences', () => {
  assert.equal(isThemePreference('system'), true);
  assert.equal(isThemePreference('dark'), true);
  assert.equal(isThemePreference('light'), true);
  assert.equal(isThemePreference('legacy-theme'), false);
  assert.equal(isThemePreference(null), false);
});

test('migrates the five pre-convergence theme ids onto the light/dark pair', () => {
  assert.equal(migrateThemePreference('navy-slate'), 'dark');
  assert.equal(migrateThemePreference('aurora-purple'), 'dark');
  assert.equal(migrateThemePreference('cyber-emerald'), 'dark');
  assert.equal(migrateThemePreference('warm-amber'), 'light');
  assert.equal(migrateThemePreference('titanium-light'), 'light');
});

test('treats a saved legacy id as a valid preference so the migration is not discarded', () => {
  assert.equal(isThemePreference('cyber-emerald'), true);
  assert.equal(isThemePreference('titanium-light'), true);
});
