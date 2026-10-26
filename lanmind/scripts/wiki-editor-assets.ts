import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Vditor loads Lute, translations and highlighting at runtime. Keep them offline. */
export function wikiEditorAssets(): Plugin {
  const root = fileURLToPath(new URL('../node_modules/vditor/', import.meta.url));
  const prefix = 'vendor/vditor/';
  const contentTypes: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
  return {
    name: 'wiki-editor-offline-assets',
    configureServer(server) {
      server.middlewares.use(`/${prefix}`, async (request, response, next) => {
        try {
          const relative = decodeURIComponent((request.url || '').split('?')[0]);
          const target = path.resolve(root, `.${relative}`);
          if (!target.startsWith(root) || !(await stat(target)).isFile()) return next();
          response.setHeader('Content-Type', contentTypes[path.extname(target)] || 'application/octet-stream');
          createReadStream(target).pipe(response);
        } catch { next(); }
      });
    },
    async generateBundle() {
      const emitDirectory = async (relative: string) => {
        for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
          const name = `${relative}/${entry.name}`;
          if (entry.isDirectory()) await emitDirectory(name);
          else this.emitFile({ type: 'asset', fileName: prefix + name, source: await readFile(path.join(root, name)) });
        }
      };
      for (const directory of ['dist/js/lute', 'dist/js/i18n', 'dist/js/icons', 'dist/js/highlight.js', 'dist/css', 'dist/images']) await emitDirectory(directory);
      this.emitFile({ type: 'asset', fileName: `${prefix}LICENSE`, source: await readFile(path.join(root, 'LICENSE')) });
    },
  };
}
