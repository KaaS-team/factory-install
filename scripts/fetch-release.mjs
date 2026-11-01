// The one place a release is trusted: download, cosign-verify SHA256SUMS, then check each binary.
//   node scripts/fetch-release.mjs <tag> <dir>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'KaaS-team/factory';
export const PAIRS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
export const ASSETS = PAIRS.map((p) => `factory-${p}`);
export const IDENTITY = '^https://github.com/KaaS-team/factory/';
export const ISSUER = 'https://token.actions.githubusercontent.com';

export function readSums(text) {
  const sums = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/.exec(line);
    if (m && !sums.has(m[2])) sums.set(m[2], m[1]);
  }
  return sums;
}

const defaultRun = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

export function fetchRelease({ tag, dir, run = defaultRun }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error(`bad tag ${tag}, want vX.Y.Z`);
  mkdirSync(dir, { recursive: true });
  const files = [...ASSETS, 'SHA256SUMS', 'SHA256SUMS.sigstore.json'];
  run('gh', ['release', 'download', tag, '-R', REPO, '--clobber', '-D', dir, ...files.flatMap((f) => ['-p', f])]);
  run(
    'cosign',
    ['verify-blob', '--bundle', 'SHA256SUMS.sigstore.json', '--certificate-identity-regexp', IDENTITY, '--certificate-oidc-issuer', ISSUER, 'SHA256SUMS'],
    { cwd: dir },
  );
  const sums = readSums(readFileSync(join(dir, 'SHA256SUMS'), 'utf8'));
  for (const asset of ASSETS) {
    const want = sums.get(asset);
    if (!want) throw new Error(`no checksum listed for ${asset}`);
    const got = createHash('sha256').update(readFileSync(join(dir, asset))).digest('hex');
    if (got !== want) throw new Error(`checksum mismatch for ${asset}`);
  }
  return sums;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [tag, dir] = process.argv.slice(2);
    if (!tag || !dir) throw new Error('usage: fetch-release.mjs <tag> <dir>');
    fetchRelease({ tag, dir });
    console.log(`verified ${tag} in ${dir}`);
  } catch (err) {
    console.error(`fetch-release: ${err.message}`);
    process.exit(1);
  }
}
