import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMarkdownHeadings } from './WikiOutlineNavigator';

test('extractMarkdownHeadings extracts multi-level headings and ignores code blocks', () => {
  const markdown = `
# Project Overview
Some intro text here.

## 1. Architecture
Overview of system.

\`\`\`markdown
# This is a heading inside code block
## Should be ignored
\`\`\`

### 1.1 Frontend
React and TypeScript details.

#### 1.1.1 Components
Component structure.

## 2. Deployment
Release steps.
`;

  const headings = extractMarkdownHeadings(markdown);

  assert.equal(headings.length, 5);
  assert.deepEqual(
    headings.map((h) => ({ level: h.level, text: h.text })),
    [
      { level: 1, text: 'Project Overview' },
      { level: 2, text: '1. Architecture' },
      { level: 3, text: '1.1 Frontend' },
      { level: 4, text: '1.1.1 Components' },
      { level: 2, text: '2. Deployment' },
    ]
  );
});

test('extractMarkdownHeadings handles empty content and text without headings', () => {
  assert.deepEqual(extractMarkdownHeadings(''), []);
  assert.deepEqual(extractMarkdownHeadings('Just plain paragraphs\nno headings here.'), []);
});

test('extractMarkdownHeadings cleans markdown formatting in headings', () => {
  const markdown = '## **Bold** and _italic_ and `code` heading';
  const headings = extractMarkdownHeadings(markdown);
  assert.equal(headings.length, 1);
  assert.equal(headings[0].text, 'Bold and italic and code heading');
  assert.equal(headings[0].level, 2);
});
