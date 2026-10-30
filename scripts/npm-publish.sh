#!/bin/sh
# Publishes the packages written by scripts/npm-pack.mjs: the four platform packages first,
# the wrapper last. Auth comes from the caller's npm config.
#   scripts/npm-publish.sh <out-dir> [npm publish flags...]
set -eu

[ $# -ge 1 ] || { echo "usage: npm-publish.sh <out-dir> [npm publish flags...]" >&2; exit 2; }
out=$1
shift

n=0
for d in "$out"/factory-*-*/; do
  [ -d "$d" ] && n=$((n + 1))
done
[ "$n" -eq 4 ] || { echo "npm-publish: expected 4 platform packages in $out, found $n" >&2; exit 1; }
[ -f "$out/factory/package.json" ] || { echo "npm-publish: $out/factory/package.json is missing" >&2; exit 1; }

for d in "$out"/factory-*-*/; do
  npm publish "${d%/}" --access public "$@"
done
npm publish "$out/factory" --access public "$@"
