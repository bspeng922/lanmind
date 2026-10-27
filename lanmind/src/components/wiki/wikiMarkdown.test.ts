import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWikiMarkdown, wikiReferenceLinkUrl } from './wikiMarkdown';

test('Wiki Markdown preserves GFM, soft breaks, underline and nested highlight formatting', () => {
  const html = parseWikiMarkdown('first\nsecond\n\n<u>underlined</u> ==**important**==\n\n- [x] done\n\n| A | B |\n| --- | --- |\n| one | two |');
  assert.match(html, /first<br>\s*second/);
  assert.match(html, /<u>underlined<\/u>/);
  assert.match(html, /<mark><strong>important<\/strong><\/mark>/);
  assert.match(html, /checked/);
  assert.match(html, /<table>/);
});

test('highlight markers in code and escaped text remain literal', () => {
  const html = parseWikiMarkdown('`==code==`\n\n```text\n==block==\n```\n\n\\==literal==');
  assert.match(html, /<code>==code==<\/code>/);
  assert.match(html, /==block==/);
  assert.doesNotMatch(html, /<mark>/);
});

test('reference destinations follow Markdown label normalization and ignore definitions inside code', () => {
  const markdown = '[Target Name]: <https://example.com/right> "Title"\n\n```text\n[hidden]: https://example.com/hidden\n```';
  assert.equal(wikiReferenceLinkUrl(markdown, '[TARGET   Name]'), 'https://example.com/right');
  assert.equal(wikiReferenceLinkUrl(markdown, '[hidden]'), '');
  assert.equal(wikiReferenceLinkUrl(markdown, '[missing]'), '');
});
