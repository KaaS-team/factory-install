import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRelease, readSums } from '../scripts/fetch-release.mjs';
import { makeAssets } from './fixtures/npm-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/npm-pack.mjs');
const { PLATFORMS, resolveBinary } = createRequire(import.meta.url)(join(root, 'npm/factory/bin/factory.js'));
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
// The CLI is `npm-pack.mjs <tag> <dir>` and writes <dir>/packages.
const cli = (dir, version) => spawnSync(process.execPath, [script, version, dir], { encoding: 'utf8' });

describe('npm pack', () => {
  let tmp;
  let assets;
  let out;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pack-'));
    assets = join(tmp, 'assets');
    out = join(assets, 'packages');
    makeAssets(assets);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('(a) writes five packages at one version', () => {
    const r = cli(assets, 'v9.9.9');
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
    const o = join(a, 'packages');
    const r = cli(a, '9.9.9');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /checksum mismatch for factory-darwin-arm64/);
    assert.equal(existsSync(o), false);
  });

  it('(e) a missing sums line fails', () => {
    const a = join(tmp, 'a-missing');
    makeAssets(a);
    const f = join(a, 'SHA256SUMS');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').slice(1).join('\n'));
    const o = join(a, 'packages');
    const r = cli(a, '9.9.9');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no checksum listed/);
    assert.equal(existsSync(o), false);
  });

  it('(f) a bad version fails', () => {
    const a = join(tmp, 'a-ver');
    makeAssets(a);
    assert.equal(cli(a, '9.9').status, 1);
    assert.equal(existsSync(join(a, 'packages')), false);
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

describe('wrapper source and fetch-release', () => {
  it('the wrapper package.json names the four platform packages and the repo', () => {
    const pkg = readJson(join(root, 'npm/factory/package.json'));
    assert.equal(pkg.name, '@kaas-team/factory');
    assert.equal(pkg.bin.factory, 'bin/factory.js');
    assert.match(pkg.repository.url, /KaaS-team\/factory-install/);
    assert.deepEqual(Object.keys(pkg.optionalDependencies), PLATFORMS.map((p) => `@kaas-team/factory-${p}`));
  });

  it('readSums maps asset to sha for text and binary mode lines', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const m = readSums(`${a}  factory-x\n${b} *factory-y\nnot a line\n`);
    assert.equal(m.get('factory-x'), a);
    assert.equal(m.get('factory-y'), b);
    assert.equal(m.size, 2);
  });
});

describe('fetch-release', () => {
  let tmp;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fetch-'));
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  const runner = (dir, calls, { corrupt = false, cosignFails = false } = {}) => (cmd, args, opts) => {
    calls.push([cmd, args, opts?.cwd]);
    if (cmd === 'gh') {
      makeAssets(dir);
      if (corrupt) writeFileSync(join(dir, 'factory-linux-x64'), 'tampered');
    }
    if (cmd === 'cosign' && cosignFails) throw new Error('cosign failed');
  };

  it('downloads, verifies the bundle with the pinned identity, then checks each binary', () => {
    const dir = join(tmp, 'ok');
    const calls = [];
    const sums = fetchRelease({ tag: 'v9.9.9', dir, run: runner(dir, calls) });
    assert.equal(sums.size, 4);
    assert.deepEqual(calls.map((c) => c[0]), ['gh', 'cosign']);
    const [, args, cwd] = calls[1];
    assert.equal(cwd, dir);
    assert.deepEqual(args.slice(0, 2), ['verify-blob', '--bundle']);
    assert.ok(args.includes('SHA256SUMS.sigstore.json'));
    assert.equal(args[args.indexOf('--certificate-identity-regexp') + 1], '^https://github.com/KaaS-team/factory/');
    assert.equal(args[args.indexOf('--certificate-oidc-issuer') + 1], 'https://token.actions.githubusercontent.com');
    assert.equal(args.at(-1), 'SHA256SUMS');
  });

  it('a failed cosign check or a tampered binary throws', () => {
    const d1 = join(tmp, 'cosign');
    assert.throws(() => fetchRelease({ tag: 'v9.9.9', dir: d1, run: runner(d1, [], { cosignFails: true }) }), /cosign failed/);
    const d2 = join(tmp, 'tamper');
    assert.throws(() => fetchRelease({ tag: 'v9.9.9', dir: d2, run: runner(d2, [], { corrupt: true }) }), /checksum mismatch for factory-linux-x64/);
  });

  it('rejects a tag that is not vX.Y.Z', () => {
    assert.throws(() => fetchRelease({ tag: 'latest', dir: join(tmp, 'x'), run: () => {} }), /bad tag/);
  });
});
