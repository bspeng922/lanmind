import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wikiIdFromLink,
  wikiReferenceHtml,
  wikiReferenceMarkdown,
} from '../components/wiki/wikiLinks';
import {
  aiConversationIdFromLink,
  aiConversationReferenceHtml,
  aiConversationReferenceMarkdown,
} from '../components/ai/aiLinks';

test('wiki links recognize desktop and web references and reject malformed links', () => {
  assert.equal(wikiIdFromLink('lanmind://wiki/doc-one'), 'doc-one');
  assert.equal(wikiIdFromLink('http://localhost:3000/#/wiki/doc-two'), 'doc-two');
  assert.equal(wikiIdFromLink('http://localhost:3000/?wiki=doc-three'), 'doc-three');
  for (const link of ['javascript:alert(1)', 'lanmind://settings/a', 'https://example.com']) {
    assert.equal(wikiIdFromLink(link), null);
  }
});

test('copied wiki names are formatted correctly in rich HTML and Markdown', () => {
  const doc = { title: '<script>[设计]</script>' };
  const md = wikiReferenceMarkdown(doc, 'lanmind://wiki/doc-1');
  assert.equal(md, '[文档：<script>\\[设计\\]</script>](lanmind://wiki/doc-1)');
  const html = wikiReferenceHtml(doc, 'lanmind://wiki/doc-1');
  assert.match(html, /data-lanmind-wiki="true"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('ai conversation links recognize desktop and web references', () => {
  assert.equal(aiConversationIdFromLink('lanmind://ai/conv-123'), 'conv-123');
  assert.equal(aiConversationIdFromLink('http://localhost:3000/#/ai/conv-456'), 'conv-456');
  const conv = { title: '方案讨论' };
  const md = aiConversationReferenceMarkdown(conv, 'lanmind://ai/conv-123');
  assert.equal(md, '[AI 对话：方案讨论](lanmind://ai/conv-123)');
  const html = aiConversationReferenceHtml(conv, 'lanmind://ai/conv-123');
  assert.match(html, /data-lanmind-ai="true"/);
});

test('searchReferenceItems excludes self document via excludeId', async () => {
  const { searchReferenceItems } = await import('./referenceSearch');
  const mockDocs = [
    { id: 'doc-self', title: '当前页面', parentId: null, content: '', updatedAt: 1, createdAt: 1 },
    { id: 'doc-other', title: '其他页面', parentId: null, content: '', updatedAt: 1, createdAt: 1 },
  ];
  const items = await searchReferenceItems('', {
    documents: mockDocs as any,
    kind: 'wiki',
    excludeId: 'doc-self',
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'doc-other');
  assert.equal(items[0].title, '其他页面');
});

