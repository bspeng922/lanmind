import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';

// Exercise the package's supported Node entry; Vite uses its browser entry.
const PptxGenJS = createRequire(import.meta.url)('pptxgenjs') as typeof import('pptxgenjs').default;

test('PowerPoint exports include embedded images with the patched image parser', async () => {
  const presentation = new PptxGenJS();
  const slide = presentation.addSlide();
  slide.addText('Image export compatibility', { x: 0, y: 0, w: 5, h: 1 });
  slide.addImage({
    data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aocsAAAAASUVORK5CYII=',
    x: 0, y: 1, w: 1, h: 1,
  });
  const bytes = await presentation.write({ outputType: 'nodebuffer' });
  assert.ok(Buffer.isBuffer(bytes));
  const files = unzipSync(bytes);
  assert.match(strFromU8(files['ppt/slides/slide1.xml']), /Image export compatibility/);
  assert.ok(Object.keys(files).some(name => name.startsWith('ppt/media/') && name.endsWith('.png')));
  assert.match(strFromU8(files['ppt/slides/_rels/slide1.xml.rels']), /relationships\/image/);
});
