import { test, expect } from '@playwright/test';
import { chooseWikiEditorMode, openWikiSource } from './wikiEditorHelpers';

test('inspect code block dropdown and highlighting in wiki editor', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?locale=en-US&theme=light');
  await chooseWikiEditorMode(page, 'live');

  // Let's set markdown with python code block
  const markdown = '```python\ndef calculate_sum(a, b):\n    # Sum two numbers\n    result = a + b\n    return result\n```';
  await openWikiSource(page);
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true });
  await body.fill(markdown);
  await body.press('Control+s');
  await chooseWikiEditorMode(page, 'live');

  // Click outside the code block (e.g. page title) to trigger live preview
  await page.getByRole('textbox', { name: 'Page title', exact: true }).click();

  // Inspect the preview
  const codeBlock = page.locator('.wiki-rich-preview .rich-code-block');
  await codeBlock.waitFor({ timeout: 10000 });

  const tokens = await page.evaluate(() => {
    const preview = document.querySelector('.wiki-rich-preview .rich-code-block');
    return {
      headerText: preview?.querySelector('.rich-code-header')?.textContent,
      html: preview?.querySelector('pre')?.innerHTML,
      keywordCount: preview?.querySelectorAll('.token.keyword').length,
      functionCount: preview?.querySelectorAll('.token.function').length,
      commentCount: preview?.querySelectorAll('.token.comment').length,
    };
  });

  console.log('TOKENS FOUND:', JSON.stringify(tokens, null, 2));
  expect(tokens.keywordCount).toBeGreaterThan(0);

  // Take screenshot of Python syntax highlighting in preview
  const ARTIFACT_DIR = process.env.ARTIFACT_DIR || 'test-results';
  await codeBlock.screenshot({ path: `${ARTIFACT_DIR}/wiki_python_highlighting.png` });

  // Now test typing ``` on a new line in the IR editor
  const irElement = page.locator('.vditor-ir .vditor-reset');
  await irElement.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');

  // Wait for Vditor language hint menu to appear
  const langHintPanel = page.locator('.vditor-hint:not(.vditor-panel--arrow)');
  await langHintPanel.waitFor({ state: 'visible', timeout: 8000 });

  // Verify selection panel is narrow and compact (width <= 220px)
  const panelBox = await langHintPanel.boundingBox();
  expect(panelBox).toBeTruthy();
  expect(panelBox!.width).toBeLessThanOrEqual(220);

  const hintItems = await page.evaluate(() => {
    const items = document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) button');
    return Array.from(items).map(btn => btn.textContent?.trim());
  });

  console.log('HINT ITEMS WHEN TYPING ``` (first 8):', hintItems.slice(0, 8));
  expect(hintItems.slice(0, 8)).toEqual([
    'mermaid',
    'plantuml',
    'echarts',
    'flowchart',
    'markmap',
    'mindmap',
    'graphviz',
    'math',
  ]);
  expect(hintItems).toContain('javascript');
  expect(hintItems).toContain('python');

  // Take screenshot of the code block dropdown showing common languages
  await page.screenshot({ path: `${ARTIFACT_DIR}/wiki_code_languages_dropdown.png` });

  // Now type 'py' to filter
  await page.keyboard.type('py');
  await page.waitForTimeout(300);

  const filteredItemsPy = await page.evaluate(() => {
    const items = document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) button');
    return Array.from(items).map(btn => btn.textContent?.trim());
  });
  console.log('FILTERED ITEMS FOR "py":', filteredItemsPy);
  expect(filteredItemsPy).toContain('python');
  expect(filteredItemsPy).toContain('py');

  // Take screenshot of filtered dropdown
  await page.screenshot({ path: `${ARTIFACT_DIR}/wiki_code_languages_filtered_py.png` });

  // Now backspace 'py' and type 'ru'
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('ru');
  await page.waitForTimeout(300);

  const filteredItemsRu = await page.evaluate(() => {
    const items = document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) button');
    return Array.from(items).map(btn => btn.textContent?.trim());
  });
  console.log('FILTERED ITEMS FOR "ru":', filteredItemsRu);
  expect(filteredItemsRu).toContain('rust');
  expect(filteredItemsRu).toContain('ruby');

  // Now backspace 'ru' and type 'mer' to verify diagram engines still work
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('mer');
  await page.waitForTimeout(300);

  const filteredItemsMer = await page.evaluate(() => {
    const items = document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) button');
    return Array.from(items).map(btn => btn.textContent?.trim());
  });
  console.log('FILTERED ITEMS FOR "mer":', filteredItemsMer);
  expect(filteredItemsMer).toContain('mermaid');
});

test('inspect code block highlighting in dark theme', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?locale=en-US&theme=dark');
  await chooseWikiEditorMode(page, 'live');

  const markdown = '```typescript\ninterface UserProfile {\n  id: string;\n  name: string;\n  isAdmin: boolean;\n}\n\nexport const getUser = async (id: string): Promise<UserProfile> => {\n  // Fetch user by ID\n  return { id, name: "Alice", isAdmin: true };\n};\n```';
  await openWikiSource(page);
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true });
  await body.fill(markdown);
  await body.press('Control+s');
  await chooseWikiEditorMode(page, 'live');

  await page.getByRole('textbox', { name: 'Page title', exact: true }).click();

  const codeBlock = page.locator('.wiki-rich-preview .rich-code-block');
  await codeBlock.waitFor({ timeout: 10000 });

  const tokens = await page.evaluate(() => {
    const preview = document.querySelector('.wiki-rich-preview .rich-code-block');
    return {
      keywordCount: preview?.querySelectorAll('.token.keyword').length,
      functionCount: preview?.querySelectorAll('.token.function').length,
      stringCount: preview?.querySelectorAll('.token.string').length,
    };
  });
  expect(tokens.keywordCount).toBeGreaterThan(0);

  const ARTIFACT_DIR = process.env.ARTIFACT_DIR || 'test-results';
  await codeBlock.screenshot({ path: `${ARTIFACT_DIR}/wiki_typescript_highlighting_dark.png` });
});
