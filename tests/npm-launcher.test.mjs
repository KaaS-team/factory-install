import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePlatformPackage } from './fixtures/fake-platforms.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const launcherPath = join(root, 'npm/factory/bin/factory.js');
const launcher = createRequire(import.meta.url)(launcherPath);
const PAIRS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];

const harness = (platform, arch, baseDir) =>
  `require(${JSON.stringify(launcherPath)}).main(process.argv.slice(1), ${JSON.stringify({ platform, arch, baseDir })})`;

function run(platform, arch, baseDir, args = [], env = {}) {
  return spawnSync(process.execPath, ['-e', harness(platform, arch, baseDir), '--', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('npm launcher', () => {
  let tmp;
  let base;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'launcher-'));
    base = join(tmp, 'app');
    for (const pair of PAIRS) writePlatformPackage(join(base, 'node_modules/@kaas-team', `factory-${pair}`), pair);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('(a) maps the four pairs and rejects others', () => {
    for (const pair of PAIRS) {
      const [p, a] = pair.split('-');
      assert.equal(launcher.platformPackage(p, a), `@kaas-team/factory-${pair}`);
    }
    for (const [p, a] of [['win32', 'x64'], ['linux', 'ia32'], ['freebsd', 'x64']]) {
      assert.equal(launcher.platformPackage(p, a), null);
    }
  });

  it('(b) each pair runs its own binary', () => {
    for (const pair of PAIRS) {
      const [p, a] = pair.split('-');
      const r = run(p, a, base);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.startsWith(`fake ${pair}`), r.stdout);
    }
  });

  it('(c) passes arguments and the exit code through', () => {
    const r = run('linux', 'x64', base, ['--flag', 'a b', ''], { FAKE_EXIT: '7' });
    assert.equal(r.status, 7);
    assert.equal(r.stdout, 'fake linux-x64\n[--flag]\n[a b]\n[]\n');
  });

  it('(d) unsupported platform names it and the install line', () => {
    const r = run('win32', 'x64', base);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /win32-x64/);
    assert.ok(r.stderr.includes(launcher.INSTALL_LINE));
  });

  it('(e) missing package names it, --omit=optional and the install line', () => {
    const r = run('linux', 'x64', join(tmp, 'empty'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /@kaas-team\/factory-linux-x64/);
    assert.match(r.stderr, /--omit=optional/);
    assert.ok(r.stderr.includes(launcher.INSTALL_LINE));
  });

  it('(f) a tampered binary is refused and never runs', () => {
    const dir = join(tmp, 'tampered');
    writePlatformPackage(join(dir, 'node_modules/@kaas-team/factory-linux-x64'), 'linux-x64');
    appendFileSync(join(dir, 'node_modules/@kaas-team/factory-linux-x64/bin/factory'), '\n# x\n');
    const mark = join(tmp, 'mark');
    const r = run('linux', 'x64', dir, [], { FAKE_MARK: mark });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /checksum mismatch/);
    assert.equal(existsSync(mark), false);
  });

  it('(g) forwards SIGTERM to the child', async () => {
    const p = spawn(process.execPath, ['-e', harness('linux', 'x64', base), '--'], {
      env: { ...process.env, FAKE_SLEEP: '1' },
    });
    let out = '';
    await new Promise((resolve, reject) => {
      p.on('error', reject);
      p.stdout.on('data', (d) => {
        const first = out === '';
        out += d;
        if (first && out.includes('\n')) p.kill('SIGTERM');
      });
      p.on('close', resolve);
    });
    assert.match(out, /got TERM/);
  });

  it('(h) structure', () => {
    const src = readFileSync(launcherPath, 'utf8');
    assert.ok(src.startsWith('#!/usr/bin/env node\n'));
    const reqs = [...src.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(reqs.length > 0);
    for (const r of reqs) assert.match(r, /^['"`]node:/, r);
    const pkg = JSON.parse(readFileSync(join(root, 'npm/factory/package.json'), 'utf8'));
    assert.ok(pkg.bin.factory);
    for (const k of ['version', 'dependencies', 'optionalDependencies']) assert.equal(k in pkg, false, k);
    assert.ok(readFileSync(join(root, 'install.sh'), 'utf8').includes(launcher.INSTALL_LINE));
  });
});
