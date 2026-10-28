#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

// The one-liner printed when no platform package can run here.
const INSTALL_HINT = 'curl -fsSL https://raw.githubusercontent.com/KaaS-team/factory-install/main/install.sh | sh';

const SUPPORTED = new Set(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']);

// Returns the platform package name for platform/arch, or null when none exists.
function platformPackage(platform, arch) {
  if (!SUPPORTED.has(`${platform}-${arch}`)) return null;
  return `@kaas-team/factory-${platform}-${arch}`;
}

// Runs the platform package's bin/factory with the same arguments and stdio.
// Resolves to { code, signal } of the child; the caller decides how to exit.
function run(argv, { platform, arch, baseDir = __dirname, stderr = process.stderr }) {
  const where = `${platform}-${arch}`;
  const name = platformPackage(platform, arch);

  let bin = null;
  if (name) {
    try {
      bin = require.resolve(`${name}/bin/factory`, { paths: [baseDir] });
    } catch {
      bin = null;
    }
  }

  if (!bin) {
    const detail = name ? `the package ${name} is not installed` : 'there is no build for it';
    stderr.write(`factory: ${detail} (saw ${where}).\nInstall with:\n  ${INSTALL_HINT}\n`);
    return Promise.resolve({ code: 1, signal: null });
  }

  return new Promise((resolve) => {
    const child = spawn(bin, argv, { stdio: 'inherit' });
    child.on('error', (err) => {
      stderr.write(`factory: could not start ${bin}: ${err.message}\n`);
      resolve({ code: 1, signal: null });
    });
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}

if (require.main === module) {
  run(process.argv.slice(2), { platform: process.platform, arch: process.arch }).then(({ code, signal }) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code;
    }
  });
}

module.exports = { platformPackage, run, INSTALL_HINT };
