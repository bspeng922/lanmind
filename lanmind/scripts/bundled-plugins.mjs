import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function pluginLocales(locale) {
  const result = new Map();
  const root = path.join(projectRoot, 'plugins');
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const directory = path.join(root, item.name);
    const manifestFile = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const relative = manifest.locales?.[locale] ?? manifest.locales?.[manifest.defaultLocale];
    if (!relative || !manifest.namespace) throw new Error(`Plugin ${item.name} has no locale resource for ${locale}`);
    const file = path.resolve(directory, relative);
    if (!file.startsWith(`${directory}${path.sep}`)) throw new Error(`Plugin locale outside package: ${file}`);
    if (result.has(manifest.namespace)) throw new Error(`Duplicate plugin namespace: ${manifest.namespace}`);
    result.set(manifest.namespace, file);
  }
  return result;
}
