#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PLATFORMS = [
  { os: 'darwin', cpu: 'arm64' },
  { os: 'darwin', cpu: 'x64' },
  { os: 'linux', cpu: 'x64' },
  { os: 'linux', cpu: 'arm64' },
];

const REPO_ROOT = path.join(__dirname, '..');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// Reads the version from root/package.json, writes npm/factory-<os>-<cpu>/package.json
// for each platform from root/npm/platform.package.json.tmpl, and pins the root's
// optionalDependencies to that version. Writes everything under out.
function generate({ root = REPO_ROOT, out = root } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const template = fs.readFileSync(path.join(root, 'npm', 'platform.package.json.tmpl'), 'utf8');

  pkg.optionalDependencies = {};
  for (const { os, cpu } of PLATFORMS) {
    const text = template
      .replaceAll('__OS__', os)
      .replaceAll('__CPU__', cpu)
      .replaceAll('__VERSION__', pkg.version);
    writeJson(path.join(out, 'npm', `factory-${os}-${cpu}`, 'package.json'), JSON.parse(text));
    pkg.optionalDependencies[`@kaas-team/factory-${os}-${cpu}`] = pkg.version;
  }

  writeJson(path.join(out, 'package.json'), pkg);
}

if (require.main === module) {
  generate();
}

module.exports = { generate, PLATFORMS };
