import test from 'node:test';
import assert from 'node:assert/strict';
import { taskIdFromLink, taskReferenceHtml, taskReferenceMarkdown } from './taskLinks';

test('task links recognize desktop and legacy browser references and reject malformed links', () => {
  assert.equal(taskIdFromLink('lanmind://task/task-one'), 'task-one');
  assert.equal(taskIdFromLink('http://localhost:1421/#task/task-two'), 'task-two');
  assert.equal(taskIdFromLink('#task/task-three'), 'task-three');
  for (const link of ['javascript:alert(1)', 'lanmind://settings/a', 'lanmind://task/a/b', 'lanmind://task/%ZZ', 'https://example.com']) assert.equal(taskIdFromLink(link), null);
});

test('copied task names are escaped in rich HTML and Markdown', () => {
  const task = { title: '<script>[验收]</script>' };
  assert.equal(taskReferenceMarkdown(task, 'lanmind://task/a'), '[任务：<script>\\[验收\\]</script>](lanmind://task/a)');
  const html = taskReferenceHtml(task, 'lanmind://task/a');
  assert.match(html, /data-lanmind-task="true"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
