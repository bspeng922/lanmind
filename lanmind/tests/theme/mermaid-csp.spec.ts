import { test, expect } from '@playwright/test';

test('verify mermaid rendering with nonce and dynamic node width under CSP', async ({ page }) => {
  const nonce = 'tauri-nonce-test-123';
  await page.goto('/tests/theme/rich.html?theme=light');
  await page.evaluate(nonceValue => {
    const s = document.createElement('style');
    s.setAttribute('nonce', nonceValue);
    s.textContent = ':root { --test: 1; }';
    document.head.appendChild(s);

    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = `default-src 'self' customprotocol: asset:; img-src 'self' asset: http://asset.localhost blob: data: http: https:; style-src 'self' 'nonce-${nonceValue}'; style-src-attr 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src 'self' ipc: http://ipc.localhost https: http: data:; font-src 'self' data:`;
    document.head.append(meta);
  }, nonce);

  const source = `\`\`\`mermaid
flowchart TD
  A[资产与入口确认] --> B[信息收集]
  B --> C[端口与服务识别]
  C --> D[漏洞验证]
  D --> E[权限提升与横向移动]
  E --> F[影响评估]
  F --> G[修复建议与复测]
\`\`\``;
  await page.evaluate(value => (window as any).setRichContent(value), source);
  const diagram = page.locator('.rich-diagram[data-rich-kind="mermaid"][data-rich-state="ready"]');
  await diagram.first().waitFor({ timeout: 20000 });

  // 1. Inspect rect fill — should NOT be black (rgb(0, 0, 0))
  const fill = await page.evaluate(() => {
    const rect = document.querySelector('.rich-diagram[data-rich-kind="mermaid"] svg rect.basic');
    return window.getComputedStyle(rect!).fill;
  });
  console.log('RENDERED RECT FILL:', fill);
  expect(fill).not.toBe('rgb(0, 0, 0)');
  expect(fill).toBe('rgb(238, 238, 238)');

  // 2. Inspect node rect widths — must dynamically adjust according to text length
  const rectWidths = await page.evaluate(() => {
    const nodes = document.querySelectorAll('.rich-diagram[data-rich-kind="mermaid"] svg .node');
    return Array.from(nodes).map(n => ({
      text: n.textContent?.trim(),
      width: Number(n.querySelector('rect')?.getAttribute('width')),
    }));
  });
  console.log('RECT WIDTHS:', JSON.stringify(rectWidths, null, 2));

  // Find 4-char node and 9-char node
  const shortNode = rectWidths.find(n => n.text === '信息收集');
  const longNode = rectWidths.find(n => n.text === '权限提升与横向移动');
  const midNode = rectWidths.find(n => n.text === '资产与入口确认');

  expect(shortNode).toBeDefined();
  expect(longNode).toBeDefined();
  expect(midNode).toBeDefined();

  // Long node width must be significantly larger than short node width
  expect(longNode!.width).toBeGreaterThan(midNode!.width);
  expect(midNode!.width).toBeGreaterThan(shortNode!.width);
});
