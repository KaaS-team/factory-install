#!/bin/sh
# Fails unless every given binary hashes to the SHA256SUMS line for the asset.
#   scripts/same-sha.sh <asset> <SHA256SUMS> <binary>...
set -eu

[ $# -ge 3 ] || { echo "usage: same-sha.sh <asset> <SHA256SUMS> <binary>..." >&2; exit 2; }
asset=$1
sums=$2
shift 2

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d ' ' -f 1; }
else
  sha() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
fi

want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$sums")
[ -n "$want" ] || { echo "same-sha: no checksum listed for $asset" >&2; exit 1; }

status=0
for bin in "$@"; do
  if [ ! -f "$bin" ]; then
    echo "same-sha: $bin is missing" >&2
    status=1
    continue
  fi
  got=$(sha "$bin")
  if [ "$got" = "$want" ]; then
    echo "ok $got $bin"
  else
    echo "same-sha: $bin is $got, want $want" >&2
    status=1
  fi
done
exit $status
