import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPromptPreview } from './AIUserPromptsTimeline';

test('formatPromptPreview extracts clean summary from user question', () => {
  const multiline = `
### How to implement virtual list in React?
Here are some extra details:
- Needs 10k items
- Smooth scrolling
`;
  assert.equal(
    formatPromptPreview(multiline),
    'How to implement virtual list in React?'
  );
});

test('formatPromptPreview cleans markdown formatting symbols', () => {
  assert.equal(
    formatPromptPreview('**Optimize** the `database` query!'),
    'Optimize the database query!'
  );
});

test('formatPromptPreview falls back gracefully for empty content', () => {
  const result = formatPromptPreview('');
  assert.ok(result.length > 0);
});
