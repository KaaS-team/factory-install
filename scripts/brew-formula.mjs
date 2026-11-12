// Renders Formula/factory.rb from homebrew/factory.rb.tmpl and a verified checksums.txt.
//   node scripts/brew-formula.mjs <tag> <checksums.txt> [out]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, readSums } from './fetch-release.mjs';

const PAIRS = ['darwin-arm64', 'darwin-amd64', 'linux-arm64', 'linux-amd64'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function renderFormula({ tag, sumsText, template }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error(`bad tag ${tag}, want vX.Y.Z`);
  const sums = readSums(sumsText);
  let out = template.replaceAll('@@VERSION@@', tag.slice(1));
  for (const pair of PAIRS) {
    const asset = `factory_${pair.replace('-', '_')}.tar.gz`;
    const key = pair.toUpperCase().replace('-', '_');
    const sha = sums.get(asset);
    if (!sha) throw new Error(`no checksum listed for ${asset}`);
    out = out
      .replaceAll(`@@URL_${key}@@`, `https://github.com/${REPO}/releases/download/${tag}/${asset}`)
      .replaceAll(`@@SHA_${key}@@`, sha);
  }
  if (out.includes('@@')) throw new Error('unfilled placeholder in the formula');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [tag, sumsFile, outFile = 'Formula/factory.rb'] = process.argv.slice(2);
    if (!tag || !sumsFile) throw new Error('usage: brew-formula.mjs <tag> <checksums.txt> [out]');
    const text = renderFormula({
      tag,
      sumsText: readFileSync(sumsFile, 'utf8'),
      template: readFileSync(join(root, 'homebrew/factory.rb.tmpl'), 'utf8'),
    });
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, text);
    console.log(outFile);
  } catch (err) {
    console.error(`brew-formula: ${err.message}`);
    process.exit(1);
  }
}
