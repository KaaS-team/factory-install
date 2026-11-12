import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const PAIRS = ['darwin-arm64', 'darwin-amd64', 'linux-arm64', 'linux-amd64'];
export const TAG = 'v9.9.9';
export const archiveName = (pair) => `factory_${pair.replace('-', '_')}.tar.gz`;

export function fakeBinary(pair) {
  return `#!/bin/sh\n# ${pair}\necho "factory 9.9.9 (kaas.team)"\n`;
}

export const shaOf = (data) => createHash('sha256').update(data).digest('hex');

// Builds <root>/download/<tag>/ and <root>/latest/download/, the layout of a GitHub releases
// URL, holding goreleaser style archives and checksums.txt. Serve <root> over HTTP.
// Returns { root, tag, sums, sumsOf }.
export function makeRelease({ tag = TAG, dir } = {}) {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'release-'));
  const stage = mkdtempSync(join(tmpdir(), 'release-stage-'));
  const lines = [];
  const archives = {};
  for (const p of PAIRS) {
    const d = join(stage, p);
    mkdirSync(d);
    writeFileSync(join(d, 'factory'), fakeBinary(p));
    chmodSync(join(d, 'factory'), 0o755);
    const name = archiveName(p);
    execFileSync('tar', ['-czf', join(stage, name), '-C', d, 'factory']);
    archives[name] = readFileSync(join(stage, name));
    lines.push(`${shaOf(archives[name])}  ${name}`);
  }
  rmSync(stage, { recursive: true, force: true });
  const sums = lines.join('\n') + '\n';
  for (const sub of [join('download', tag), join('latest', 'download')]) {
    const d = join(root, sub);
    mkdirSync(d, { recursive: true });
    for (const [name, data] of Object.entries(archives)) writeFileSync(join(d, name), data);
    writeFileSync(join(d, 'checksums.txt'), sums);
  }
  return { root, tag, sums };
}
