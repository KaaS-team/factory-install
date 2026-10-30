#!/usr/bin/env node
'use strict';
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const INSTALL_LINE = 'curl -fsSL https://factory.kaas.team/install.sh | sh';
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];

function platformPackage(platform, arch) {
  const pair = `${platform}-${arch}`;
  return PLATFORMS.includes(pair) ? `@kaas-team/factory-${pair}` : null;
}

function resolveBinary({ platform, arch, baseDir }) {
  const name = platformPackage(platform, arch);
  if (!name) return { ok: false, reason: `no npm build for ${platform}-${arch}` };
  let manifest;
  try {
    manifest = require.resolve(`${name}/package.json`, { paths: [baseDir] });
  } catch (err) {
    return {
      ok: false,
      reason: `${name} is not installed (saw ${platform}-${arch}); reinstall without --omit=optional`,
    };
  }
  const dir = path.dirname(manifest);
  let want;
  let got;
  const bin = path.join(dir, 'bin', 'factory');
  try {
    want = JSON.parse(fs.readFileSync(manifest, 'utf8')).factorySha256;
    got = crypto.createHash('sha256').update(fs.readFileSync(bin)).digest('hex');
  } catch (err) {
    return { ok: false, reason: `cannot read ${name}: ${err.message}` };
  }
  if (got !== want) return { ok: false, reason: `checksum mismatch for ${name}, not running it` };
  return { ok: true, bin, name };
}

function main(argv, { platform = process.platform, arch = process.arch, baseDir = __dirname } = {}) {
  const res = resolveBinary({ platform, arch, baseDir });
  if (!res.ok) {
    process.stderr.write(`factory: ${res.reason}\nInstall with:\n  ${INSTALL_LINE}\n`);
    process.exitCode = 1;
    return;
  }
  const child = spawn(res.bin, argv, { stdio: 'inherit' });
  const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((sig) => [sig, () => child.kill(sig)]);
  for (const [sig, h] of handlers) process.on(sig, h);
  child.on('error', (err) => {
    for (const [sig, h] of handlers) process.removeListener(sig, h);
    process.stderr.write(`factory: could not start ${res.bin}: ${err.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    for (const [sig, h] of handlers) process.removeListener(sig, h);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code;
  });
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { INSTALL_LINE, PLATFORMS, platformPackage, resolveBinary, main };
