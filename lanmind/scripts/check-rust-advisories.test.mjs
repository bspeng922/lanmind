import assert from 'node:assert/strict';
import test from 'node:test';
import { activePackages, classifyVulnerabilities } from './check-rust-advisories.mjs';

const finding = { package: { name: 'rsa', version: '0.9.10' }, advisory: { id: 'RUSTSEC-2023-0071' } };
const report = { vulnerabilities: { list: [finding] } };

test('advisories become blocking when an optional dependency is enabled on any platform', () => {
  const disabled = activePackages('lanmind v0.2.2 (D:\\lanmind)\nssh-key v0.6.7\nssh-key v0.6.7 (*)\n');
  assert.deepEqual(classifyVulnerabilities(report, disabled), { active: [], inactive: [finding] });
  const enabled = activePackages('lanmind v0.2.2\nrsa v0.9.10\n');
  assert.deepEqual(classifyVulnerabilities(report, enabled), { active: [finding], inactive: [] });
});

test('the advisory gate rejects missing or malformed dependency and audit data', () => {
  assert.throws(() => activePackages(''), /Unrecognized/);
  assert.throws(() => activePackages('cargo failed'), /Unrecognized/);
  assert.throws(() => classifyVulnerabilities({}, new Set()), /Invalid cargo audit/);
  assert.throws(() => classifyVulnerabilities({ vulnerabilities: { list: [{}] } }, new Set()), /Invalid vulnerability/);
});
