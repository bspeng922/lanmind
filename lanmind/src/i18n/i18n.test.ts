import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { i18n, tr } from './core';
import { matchLocale, resolveLocale } from './registry';
import { describeMessage, localizeMessage, localizedError } from './messages';
import { getWeekdayHeaders } from '../utils/calendarGrid';
import { formatHeaderDateWithLunar } from '../utils/lunar';
import { DEFAULT_SHORTCUTS } from '../components/ShortcutModal';
import { defaultPptPrompt, reportPromptFor } from '../utils/reportDateRange';

after(() => { void i18n.changeLanguage('zh-CN'); });

test('locale matching handles system variants, saved choices and unsupported languages', () => {
  assert.equal(matchLocale('en_GB'), 'en-US');
  assert.equal(matchLocale('zh-Hant-TW'), 'zh-CN');
  assert.equal(resolveLocale('system', ['fr-FR', 'en-GB']), 'en-US');
  assert.equal(resolveLocale('system', ['fr-FR']), 'zh-CN');
  assert.equal(resolveLocale('zh-CN', ['en-US']), 'zh-CN');
});

test('system text and defaults switch while user parameters remain intact', async () => {
  await i18n.changeLanguage('en-US');
  assert.equal(tr('settings:settingsModal.settings'), 'Settings');
  assert.match(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'openSettings')!.name, /Settings/i);
  assert.match(defaultPptPrompt(), /presentation|slides|PPT/i);
  assert.match(reportPromptFor('daily'), /daily/i);
  const error = localizedError('任务 中文任务 的标题不能为空');
  assert.equal(error.message, 'Task 中文任务 needs a title');
  await i18n.changeLanguage('zh-CN');
  assert.equal(error.message, '任务 中文任务 的标题不能为空');
  assert.equal(localizeMessage('Incorrect access password'), '访问密码不正确');
  assert.equal(localizeMessage('custom transport failure: E123'), 'custom transport failure: E123');
});

test('legacy and structured API errors retain dynamic values across languages', async () => {
  const descriptor = describeMessage('任务版本冲突：当前版本为 17，请重新读取任务后再更新');
  assert.deepEqual(descriptor, { code: 'errors:taskVersionConflict', params: { arg0: '17' } });
  await i18n.changeLanguage('en-US');
  assert.equal(localizeMessage(descriptor!), 'Task changed (version 17). Reload it before saving');
  assert.equal(localizeMessage('Error: 访问密码不正确'), 'Incorrect access password');
  assert.equal(localizedError({ code: 'errors:fileIncomplete', params: { received: '80', arg0: '100' }, error: 'legacy' }).message, 'File transfer incomplete (80/100)');
});

test('calendar headings and weekdays follow the active locale', async () => {
  await i18n.changeLanguage('en-US');
  assert.deepEqual(getWeekdayHeaders('monday', 'short'), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.match(formatHeaderDateWithLunar(new Date(2026, 9, 9)).fullTitle, /October 9, 2026.*Friday/);
  await i18n.changeLanguage('zh-CN');
  assert.match(formatHeaderDateWithLunar(new Date(2026, 9, 9)).fullTitle, /2026年10月9日.*星期五/);
});
