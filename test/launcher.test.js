'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isBuiltin } = require('node:module');

const ROOT = path.join(__dirname, '..');
const LAUNCHER = path.join(ROOT, 'bin', 'factory.js');
const { platformPackage, run, INSTALL_HINT } = require(LAUNCHER);

const HOST_PACKAGE = platformPackage(process.platform, process.arch);
const HOST_SKIP = HOST_PACKAGE ? false : `host ${process.platform}-${process.arch} has no platform package`;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'factory-launcher-'));
}

function writeFile(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (mode) fs.chmodSync(file, mode);
}

// A fake platform package: its bin/factory is a shell script, so the test
// exercises the real spawn path without any binary being committed.
function fakePlatformPackage(nodeModules, name, script) {
  const dir = path.join(nodeModules, ...name.split('/'));
  writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0' }));
  writeFile(path.join(dir, 'bin', 'factory'), script, 0o755);
}

// Copies the launcher into a temp dir, so its require paths resolve to a
// node_modules the test controls instead of the repo's.
function launcherCopy(dir) {
  const file = path.join(dir, 'bin', 'factory.js');
  writeFile(file, fs.readFileSync(LAUNCHER, 'utf8'));
  return file;
}

function captureStderr() {
  const chunks = [];
  return { stream: { write: (text) => chunks.push(text) }, text: () => chunks.join('') };
}

test('platformPackage maps each supported platform to its package', () => {
  assert.equal(platformPackage('darwin', 'arm64'), '@kaas-team/factory-darwin-arm64');
  assert.equal(platformPackage('darwin', 'x64'), '@kaas-team/factory-darwin-x64');
  assert.equal(platformPackage('linux', 'x64'), '@kaas-team/factory-linux-x64');
  assert.equal(platformPackage('linux', 'arm64'), '@kaas-team/factory-linux-arm64');
});

test('platformPackage returns null for unsupported platforms', () => {
  assert.equal(platformPackage('win32', 'x64'), null);
  assert.equal(platformPackage('linux', 'ia32'), null);
  assert.equal(platformPackage('freebsd', 'x64'), null);
});

test('package.json has the bin entry, no dependencies, and the four optionalDependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@kaas-team/factory');
  assert.deepEqual(pkg.bin, { factory: 'bin/factory.js' });
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(Object.keys(pkg.optionalDependencies).sort(), [
    '@kaas-team/factory-darwin-arm64',
    '@kaas-team/factory-darwin-x64',
    '@kaas-team/factory-linux-arm64',
    '@kaas-team/factory-linux-x64',
  ]);
});

test('launcher starts with a node shebang and requires only Node built-ins', () => {
  const src = fs.readFileSync(LAUNCHER, 'utf8');
  assert.ok(src.startsWith('#!/usr/bin/env node\n'));
  const ids = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(isBuiltin(id), `${id} is not a Node built-in`);
});

test('runs the platform binary with the same arguments and exit code', { skip: HOST_SKIP }, () => {
  const dir = tempDir();
  const launcher = launcherCopy(dir);
  fakePlatformPackage(
    path.join(dir, 'node_modules'),
    HOST_PACKAGE,
    ['#!/bin/sh', 'for a in "$@"; do printf "%s\\n" "$a"; done', 'exit 7', ''].join('\n'),
  );

  const r = spawnSync(process.execPath, [launcher, '--flag', 'a b', 'c'], { encoding: 'utf8' });

  assert.equal(r.stdout, '--flag\na b\nc\n');
  assert.equal(r.status, 7);
});

test('re-sends a signal the platform binary died from', { skip: HOST_SKIP }, () => {
  const dir = tempDir();
  const launcher = launcherCopy(dir);
  fakePlatformPackage(path.join(dir, 'node_modules'), HOST_PACKAGE, '#!/bin/sh\nkill -TERM $$\n');

  const r = spawnSync(process.execPath, [launcher], { encoding: 'utf8' });

  assert.equal(r.signal, 'SIGTERM');
});

test('unsupported platform prints the platform and the install line, then exits 1', async () => {
  const stderr = captureStderr();

  const r = await run([], { platform: 'win32', arch: 'x64', stderr: stderr.stream });

  assert.equal(r.code, 1);
  assert.match(stderr.text(), /win32-x64/);
  assert.ok(stderr.text().includes(INSTALL_HINT));
});

test('supported platform with its package missing prints the message, then exits 1', async () => {
  const stderr = captureStderr();

  const r = await run([], { platform: 'linux', arch: 'x64', baseDir: tempDir(), stderr: stderr.stream });

  assert.equal(r.code, 1);
  assert.match(stderr.text(), /linux-x64/);
  assert.match(stderr.text(), /@kaas-team\/factory-linux-x64/);
  assert.ok(stderr.text().includes(INSTALL_HINT));
});

test('install hint is the install.sh one-liner', () => {
  assert.match(INSTALL_HINT, /install\.sh/);
});
