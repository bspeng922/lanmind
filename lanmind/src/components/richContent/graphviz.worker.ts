import { instance } from '@viz-js/viz';

const engine = instance();
self.onmessage = async (event: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = event.data;
  try {
    const viz = await engine;
    self.postMessage({ id, svg: viz.renderString(source, { format: 'svg' }) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
