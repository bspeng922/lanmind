import { createHash } from 'node:crypto';

/** Include fixed-name resources and worker logic in the offline cache version. */
export function createReceiverServiceWorker(source, assets) {
  const entries = [...assets].filter(([name]) => name !== 'sw.js')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const hash = createHash('sha256').update(source);
  for (const [name, bytes] of entries) {
    hash.update(JSON.stringify(name));
    hash.update(createHash('sha256').update(bytes).digest());
  }
  const urls = entries.map(([name]) => `/receiver/${name}`);
  urls.push('/receiver/');
  return source
    .replace('lanmind-optical-receiver-dev', `lanmind-optical-receiver-${hash.digest('hex').slice(0, 12)}`)
    .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(urls)};`);
}
