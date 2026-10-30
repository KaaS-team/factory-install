import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeBinary, sha256 } from './fake-platforms.mjs';

export const PAIRS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];

export function makeAssets(dir) {
  mkdirSync(dir, { recursive: true });
  const lines = PAIRS.map((pair, i) => {
    const file = join(dir, `factory-${pair}`);
    writeFileSync(file, fakeBinary(pair));
    chmodSync(file, 0o755);
    return `${sha256(file)}${i === 1 ? ' *' : '  '}factory-${pair}`;
  });
  writeFileSync(join(dir, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}
