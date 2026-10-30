import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function fakeBinary(pair) {
  return `#!/bin/sh
echo "fake ${pair}"
for a in "$@"; do echo "[$a]"; done
if [ -n "\${FAKE_MARK:-}" ]; then touch "$FAKE_MARK"; fi
if [ -n "\${FAKE_SLEEP:-}" ]; then
  trap 'echo "got TERM"; kill "$pid" 2>/dev/null; exit 143' TERM
  sleep 30 &
  pid=$!
  wait "$pid"
fi
exit "\${FAKE_EXIT:-0}"
`;
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function writePlatformPackage(dir, pair, { sha } = {}) {
  const [os, cpu] = pair.split('-');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  const bin = join(dir, 'bin', 'factory');
  writeFileSync(bin, fakeBinary(pair));
  chmodSync(bin, 0o755);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      { name: `@kaas-team/factory-${pair}`, version: '9.9.9', os: [os], cpu: [cpu], factorySha256: sha ?? sha256(bin) },
      null,
      2,
    ),
  );
}
