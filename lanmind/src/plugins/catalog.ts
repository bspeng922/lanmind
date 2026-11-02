import type { InstalledPlugin, MarketPackage } from './client';

export function comparePluginVersions(a: string, b: string): number {
  const parse = (value: string) => value.split('+')[0].split('-');
  const [av, ...ap] = parse(a); const [bv, ...bp] = parse(b);
  const x = av.split('.'); const y = bv.split('.');
  for (let i = 0; i < 3; i++) { const left = BigInt(x[i] ?? 0); const right = BigInt(y[i] ?? 0); if (left !== right) return left > right ? 1 : -1; }
  if (!ap.length || !bp.length) return ap.length === bp.length ? 0 : ap.length ? -1 : 1;
  const aa = ap.join('-').split('.'); const bb = bp.join('-').split('.');
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === bb[i]) continue;
    if (aa[i] === undefined || bb[i] === undefined) return aa[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(aa[i]); const bn = /^\d+$/.test(bb[i]);
    if (an && bn) return BigInt(aa[i]) > BigInt(bb[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return aa[i] > bb[i] ? 1 : -1;
  }
  return 0;
}
export function stablePluginVersion(version: string): boolean { return !version.split('+')[0].includes('-'); }
export interface PluginGroup { pluginKey: string; variants: MarketPackage[]; conflicts: Set<string>; recommended?: MarketPackage }
export function groupPluginCatalog(packages: MarketPackage[], installed: InstalledPlugin[] = []): PluginGroup[] {
  const groups = new Map<string, MarketPackage[]>();
  for (const item of packages) {
    const variants = groups.get(item.pluginKey) ?? [];
    const same = variants.find(v => v.sha256 === item.sha256 && v.manifest.version === item.manifest.version);
    if (same) same.sources = Array.from(new Map([...same.sources, ...item.sources].map(source => [source.nodeId, source])).values());
    else variants.push({ ...item, sources: [...item.sources] });
    groups.set(item.pluginKey, variants);
  }
  return [...groups.entries()].map(([pluginKey, variants]) => {
    variants.sort((a, b) => comparePluginVersions(b.manifest.version, a.manifest.version));
    const conflicts = new Set(variants.filter(v => variants.some(other => other.manifest.version === v.manifest.version && other.sha256 !== v.sha256)).map(v => v.manifest.version));
    const local = installed.find(item => item.pluginKey === pluginKey);
    if (local && variants.some(item => item.manifest.version === local.manifest.version && item.sha256 !== local.sha256)) conflicts.add(local.manifest.version);
    const recommended = variants.find(v => v.compatible && stablePluginVersion(v.manifest.version) && !conflicts.has(v.manifest.version));
    return { pluginKey, variants, conflicts, recommended };
  });
}
