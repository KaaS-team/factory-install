import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSums } from './fetch-release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PLATFORMS } = createRequire(import.meta.url)('../npm/factory/bin/factory.js');

const writeJson = (file, obj) => writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);

export function pack({ assets, out, version }) {
  const ver = String(version).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(ver)) throw new Error(`bad version ${version}, want x.y.z`);

  const sums = readSums(readFileSync(join(assets, 'SHA256SUMS'), 'utf8'));
  const checked = PLATFORMS.map((pair) => {
    const asset = `factory-${pair}`;
    const want = sums.get(asset);
    if (!want || !existsSync(join(assets, asset))) throw new Error(`no checksum listed for ${asset}`);
    const got = createHash('sha256').update(readFileSync(join(assets, asset))).digest('hex');
    if (got !== want) throw new Error(`checksum mismatch for ${asset}`);
    return { pair, asset, want };
  });

  const template = JSON.parse(readFileSync(join(root, 'npm/platform.package.json'), 'utf8'));
  const license = join(root, 'LICENSE');
  const dirs = [];
  for (const { pair, asset, want } of checked) {
    const [os, cpu] = pair.split('-');
    const dir = join(out, asset);
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeJson(join(dir, 'package.json'), {
      name: `@kaas-team/factory-${pair}`,
      version: ver,
      ...template,
      os: [os],
      cpu: [cpu],
      factorySha256: want,
    });
    copyFileSync(join(assets, asset), join(dir, 'bin', 'factory'));
    chmodSync(join(dir, 'bin', 'factory'), 0o755);
    copyFileSync(license, join(dir, 'LICENSE'));
    dirs.push(dir);
  }

  const wrapper = join(out, 'factory');
  mkdirSync(join(wrapper, 'bin'), { recursive: true });
  copyFileSync(join(root, 'npm/factory/bin/factory.js'), join(wrapper, 'bin', 'factory.js'));
  chmodSync(join(wrapper, 'bin', 'factory.js'), 0o755);
  copyFileSync(join(root, 'npm/factory/README.md'), join(wrapper, 'README.md'));
  copyFileSync(license, join(wrapper, 'LICENSE'));
  const pkg = JSON.parse(readFileSync(join(root, 'npm/factory/package.json'), 'utf8'));
  pkg.version = ver;
  pkg.optionalDependencies = Object.fromEntries(PLATFORMS.map((p) => [`@kaas-team/factory-${p}`, ver]));
  writeJson(join(wrapper, 'package.json'), pkg);
  dirs.push(wrapper);
  return dirs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let opts;
    if (args[0]?.startsWith('--')) {
      // legacy flag form, still used by .github/workflows/npm-publish.yml
      const o = {};
      for (let i = 0; i < args.length; i += 2) o[args[i]] = args[i + 1];
      for (const f of ['--assets', '--out', '--version']) if (!o[f]) throw new Error(`missing ${f}`);
      opts = { assets: o['--assets'], out: o['--out'], version: o['--version'] };
    } else {
      const [tag, dir] = args;
      if (!tag || !dir) throw new Error('usage: npm-pack.mjs <tag> <dir>');
      opts = { assets: dir, out: join(dir, 'packages'), version: tag };
    }
    for (const d of pack(opts)) console.log(d);
  } catch (err) {
    console.error(`npm-pack: ${err.message}`);
    process.exit(1);
  }
}
