import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PAIRS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
export const TAG = 'v9.9.9';

export function fakeBinary(pair) {
  return `#!/bin/sh\n# ${pair}\necho "factory 9.9.9 (kaas.team)"\n`;
}

export const shaOf = (text) => createHash('sha256').update(text).digest('hex');

// Builds <root>/download/<tag>/ and <root>/latest/download/, the layout of a GitHub releases
// URL, so FACTORY_DOWNLOAD_BASE=file://<root> works. Returns { root, base, tag, sumsOf }.
export function makeRelease({ tag = TAG, dir } = {}) {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'release-'));
  const sums = PAIRS.map((p) => `${shaOf(fakeBinary(p))}  factory-${p}`).join('\n') + '\n';
  for (const sub of [join('download', tag), join('latest', 'download')]) {
    const d = join(root, sub);
    mkdirSync(d, { recursive: true });
    for (const p of PAIRS) {
      writeFileSync(join(d, `factory-${p}`), fakeBinary(p));
      chmodSync(join(d, `factory-${p}`), 0o644);
    }
    writeFileSync(join(d, 'SHA256SUMS'), sums);
  }
  return { root, base: `file://${root}`, tag, sums };
}
