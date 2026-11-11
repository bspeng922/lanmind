import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const nativeRoot = fileURLToPath(new URL('../src-tauri/', import.meta.url));

export function activePackages(tree) {
  const packages = new Set();
  for (const line of tree.trim().split(/\r?\n/)) {
    if (/^\[(?:build|dev)-dependencies\]$/.test(line)) continue;
    const match = line.match(/^([\w-]+) v(\S+)(?:\s|$)/);
    if (!match) throw new Error(`Unrecognized cargo tree output: ${line}`);
    packages.add(`${match[1]}@${match[2]}`);
  }
  if (!packages.size) throw new Error('Cargo returned no active dependencies');
  return packages;
}

export function classifyVulnerabilities(report, packages) {
  if (!Array.isArray(report?.vulnerabilities?.list)) throw new Error('Invalid cargo audit report');
  const active = [];
  const inactive = [];
  for (const finding of report.vulnerabilities.list) {
    const { name, version } = finding.package || {};
    if (!name || !version || !finding.advisory?.id) throw new Error('Invalid vulnerability record');
    (packages.has(`${name}@${version}`) ? active : inactive).push(finding);
  }
  return { active, inactive };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: nativeRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function label(finding) {
  return `${finding.advisory.id}: ${finding.package.name}@${finding.package.version} — ${finding.advisory.title}`;
}

function main() {
  // Cargo.lock (and cargo metadata) includes disabled optional dependencies.
  // Cargo tree uses the selected feature graph; include build/dev edges and every
  // platform so a Windows-only vulnerability cannot be hidden by a Linux CI job.
  const tree = run('cargo', ['tree', '--locked', '--target', 'all', '--edges', 'normal,build,dev', '--prefix', 'none', '--format', '{p}']);
  if (tree.status !== 0) throw new Error('Could not resolve the active Cargo dependency graph');
  const packages = activePackages(tree.stdout);
  const audit = run(process.env.CARGO_AUDIT || 'cargo-audit', ['audit', '--json']);
  if (audit.status !== 0 && audit.status !== 1) throw new Error(`cargo audit failed (${audit.status})`);
  const report = JSON.parse(audit.stdout);
  const { active, inactive } = classifyVulnerabilities(report, packages);
  if (audit.status === 1 && active.length + inactive.length === 0) throw new Error('cargo audit failed without a vulnerability report');
  for (const finding of inactive) console.log(`Disabled optional dependency: ${label(finding)}`);
  for (const finding of active) console.error(`Vulnerability: ${label(finding)}`);
  for (const [kind, warnings] of Object.entries(report.warnings || {})) {
    for (const warning of warnings) console.warn(`Warning (${kind}): ${warning.package.name}@${warning.package.version}${warning.advisory ? ` — ${warning.advisory.id}: ${warning.advisory.title}` : ''}`);
  }
  console.log(`${packages.size} active Rust packages; ${active.length} vulnerabilities; ${inactive.length} findings in disabled optional dependencies.`);
  if (active.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
