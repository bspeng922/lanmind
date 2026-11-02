import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { zipSync } from 'fflate';

const context = Buffer.from('lanmind-web-plugin-v1\0');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function generatePluginKey(output) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(output, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
  return hash(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'));
}
export function packageWebPlugin({ input, key, output }) {
  const root = fs.realpathSync(input);
  if (fs.lstatSync(input).isSymbolicLink()) throw new Error('Plugin input must not be a symbolic link');
  const keyPath = fs.realpathSync(key);
  const relativeKey = path.relative(root, keyPath);
  if (!path.isAbsolute(relativeKey) && relativeKey !== '..' && !relativeKey.startsWith(`..${path.sep}`)) throw new Error('The signing key must be outside the plugin input directory');
  const template = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (template.schemaVersion !== 2 || template.runtime !== 'web' || template.sdkVersion !== 1) throw new Error('Expected a schemaVersion 2 web plugin using SDK 1');
  if (!/^[a-z0-9._-]{1,100}$/.test(template.id ?? '')) throw new Error('Invalid plugin ID');
  const files = Object.create(null); const inventory = Object.create(null); const names = new Set(); let total = 0;
  const safe = relative => relative.length <= 1024 && relative.split('/').every(part => part && part !== '.' && part !== '..' && part.length <= 200 && !/[\\:*?"<>|\x00-\x1f\x7f]/.test(part) && !/[ .]$/.test(part) && !/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(part));
  const walk = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name); const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (!safe(relative)) throw new Error(`Unsafe package path: ${relative}`);
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`Links are not supported: ${relative}`);
      if (metadata.isDirectory()) { walk(absolute); continue; }
      if (!metadata.isFile()) throw new Error(`Only regular files are supported: ${relative}`);
      if (relative === 'manifest.json') continue;
      if (['manifest.json', 'signature.json'].includes(relative.toLowerCase())) throw new Error('Reserved package metadata filename');
      if (names.has(relative.toLowerCase())) throw new Error(`Duplicate case-insensitive path: ${relative}`);
      names.add(relative.toLowerCase()); total += metadata.size;
      if (total > 300 * 1024 * 1024 || names.size > 5000) throw new Error('Plugin exceeds package limits');
      const bytes = fs.readFileSync(absolute); files[relative] = bytes; inventory[relative] = hash(bytes);
    }
  };
  walk(root);
  if (!Object.hasOwn(inventory, template.entry) || !template.entry.endsWith('.html')) throw new Error('The HTML entry must be included in the package');
  for (const capability of template.capabilities ?? []) if (!['tasks.read', 'tasks.write', 'wiki.read', 'wiki.write'].includes(capability)) throw new Error(`Unknown capability: ${capability}`);
  for (const domain of ['tasks', 'wiki']) if (template.capabilities?.includes(`${domain}.write`) && !template.capabilities.includes(`${domain}.read`)) throw new Error(`${domain}.write also requires ${domain}.read`);
  const manifest = Buffer.from(JSON.stringify({ ...template, files: inventory }));
  if (manifest.length > 256 * 1024) throw new Error('Manifest exceeds 256 KiB');
  const privateKey = createPrivateKey(fs.readFileSync(keyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 signing key is required');
  const publicKey = Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url');
  const signature = Buffer.from(JSON.stringify({ publicKey: publicKey.toString('base64'), signature: sign(null, Buffer.concat([context, manifest]), privateKey).toString('base64') }));
  files['manifest.json'] = manifest; files['signature.json'] = signature;
  // ZIP stores local calendar fields rather than an instant. Fix those fields so
  // packaging on machines in different time zones produces identical bytes.
  const archive = zipSync(files, { level: 6, mtime: new Date(1980, 0, 1, 0, 0, 0), os: 3, attrs: (0o100644 << 16) >>> 0 });
  if (archive.length > 100 * 1024 * 1024) throw new Error('Compressed package exceeds 100 MiB');
  fs.writeFileSync(output, archive, { flag: 'wx' });
  return { publisherId: hash(publicKey), pluginId: template.id, version: template.version, sha256: hash(archive), sizeBytes: archive.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2); const options = {};
  for (let i = 0; i < args.length; i += 2) { if (!args[i].startsWith('--') || !args[i + 1]) throw new Error('Expected --option value'); options[args[i].slice(2)] = args[i + 1]; }
  if (command === 'keygen' && options.out) console.log(`Publisher fingerprint: ${generatePluginKey(options.out)}`);
  else if (command === 'pack' && options.input && options.key && options.out) console.log(JSON.stringify(packageWebPlugin({ input: options.input, key: options.key, output: options.out }), null, 2));
  else { console.error('Usage:\n  npm run plugin:package -- keygen --out publisher.pem\n  npm run plugin:package -- pack --input examples/plugins/hello-web --key publisher.pem --out hello.lmpk'); process.exitCode = 1; }
}
