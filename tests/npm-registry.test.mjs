import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAssets } from './fixtures/npm-assets.mjs';
import { startRegistry } from './fixtures/registry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PLATFORMS, INSTALL_LINE } = createRequire(import.meta.url)(join(root, 'npm/factory/bin/factory.js'));
const host = `${process.platform}-${process.arch}`;

describe('npm registry stand-in', { timeout: 120000 }, () => {
  let tmp;
  let reg;
  let env;
  let prefix;
  // async on purpose: the stand-in lives in this process, so a blocking spawn would starve it
  const sh = (cmd, args, extra = {}) =>
    new Promise((resolve, reject) => {
      const c = spawn(cmd, args, { cwd: root, env: { ...env, ...extra } });
      let stdout = '';
      let stderr = '';
      c.stdout.on('data', (d) => (stdout += d));
      c.stderr.on('data', (d) => (stderr += d));
      c.on('error', reject);
      c.on('close', (status) => resolve({ status, stdout, stderr }));
    });

  before(async () => {
    assert.ok(PLATFORMS.includes(host), `host ${host} is not a supported platform`);
    tmp = mkdtempSync(join(tmpdir(), 'registry-'));
    reg = await startRegistry();
    const port = new URL(reg.url).port;
    const userconfig = join(tmp, 'userrc');
    const globalconfig = join(tmp, 'globalrc');
    writeFileSync(userconfig, `registry=${reg.url}/\n//127.0.0.1:${port}/:_authToken=stand-in\n`);
    writeFileSync(globalconfig, '');
    env = {
      PATH: process.env.PATH,
      HOME: tmp,
      npm_config_userconfig: userconfig,
      npm_config_globalconfig: globalconfig,
      npm_config_cache: join(tmp, 'cache'),
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    };
    prefix = join(tmp, 'p1');
  });
  after(async () => {
    await reg?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('(a) packs and publishes platforms first, wrapper last', async () => {
    makeAssets(join(tmp, 'assets'));
    let r = await sh(process.execPath, ['scripts/npm-pack.mjs', '--assets', join(tmp, 'assets'), '--out', join(tmp, 'out'), '--version', '9.9.9']);
    assert.equal(r.status, 0, r.stderr);
    r = await sh('sh', ['scripts/npm-publish.sh', join(tmp, 'out')]);
    assert.equal(r.status, 0, r.stderr);
    // the script publishes platform directories in glob (sorted) order, then the wrapper
    const names = PLATFORMS.map((p) => `@kaas-team/factory-${p}`);
    assert.deepEqual(reg.published, [...names.sort(), '@kaas-team/factory']);
  });

  it('(b) npm i -g installs and runs only the host binary', async () => {
    let r = await sh('npm', ['install', '-g', '--prefix', prefix, '@kaas-team/factory@9.9.9']);
    assert.equal(r.status, 0, r.stderr);
    r = await sh(join(prefix, 'bin/factory'), ['--flag', 'a b'], { FAKE_EXIT: '3' });
    assert.equal(r.status, 3, r.stderr);
    assert.equal(r.stdout, `fake ${host}\n[--flag]\n[a b]\n`);
    const scope = join(prefix, 'lib/node_modules/@kaas-team');
    const nested = join(scope, 'factory/node_modules/@kaas-team');
    const found = [scope, nested].flatMap((d) => (existsSync(d) ? readdirSync(d) : []))
      .filter((n) => n.startsWith('factory-'));
    assert.deepEqual(found, [`factory-${host}`]);
  });

  it('(c) npm exec runs the host binary', async () => {
    const r = await sh('npm', ['exec', '--yes', '--package', '@kaas-team/factory@9.9.9', '--', 'factory', '--version'], {
      npm_config_prefix: join(tmp, 'p-exec'),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^fake ${host}\\n`));
  });

  // npm 10 still installs a nested package's optionalDependencies under --omit=optional, so the
  // skip is forced with --os/--cpu, which leaves the same state: no platform package on disk.
  it('(d) an install that skipped the platform packages refuses with the install line', async () => {
    const p2 = join(tmp, 'p2');
    let r = await sh('npm', ['install', '-g', '--prefix', p2, '@kaas-team/factory@9.9.9'], { npm_config_os: 'win32', npm_config_cpu: 'x64' });
    assert.equal(r.status, 0, r.stderr);
    r = await sh(join(p2, 'bin/factory'), []);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('--omit=optional'));
    assert.ok(r.stderr.includes(INSTALL_LINE));
  });

  it('(e) a corrupted install is refused', async () => {
    const scope = join(prefix, 'lib/node_modules/@kaas-team');
    const candidates = [join(scope, `factory-${host}`), join(scope, 'factory/node_modules/@kaas-team', `factory-${host}`)];
    const dir = candidates.find((d) => existsSync(d));
    assert.ok(dir, 'installed platform package not found');
    appendFileSync(join(dir, 'bin/factory'), '\n# corrupted\n');
    const r = await sh(join(prefix, 'bin/factory'), []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /checksum mismatch/);
  });

  it('(f) every request stays on the stand-in and targets @kaas-team', () => {
    assert.ok(reg.requests.length > 0);
    for (const line of reg.requests) {
      const [method, path] = line.split(' ');
      assert.ok(['PUT', 'GET'].includes(method), line);
      assert.ok(path.startsWith('/-/') || decodeURIComponent(path).startsWith('/@kaas-team/'), line);
    }
  });

  it('(g) the publish workflow', () => {
    const y = readFileSync(join(root, '.github/workflows/npm-publish.yml'), 'utf8');
    const secrets = new Set([...y.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]));
    assert.deepEqual([...secrets], ['NPM_TOKEN']);
    assert.match(y, /--provenance/);
    assert.ok(y.indexOf('scripts/npm-pack.mjs') > -1);
    assert.ok(y.indexOf('scripts/npm-pack.mjs') < y.indexOf('scripts/npm-publish.sh'));
    const uses = [...y.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, u);
  });
});
