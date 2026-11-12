import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAIRS, TAG, archiveName, makeRelease } from './fixtures/release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const installSh = join(root, 'install.sh');
const serve = (rootDir) =>
  new Promise((res) => {
    const srv = createServer((req, resp) => {
      const f = join(rootDir, decodeURIComponent(req.url.split('?')[0]));
      if (!f.startsWith(rootDir) || !existsSync(f) || !statSync(f).isFile()) { resp.statusCode = 404; return resp.end('no'); }
      createReadStream(f).pipe(resp);
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
const UNAME = { 'darwin-arm64': ['Darwin', 'arm64'], 'darwin-amd64': ['Darwin', 'x86_64'], 'linux-arm64': ['Linux', 'aarch64'], 'linux-amd64': ['Linux', 'x86_64'] };

describe('install.sh', () => {
  let tmp;
  let rel;
  let stubs;
  let base0;
  const servers = [];
  const host = async (r) => { const h = await serve(r.root); servers.push(h.srv); return h.base; };
  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'install-sh-'));
    rel = makeRelease({ dir: join(tmp, 'rel') });
    stubs = join(tmp, 'stubs');
    mkdirSync(stubs);
    const u = join(stubs, 'uname');
    writeFileSync(u, '#!/bin/sh\ncase "$1" in -s) echo "$STUB_OS" ;; -m) echo "$STUB_ARCH" ;; esac\n');
    chmodSync(u, 0o755);
    base0 = await host(rel);
  });
  after(() => { for (const x of servers) x.close(); rmSync(tmp, { recursive: true, force: true }); });

  const run = (args, { os = 'Linux', arch = 'x86_64', base = base0, env = {}, home } = {}) =>
    new Promise((res) => {
      const c = spawn('sh', [installSh, ...args], {
        env: {
          PATH: `${stubs}:${process.env.PATH}`,
          HOME: home ?? join(tmp, 'home'),
          STUB_OS: os,
          STUB_ARCH: arch,
          FACTORY_DOWNLOAD_BASE: base,
          ...env,
        },
      });
      let stdout = '';
      let stderr = '';
      c.stdout.on('data', (d) => (stdout += d));
      c.stderr.on('data', (d) => (stderr += d));
      c.on('close', (status) => res({ status, stdout, stderr }));
    });
  const fresh = (name) => join(tmp, name);

  it('installs the verified binary for each platform and it runs', async () => {
    for (const pair of PAIRS) {
      const dir = fresh(`bin-${pair}`);
      const [os, arch] = UNAME[pair];
      const r = await run(['--dir', dir], { os, arch });
      assert.equal(r.status, 0, r.stderr);
      const bin = spawnSync(join(dir, 'factory'), { encoding: 'utf8' });
      assert.equal(bin.stdout, 'factory 9.9.9 (kaas.team)\n');
      assert.match(readFileSync(join(dir, 'factory'), 'utf8'), new RegExp(`# ${pair}`));
      assert.deepEqual(readdirSync(dir), ['factory'], 'no temp files left behind');
    }
  });

  it('--version reads that tag and the default reads latest', async () => {
    assert.equal((await run(['--dir', fresh('v1'), '--version', TAG])).status, 0);
    assert.equal((await run(['--dir', fresh('v2'), '--version', '9.9.9'])).status, 0);
    const bad = await run(['--dir', fresh('v3'), '--version', 'v1.0.0']);
    assert.equal(bad.status, 1);
    assert.equal(existsSync(join(fresh('v3'), 'factory')), false);
  });

  it('a corrupted sum aborts and leaves no file', async () => {
    const bad = makeRelease({ dir: join(tmp, 'rel-bad') });
    bad.base = await host(bad);
    const sumsFile = join(bad.root, 'latest', 'download', 'checksums.txt');
    writeFileSync(sumsFile, readFileSync(sumsFile, 'utf8').replace(/^[0-9a-f]{8}/gm, '00000000'));
    const dir = fresh('bin-bad');
    const r = await run(['--dir', dir], { base: bad.base });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /checksum mismatch for factory_linux_amd64\.tar\.gz/);
    assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
  });

  it('a corrupted sum keeps an older binary', async () => {
    const dir = fresh('bin-keep');
    mkdirSync(dir);
    writeFileSync(join(dir, 'factory'), '#!/bin/sh\necho old\n');
    chmodSync(join(dir, 'factory'), 0o755);
    const bad = makeRelease({ dir: join(tmp, 'rel-bad2') });
    bad.base = await host(bad);
    const sumsFile = join(bad.root, 'latest', 'download', 'checksums.txt');
    writeFileSync(sumsFile, readFileSync(sumsFile, 'utf8').replace(/^[0-9a-f]{8}/gm, '00000000'));
    assert.equal((await run(['--dir', dir], { base: bad.base })).status, 1);
    assert.equal(spawnSync(join(dir, 'factory'), { encoding: 'utf8' }).stdout, 'old\n');
  });

  it('a missing archive or missing checksums.txt aborts with no install', async () => {
    const miss = makeRelease({ dir: join(tmp, 'rel-miss') });
    miss.base = await host(miss);
    rmSync(join(miss.root, 'latest', 'download', archiveName('linux-amd64')));
    const dir = fresh('bin-miss');
    const r = await run(['--dir', dir], { base: miss.base });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not download factory_linux_amd64\.tar\.gz/);
    assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
    rmSync(join(miss.root, 'latest', 'download', 'checksums.txt'));
    const r2 = await run(['--dir', dir], { base: miss.base });
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /could not download the checksum list/);
    const none = makeRelease({ dir: join(tmp, 'rel-nolist') });
    none.base = await host(none);
    const f = join(none.root, 'latest', 'download', 'checksums.txt');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter((l) => !l.includes('linux_amd64')).join('\n'));
    const r3 = await run(['--dir', dir], { base: none.base });
    assert.equal(r3.status, 1);
    assert.match(r3.stderr, /no checksum listed for factory_linux_amd64\.tar\.gz/);
  });

  it('an archive with no factory binary aborts', async () => {
    const odd = makeRelease({ dir: join(tmp, 'rel-odd') });
    odd.base = await host(odd);
    const d = join(odd.root, 'latest', 'download');
    const stage = join(tmp, 'odd-stage');
    mkdirSync(stage);
    writeFileSync(join(stage, 'other'), 'x');
    spawnSync('tar', ['-czf', join(d, archiveName('linux-amd64')), '-C', stage, 'other']);
    const sumsFile = join(d, 'checksums.txt');
    const sha = spawnSync('sha256sum', [join(d, archiveName('linux-amd64'))], { encoding: 'utf8' }).stdout.split(' ')[0];
    writeFileSync(sumsFile, `${sha}  ${archiveName('linux-amd64')}\n`);
    const r = await run(['--dir', fresh('bin-odd')], { base: odd.base });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not contain a factory binary/);
  });

  it('a second run says already installed', async () => {
    const dir = fresh('bin-twice');
    assert.equal((await run(['--dir', dir])).status, 0);
    const again = await run(['--dir', dir]);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /factory 9\.9\.9 is already installed/);
    const tagged = await run(['--dir', dir, '--version', TAG]);
    assert.match(tagged.stdout, /factory v9\.9\.9 is already installed/);
  });

  it('--uninstall removes the binary and nothing else', async () => {
    const dir = fresh('bin-un');
    await run(['--dir', dir]);
    writeFileSync(join(dir, 'keep'), 'x');
    assert.equal((await run(['--dir', dir, '--uninstall'])).status, 0);
    assert.deepEqual(readdirSync(dir), ['keep']);
    assert.equal((await run(['--dir', dir, '--uninstall'])).status, 0);
  });

  it('prints the PATH line only when the dir is not on PATH', async () => {
    const off = await run(['--dir', fresh('bin-off')]);
    assert.match(off.stdout, /export PATH="[^"]*bin-off:\$PATH"/);
    const dir = fresh('bin-on');
    const on = await run(['--dir', dir], { env: { PATH: `${dir}:${stubs}:${process.env.PATH}` } });
    assert.doesNotMatch(on.stdout, /export PATH/);
  });

  it('--dir defaults to FACTORY_INSTALL_DIR, then HOME/.local/bin', async () => {
    const viaEnv = fresh('bin-env');
    assert.equal((await run([], { env: { FACTORY_INSTALL_DIR: viaEnv } })).status, 0);
    assert.ok(existsSync(join(viaEnv, 'factory')));
    const home = fresh('home-default');
    assert.equal((await run([], { home })).status, 0);
    assert.ok(existsSync(join(home, '.local/bin/factory')));
  });

  it('an unknown arch or os exits 2 and names the platform', async () => {
    const arch = await run(['--dir', fresh('bin-x')], { arch: 'riscv64' });
    assert.equal(arch.status, 2);
    assert.match(arch.stderr, /processor/);
    assert.equal((await run(['--dir', fresh('bin-x')], { os: 'FreeBSD' })).status, 2);
    assert.equal(existsSync(fresh('bin-x')), false);
  });

  it('is POSIX sh text with the exact checksum line and no em dashes', async () => {
    const text = readFileSync(installSh, 'utf8');
    assert.ok(text.includes('[ "$got" = "$want" ] || die "checksum mismatch for $asset"'));
    assert.ok(text.startsWith('#!/bin/sh'));
    assert.doesNotMatch(text, /\u2014/);
  });
});

describe('site', () => {
  const dockerfile = readFileSync(join(root, 'site/Dockerfile'), 'utf8');
  const conf = readFileSync(join(root, 'site/nginx.conf'), 'utf8');

  it('the Dockerfile is nginx:1.27-alpine and serves only the repo install.sh', async () => {
    assert.match(dockerfile, /^FROM nginx:1\.27-alpine$/m);
    const copies = dockerfile.split('\n').filter((l) => l.startsWith('COPY '));
    const intoHtml = copies.filter((l) => l.includes('/usr/share/nginx/html'));
    assert.deepEqual(intoHtml, ['COPY install.sh /usr/share/nginx/html/install.sh']);
    assert.deepEqual(copies.filter((l) => !intoHtml.includes(l)), ['COPY site/nginx.conf /etc/nginx/conf.d/default.conf']);
  });

  it('nginx serves install.sh at / and /install.sh as text/plain, plus /healthz', async () => {
    assert.match(conf, /location = \/ \{/);
    assert.match(conf, /location = \/install\.sh \{/);
    assert.match(conf, /location = \/healthz \{/);
    assert.equal((conf.match(/default_type text\/plain;/g) ?? []).length, 3);
  });
});
