import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAIRS, makeRelease } from './fixtures/release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/brew-formula.mjs');

describe('brew formula', () => {
  const rel = makeRelease();
  const tmp = mkdtempSync(join(tmpdir(), 'brew-'));
  const sumsFile = join(tmp, 'SHA256SUMS');
  writeFileSync(sumsFile, rel.sums);
  const out = join(tmp, 'Formula/factory.rb');
  const r = spawnSync(process.execPath, [script, 'v9.9.9', sumsFile, out], { encoding: 'utf8' });
  const formula = r.status === 0 ? readFileSync(out, 'utf8') : '';

  it('renders without error', () => {
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(formula, /@@/);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('pairs each url with its own sha from the sums', () => {
    const want = new Map(rel.sums.trim().split('\n').map((l) => l.split('  ').reverse()));
    assert.equal(new Set(want.values()).size, 4, 'fixture shas must differ');
    for (const pair of PAIRS) {
      const asset = `factory-${pair}`;
      const url = `https://github.com/KaaS-team/factory/releases/download/v9.9.9/${asset}`;
      const re = new RegExp(`url "${url}"\\n\\s+sha256 "([0-9a-f]{64})"`);
      const m = re.exec(formula);
      assert.ok(m, `no url/sha pair for ${asset}`);
      assert.equal(m[1], want.get(asset), `wrong sha for ${asset}`);
    }
  });

  it('nests arm and intel under macos and linux and keeps the version test', () => {
    assert.match(formula, /on_macos do\n\s+on_arm do[\s\S]*?on_intel do[\s\S]*?on_linux do\n\s+on_arm do[\s\S]*?on_intel do/);
    assert.match(formula, /version "9\.9\.9"/);
    assert.match(formula, /bin\.install .* => "factory"/);
    assert.ok(formula.includes('assert_match "kaas.team", shell_output("#{bin}/factory --version")'));
  });

  it('fails when a sum is missing or the tag is bad', () => {
    const d = mkdtempSync(join(tmpdir(), 'brew-bad-'));
    const f = join(d, 'SHA256SUMS');
    writeFileSync(f, rel.sums.split('\n').slice(1).join('\n'));
    const bad = spawnSync(process.execPath, [script, 'v9.9.9', f, join(d, 'x.rb')], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /no checksum listed for factory-darwin-arm64/);
    const tag = spawnSync(process.execPath, [script, '9.9', f, join(d, 'x.rb')], { encoding: 'utf8' });
    assert.equal(tag.status, 1);
    rmSync(d, { recursive: true, force: true });
  });
});
