import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBinary, shaOf } from './fixtures/release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'scripts/release/publish.yml');
const text = readFileSync(src, 'utf8');
const jobsOrder = [...text.matchAll(/^  ([a-z-]+):\n/gm)].map((m) => m[1]);
const section = (job) => {
  const start = text.indexOf(`\n  ${job}:\n`);
  assert.ok(start >= 0, `job ${job} missing`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

describe('publish workflow', () => {
  it('runs on dispatch with a tag input and an hourly schedule', () => {
    assert.match(text, /workflow_dispatch:\n\s+inputs:\n\s+tag:/);
    assert.match(text, /schedule:\n\s+- cron: "\d+ \* \* \* \*"/);
  });

  it('orders the jobs check, publish, same-sha', () => {
    assert.deepEqual(jobsOrder.filter((j) => ['check', 'publish', 'same-sha'].includes(j)), ['check', 'publish', 'same-sha']);
    assert.match(section('publish'), /needs: check/);
    assert.match(section('same-sha'), /needs: \[check, publish\]/);
    assert.match(section('check'), /timeout-minutes: 3\b/);
    assert.match(section('check'), /npm view @kaas-team\/factory version/);
  });

  it('publishes with provenance, platform packages before the wrapper', () => {
    const pub = section('publish');
    const publishes = pub.split('\n').filter((l) => l.includes('npm publish'));
    assert.equal(publishes.length, 2);
    for (const l of publishes) assert.match(l, /--provenance --access public/);
    assert.match(pub, /for d in dist\/release\/packages\/factory-\*-\*\//);
    assert.match(publishes[1], /packages\/factory /);
    assert.ok(pub.indexOf('packages/factory-*-*') < pub.indexOf('packages/factory --provenance'));
    assert.match(pub, /id-token: write/);
    assert.match(pub, /contents: read/);
    assert.ok(pub.indexOf('fetch-release') < pub.indexOf('npm-pack'));
    assert.ok(pub.indexOf('npm-pack') < pub.indexOf('npm publish'));
  });

  it('opens the tap PR and never auto-completes it', () => {
    assert.match(section('publish'), /gh pr create -R KaaS-team\/homebrew-tap/);
    assert.doesNotMatch(text, /gh pr (merge|review)|--auto|--admin/);
  });

  it('runs same-sha on macos-14 and ubuntu-latest through all three installers', () => {
    const s = section('same-sha');
    assert.match(s, /os: \[macos-14, ubuntu-latest\]/);
    assert.match(s, /sh install\.sh --version "\$TAG"/);
    assert.match(s, /npm i -g "@kaas-team\/factory@/);
    assert.match(s, /brew install --formula \.\/dist\/Formula\/factory\.rb/);
    assert.match(s, /scripts\/same-sha\.sh/);
  });

  it('uses no secret except NPM_TOKEN and TAP_TOKEN', () => {
    const used = new Set([...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    assert.deepEqual([...used].sort(), ['NPM_TOKEN', 'TAP_TOKEN']);
    assert.doesNotMatch(text, /secrets\[/);
  });

  it('pins every action to a commit sha with its tag beside it', () => {
    const uses = text.split('\n').filter((l) => /^\s*(- )?uses:/.test(l));
    assert.ok(uses.length >= 4);
    for (const l of uses) assert.match(l, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, l);
  });

  it('.github/workflows/publish.yml, once present, is byte-equal to the source', (t) => {
    const copy = join(root, '.github/workflows/publish.yml');
    if (!existsSync(copy)) return t.skip('operator has not copied it in yet');
    assert.ok(readFileSync(copy).equals(readFileSync(src)));
  });
});

describe('same-sha.sh', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'same-sha-'));
  const run = (...args) => spawnSync('sh', [join(root, 'scripts/same-sha.sh'), ...args], { encoding: 'utf8' });
  const bin = (name, body) => {
    const f = join(tmp, name);
    writeFileSync(f, body);
    chmodSync(f, 0o755);
    return f;
  };
  const good = fakeBinary('linux-x64');
  const sums = join(tmp, 'SHA256SUMS');
  writeFileSync(sums, `${shaOf(good)}  factory-linux-x64\n`);

  it('passes when all three binaries equal the sums line', () => {
    const r = run('factory-linux-x64', sums, bin('a', good), bin('b', good), bin('c', good));
    assert.equal(r.status, 0, r.stderr);
  });

  it('fails when any one differs or is missing, and names it', () => {
    const r = run('factory-linux-x64', sums, bin('a', good), bin('rewritten', `${good}x`), bin('c', good));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /rewritten is [0-9a-f]{64}, want/);
    assert.equal(run('factory-linux-x64', sums, bin('a', good), join(tmp, 'nope')).status, 1);
    assert.equal(run('factory-darwin-x64', sums, bin('a', good)).status, 1);
    rmSync(tmp, { recursive: true, force: true });
  });
});
