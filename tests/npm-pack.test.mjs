import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAssets } from './fixtures/npm-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/npm-pack.mjs');
const { PLATFORMS, resolveBinary } = createRequire(import.meta.url)(join(root, 'npm/factory/bin/factory.js'));
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const cli = (assets, out, version) =>
  spawnSync(process.execPath, [script, '--assets', assets, '--out', out, '--version', version], { encoding: 'utf8' });

describe('npm pack', () => {
  let tmp;
  let assets;
  let out;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pack-'));
    assets = join(tmp, 'assets');
    out = join(tmp, 'out');
    makeAssets(assets);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('(a) writes five packages at one version', () => {
    const r = cli(assets, out, 'v9.9.9');
    assert.equal(r.status, 0, r.stderr);
    for (const d of [...PLATFORMS.map((p) => `factory-${p}`), 'factory']) {
      assert.equal(readJson(join(out, d, 'package.json')).version, '9.9.9');
    }
  });

  it('(b) wrapper optionalDependencies come from PLATFORMS', () => {
    const od = readJson(join(out, 'factory/package.json')).optionalDependencies;
    assert.deepEqual(Object.keys(od), PLATFORMS.map((p) => `@kaas-team/factory-${p}`));
    for (const v of Object.values(od)) assert.equal(v, '9.9.9');
  });

  it('(c) platform packages carry os, cpu, sha and an executable', () => {
    const sums = readFileSync(join(assets, 'SHA256SUMS'), 'utf8');
    for (const pair of PLATFORMS) {
      const [os, cpu] = pair.split('-');
      const pkg = readJson(join(out, `factory-${pair}`, 'package.json'));
      assert.deepEqual(pkg.os, [os]);
      assert.deepEqual(pkg.cpu, [cpu]);
      assert.equal('bin' in pkg, false);
      assert.match(sums, new RegExp(`^${pkg.factorySha256} [ *]\\*?factory-${pair}$`, 'm'));
      assert.equal(statSync(join(out, `factory-${pair}`, 'bin/factory')).mode & 0o777, 0o755);
    }
  });

  it('(d) a wrong sum names the asset and writes nothing', () => {
    const a = join(tmp, 'a-bad');
    makeAssets(a);
    const f = join(a, 'SHA256SUMS');
    const t = readFileSync(f, 'utf8');
    writeFileSync(f, (t[0] === '0' ? '1' : '0') + t.slice(1));
    const o = join(tmp, 'out-bad');
    const r = cli(a, o, '9.9.9');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /checksum mismatch for factory-darwin-arm64/);
    assert.equal(existsSync(o), false);
  });

  it('(e) a missing sums line fails', () => {
    const a = join(tmp, 'a-missing');
    makeAssets(a);
    const f = join(a, 'SHA256SUMS');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').slice(1).join('\n'));
    const o = join(tmp, 'out-missing');
    const r = cli(a, o, '9.9.9');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no checksum listed/);
    assert.equal(existsSync(o), false);
  });

  it('(f) a bad version fails', () => {
    const o = join(tmp, 'out-ver');
    assert.equal(cli(assets, o, '9.9').status, 1);
    assert.equal(existsSync(o), false);
  });

  it('(g) the launcher accepts the packed host package', () => {
    const pair = `${process.platform}-${process.arch}`;
    assert.ok(PLATFORMS.includes(pair), `host ${pair} is not supported`);
    const app = join(tmp, 'app/node_modules/@kaas-team');
    spawnSync('mkdir', ['-p', app]);
    spawnSync('cp', ['-R', join(out, `factory-${pair}`), join(app, `factory-${pair}`)]);
    const r = resolveBinary({ platform: process.platform, arch: process.arch, baseDir: join(tmp, 'app') });
    assert.equal(r.ok, true, r.reason);
  });
});
