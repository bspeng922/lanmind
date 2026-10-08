import test from 'node:test';
import assert from 'node:assert/strict';
import { checklistFromMarkdown, markdownWithChecklist, reconcileTaskChecklist } from './taskChecklist';

test('checklists synchronize without changing prose, images, or fenced code', () => {
  const markdown = '# 说明\n\n![资料](lanmind-attachment:image)\n\n- [ ] 确认资料\n- [x] 提交报告\n\n```md\n- [ ] 代码示例\n```\n结束';
  const checklist = checklistFromMarkdown(markdown);
  assert.equal(checklist.length, 2);
  const next = [{ ...checklist[0], completed: true, title: '确认新资料' }, { id: 'new', title: '复核', completed: false }];
  const result = markdownWithChecklist(markdown, checklist, next);
  assert.match(result, /- \[x\] 确认新资料/);
  assert.doesNotMatch(result, /提交报告/);
  assert.match(result, /```md\n- \[ \] 代码示例\n```/);
  assert.match(result, /!\[资料\]\(lanmind-attachment:image\)/);
  assert.match(result, /结束\n- \[ \] 复核/);
  assert.deepEqual(checklistFromMarkdown(result, next), next);
});

test('renaming and checking in Markdown preserve existing checklist IDs', () => {
  const before = [{ id: 'one', title: '资料', completed: false }, { id: 'two', title: '报告', completed: false }];
  assert.deepEqual(checklistFromMarkdown('- [x] 新资料\n- [ ] 报告', before), [{ ...before[0], title: '新资料', completed: true }, before[1]]);
  assert.equal(checklistFromMarkdown('- [ ] 报告', before)[0].id, 'two');
  const prepended = checklistFromMarkdown('- [ ] 新事项\n- [ ] 资料\n- [ ] 报告', before);
  assert.equal(prepended[1].id, 'one');
  assert.equal(prepended[2].id, 'two');
});

test('legacy checklist is appended once and ordinary lists are preserved', () => {
  const items = [{ id: 'legacy', title: '检查', completed: true }];
  const merged = reconcileTaskChecklist('正文\n\n- 普通列表', items);
  assert.equal(merged.description, '正文\n\n- 普通列表\n\n- [x] 检查');
  assert.deepEqual(reconcileTaskChecklist(merged.description, items), merged);
});

test('temporarily clearing a checklist title does not duplicate its Markdown line', () => {
  const before = [{ id: 'editing', title: '旧名称', completed: true }];
  const empty = [{ ...before[0], title: '' }];
  const during = markdownWithChecklist('正文\n\n- [x] 旧名称', before, empty);
  const next = [{ ...empty[0], title: '新名称' }];
  assert.equal(markdownWithChecklist(during, empty, next), '正文\n\n- [x] 新名称');
});

test('nested, ordered, and CRLF checklists can be changed in place', () => {
  const content = '1. [ ] 第一项\r\n   - [x] 第二项\r\n\r\n其他正文';
  const before = checklistFromMarkdown(content);
  assert.equal(before.length, 2);
  const after = before.map((item) => ({ ...item, completed: !item.completed }));
  const result = markdownWithChecklist(content, before, after);
  assert.equal(result, '1. [x] 第一项\r\n   - [ ] 第二项\r\n\r\n其他正文');
});
