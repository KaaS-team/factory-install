import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAIRS, TAG, makeRelease } from './fixtures/release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const installSh = join(root, 'install.sh');
const UNAME = { 'darwin-arm64': ['Darwin', 'arm64'], 'darwin-x64': ['Darwin', 'x86_64'], 'linux-arm64': ['Linux', 'aarch64'], 'linux-x64': ['Linux', 'x86_64'] };

describe('install.sh', () => {
  let tmp;
  let rel;
  let stubs;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'install-sh-'));
    rel = makeRelease({ dir: join(tmp, 'rel') });
    stubs = join(tmp, 'stubs');
    mkdirSync(stubs);
    const u = join(stubs, 'uname');
    writeFileSync(u, '#!/bin/sh\ncase "$1" in -s) echo "$STUB_OS" ;; -m) echo "$STUB_ARCH" ;; esac\n');
    chmodSync(u, 0o755);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  const run = (args, { os = 'Linux', arch = 'x86_64', base = rel.base, env = {}, home } = {}) =>
    spawnSync('sh', [installSh, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${stubs}:${process.env.PATH}`,
        HOME: home ?? join(tmp, 'home'),
        STUB_OS: os,
        STUB_ARCH: arch,
        FACTORY_DOWNLOAD_BASE: base,
        ...env,
      },
    });
  const fresh = (name) => join(tmp, name);

  it('installs the verified binary for each platform and it runs', () => {
    for (const pair of PAIRS) {
      const dir = fresh(`bin-${pair}`);
      const [os, arch] = UNAME[pair];
      const r = run(['--dir', dir], { os, arch });
      assert.equal(r.status, 0, r.stderr);
      const bin = spawnSync(join(dir, 'factory'), { encoding: 'utf8' });
      assert.equal(bin.stdout, 'factory 9.9.9 (kaas.team)\n');
      assert.match(readFileSync(join(dir, 'factory'), 'utf8'), new RegExp(`# ${pair}`));
      assert.deepEqual(readdirSync(dir), ['factory'], 'no temp files left behind');
    }
  });

  it('--version reads that tag and the default reads latest', () => {
    assert.equal(run(['--dir', fresh('v1'), '--version', TAG]).status, 0);
    assert.equal(run(['--dir', fresh('v2'), '--version', '9.9.9']).status, 0);
    const bad = run(['--dir', fresh('v3'), '--version', 'v1.0.0']);
    assert.equal(bad.status, 1);
    assert.equal(existsSync(join(fresh('v3'), 'factory')), false);
  });

  it('a corrupted sum aborts and leaves no file', () => {
    const bad = makeRelease({ dir: join(tmp, 'rel-bad') });
    const sumsFile = join(bad.root, 'latest', 'download', 'SHA256SUMS');
    writeFileSync(sumsFile, readFileSync(sumsFile, 'utf8').replace(/^[0-9a-f]{8}/gm, '00000000'));
    const dir = fresh('bin-bad');
    const r = run(['--dir', dir], { base: bad.base });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /checksum mismatch for factory-linux-x64/);
    assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
  });

  it('a corrupted sum keeps an older binary', () => {
    const dir = fresh('bin-keep');
    mkdirSync(dir);
    writeFileSync(join(dir, 'factory'), '#!/bin/sh\necho old\n');
    chmodSync(join(dir, 'factory'), 0o755);
    const bad = makeRelease({ dir: join(tmp, 'rel-bad2') });
    const sumsFile = join(bad.root, 'latest', 'download', 'SHA256SUMS');
    writeFileSync(sumsFile, readFileSync(sumsFile, 'utf8').replace(/^[0-9a-f]{8}/gm, '00000000'));
    assert.equal(run(['--dir', dir], { base: bad.base }).status, 1);
    assert.equal(spawnSync(join(dir, 'factory'), { encoding: 'utf8' }).stdout, 'old\n');
  });

  it('a second run says already installed', () => {
    const dir = fresh('bin-twice');
    assert.equal(run(['--dir', dir]).status, 0);
    const again = run(['--dir', dir]);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /factory 9\.9\.9 is already installed/);
    const tagged = run(['--dir', dir, '--version', TAG]);
    assert.match(tagged.stdout, /factory v9\.9\.9 is already installed/);
  });

  it('--uninstall removes the binary and nothing else', () => {
    const dir = fresh('bin-un');
    run(['--dir', dir]);
    writeFileSync(join(dir, 'keep'), 'x');
    assert.equal(run(['--dir', dir, '--uninstall']).status, 0);
    assert.deepEqual(readdirSync(dir), ['keep']);
    assert.equal(run(['--dir', dir, '--uninstall']).status, 0);
  });

  it('prints the PATH line only when the dir is not on PATH', () => {
    const off = run(['--dir', fresh('bin-off')]);
    assert.match(off.stdout, /export PATH="[^"]*bin-off:\$PATH"/);
    const dir = fresh('bin-on');
    const on = run(['--dir', dir], { env: { PATH: `${dir}:${stubs}:${process.env.PATH}` } });
    assert.doesNotMatch(on.stdout, /export PATH/);
  });

  it('--dir defaults to FACTORY_INSTALL_DIR, then HOME/.local/bin', () => {
    const viaEnv = fresh('bin-env');
    assert.equal(run([], { env: { FACTORY_INSTALL_DIR: viaEnv } }).status, 0);
    assert.ok(existsSync(join(viaEnv, 'factory')));
    const home = fresh('home-default');
    assert.equal(run([], { home }).status, 0);
    assert.ok(existsSync(join(home, '.local/bin/factory')));
  });

  it('an unknown arch or os exits 2 and names the platform', () => {
    const arch = run(['--dir', fresh('bin-x')], { arch: 'riscv64' });
    assert.equal(arch.status, 2);
    assert.match(arch.stderr, /processor/);
    assert.equal(run(['--dir', fresh('bin-x')], { os: 'FreeBSD' }).status, 2);
    assert.equal(existsSync(fresh('bin-x')), false);
  });

  it('is POSIX sh text with the exact checksum line and no em dashes', () => {
    const text = readFileSync(installSh, 'utf8');
    assert.ok(text.includes('[ "$got" = "$want" ] || die "checksum mismatch for $asset"'));
    assert.ok(text.startsWith('#!/bin/sh'));
    assert.doesNotMatch(text, /\u2014/);
  });
});

describe('site', () => {
  const dockerfile = readFileSync(join(root, 'site/Dockerfile'), 'utf8');
  const conf = readFileSync(join(root, 'site/nginx.conf'), 'utf8');

  it('the Dockerfile is nginx:1.27-alpine and serves only the repo install.sh', () => {
    assert.match(dockerfile, /^FROM nginx:1\.27-alpine$/m);
    const copies = dockerfile.split('\n').filter((l) => l.startsWith('COPY '));
    const intoHtml = copies.filter((l) => l.includes('/usr/share/nginx/html'));
    assert.deepEqual(intoHtml, ['COPY install.sh /usr/share/nginx/html/install.sh']);
    assert.deepEqual(copies.filter((l) => !intoHtml.includes(l)), ['COPY site/nginx.conf /etc/nginx/conf.d/default.conf']);
  });

  it('nginx serves install.sh at / and /install.sh as text/plain, plus /healthz', () => {
    assert.match(conf, /location = \/ \{/);
    assert.match(conf, /location = \/install\.sh \{/);
    assert.match(conf, /location = \/healthz \{/);
    assert.equal((conf.match(/default_type text\/plain;/g) ?? []).length, 3);
  });
});
