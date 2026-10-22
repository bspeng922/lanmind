import test from 'node:test';
import assert from 'node:assert/strict';
import { combineAskUserRequests, formatAskUserAnswer, readAskUser, splitAskUserContent } from './askUser';

const dsml = (question: string, name = 'ask_user') => `<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="${name}">\n<｜｜DSML｜｜ parameter name="question" string="true">${question}</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>`;

test('extracts the supplied DSML format, preserving surrounding prose and decoding entities once', () => {
  assert.deepEqual(splitAskUserContent(`先确认。\n${dsml('选择 A &amp; B，还是 &lt;其它&gt;？')}\n后续预览。`), [
    { type: 'markdown', text: '先确认。\n' },
    { type: 'question', request: { question: '选择 A & B，还是 <其它>？', questions: [] } },
    { type: 'markdown', text: '\n后续预览。' },
  ]);
  assert.equal((splitAskUserContent(dsml('&amp;lt;'))[0] as any).request.question, '&lt;');
});

test('keeps code samples, unsupported tools and malformed calls as ordinary content', () => {
  for (const content of [`\`\`\`xml\n${dsml('Example')}\n\`\`\``, `~~~xml\n${dsml('Example')}\n~~~`, dsml('Do a write', 'write_file'), dsml('')]) {
    assert.deepEqual(splitAskUserContent(content), [{ type: 'markdown', text: content }]);
  }
  const mixed = dsml('Question').replace('</｜｜DSML｜｜ calls>', dsml('Write', 'write_file').replace(/<\/?｜｜DSML｜｜ calls>/g, '') + '</｜｜DSML｜｜ calls>');
  assert.deepEqual(splitAskUserContent(mixed), [{ type: 'markdown', text: mixed }]);
});

test('withholds an incomplete streaming block without losing the preceding text', () => {
  const partial = `请确认。\n${dsml('Choose').slice(0, -22)}`;
  assert.deepEqual(splitAskUserContent(partial, true), [{ type: 'markdown', text: '请确认。\n' }]);
  assert.deepEqual(splitAskUserContent(partial), [{ type: 'markdown', text: partial }]);
});

test('supports ASCII markers and multiple questions without executing anything', () => {
  const ascii = dsml('First').replaceAll('｜', '|');
  const parts = splitAskUserContent(`${ascii}\n${dsml('Second')}`);
  assert.deepEqual(parts.filter((part) => part.type === 'question').map((part) => part.request.question), ['First', 'Second']);
});

test('accepts legacy and malformed inputs and formats choices in display order', () => {
  assert.deepEqual(readAskUser({ question: ' Legacy ' }), { question: 'Legacy', questions: [] });
  assert.deepEqual(readAskUser(null), { question: '', questions: [] });
  const request = readAskUser({ question: 'Context', questions: [null, { question: 'Changes?', multiple: true, options: [{ label: 'Priority', description: ' P1 ' }, { label: 'Move project' }, { label: '' }] }, { question: 'Direction?', options: [{ label: 'P1 first' }, { label: 'P4 first' }] }] });
  assert.equal(request.questions.length, 2);
  assert.equal(request.questions[0].options[0].description, 'P1');
  assert.equal(formatAskUserAnswer(request, [[1, 0], [0]], ' Keep the date. '), 'Changes?\n- Priority\n- Move project\n\nDirection?\n- P1 first\n\nKeep the date.');
  assert.equal(formatAskUserAnswer(request, [], 'Custom answer only'), 'Custom answer only');
  assert.equal(formatAskUserAnswer(request, [], '   '), '');
});

test('combines textual requests and their choices into one complete answer', () => {
  const first = readAskUser({ question: 'Choose the priority.', questions: [{ question: 'Priority?', options: [{ label: 'P1' }, { label: 'P2' }] }] });
  const second = readAskUser({ question: 'Choose the delivery date.', questions: [{ question: 'Delivery?', options: [{ label: 'Friday' }, { label: 'Monday' }] }] });
  const combined = combineAskUserRequests([first, second]);
  assert.equal(combined.question, 'Choose the priority.\n\nChoose the delivery date.');
  assert.equal(formatAskUserAnswer(combined, [[0], [1]], 'Keep the other tasks.'), 'Priority?\n- P1\n\nDelivery?\n- Monday\n\nKeep the other tasks.');
  assert.deepEqual(combineAskUserRequests([first]), first);
});
