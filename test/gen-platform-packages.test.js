'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { generate, PLATFORMS } = require(path.join(ROOT, 'scripts', 'gen-platform-packages.js'));

const PLATFORM_FILES = PLATFORMS.map((p) => path.join('npm', `factory-${p.os}-${p.cpu}`, 'package.json'));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'factory-gen-'));
}

// A temp repo root with the real root package.json and template, so a test
// can change the version without touching the checked-in files.
function fakeRepo() {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'npm'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
  fs.copyFileSync(
    path.join(ROOT, 'npm', 'platform.package.json.tmpl'),
    path.join(root, 'npm', 'platform.package.json.tmpl'),
  );
  return root;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function allVersions(root) {
  return [
    readJson(path.join(root, 'package.json')).version,
    ...PLATFORM_FILES.map((f) => readJson(path.join(root, f)).version),
  ];
}

test('all five package.json files carry one identical version', () => {
  const root = fakeRepo();

  generate({ root, out: root });

  const versions = allVersions(root);
  assert.equal(versions.length, 5);
  assert.equal(new Set(versions).size, 1, `versions differ: ${versions.join(', ')}`);
});

test('a root version bump moves all five package.json files together', () => {
  const root = fakeRepo();
  const pkgFile = path.join(root, 'package.json');
  const pkg = readJson(pkgFile);
  pkg.version = '9.9.9-test';
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

  generate({ root, out: root });

  assert.deepEqual(allVersions(root), ['9.9.9-test', '9.9.9-test', '9.9.9-test', '9.9.9-test', '9.9.9-test']);
});

test('generated platform packages carry the right name, os, cpu and version', () => {
  const root = fakeRepo();

  generate({ root, out: root });

  for (const p of PLATFORMS) {
    const json = readJson(path.join(root, 'npm', `factory-${p.os}-${p.cpu}`, 'package.json'));
    assert.equal(json.name, `@kaas-team/factory-${p.os}-${p.cpu}`);
    assert.deepEqual(json.os, [p.os]);
    assert.deepEqual(json.cpu, [p.cpu]);
  }
});

test('the root optionalDependencies pin the same version as the platform packages', () => {
  const root = fakeRepo();

  generate({ root, out: root });

  const pkg = readJson(path.join(root, 'package.json'));
  for (const p of PLATFORMS) {
    assert.equal(pkg.optionalDependencies[`@kaas-team/factory-${p.os}-${p.cpu}`], pkg.version);
  }
});

test('the committed npm/ packages match what the generator writes', () => {
  const out = tempDir();

  generate({ root: ROOT, out });

  for (const f of ['package.json', ...PLATFORM_FILES]) {
    assert.equal(
      fs.readFileSync(path.join(out, f), 'utf8'),
      fs.readFileSync(path.join(ROOT, f), 'utf8'),
      `${f} is stale: run node scripts/gen-platform-packages.js`,
    );
  }
});
