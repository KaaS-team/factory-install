#!/bin/sh
# Installs the factory CLI.
#   curl -fsSL https://factory.kaas.team/install.sh | sh
#   curl -fsSL https://factory.kaas.team/install.sh | sh -s -- --version v6.2.0
set -eu

DIR=""
VERSION=""
UNINSTALL=0

usage() {
  cat <<'EOF'
Usage: install.sh [--version <tag>] [--dir <path>] [--uninstall] [--help]

  --version <tag>  install a release, for example v6.2.0 or 6.2.0 (default: latest)
  --dir <path>     where to put the factory binary (default: $HOME/.local/bin)
  --uninstall      remove <dir>/factory and nothing else
  --help           show this text

Set FACTORY_INSTALL_DIR to change the default dir and FACTORY_DOWNLOAD_BASE to read
releases from another place.
EOF
}

say() { printf '%s\n' "$*"; }
die() { printf 'factory install: %s\n' "$*" >&2; exit 1; }
usage_die() { printf 'factory install: %s\n' "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case $1 in
    --version) [ $# -ge 2 ] || usage_die "--version needs a tag"; VERSION=$2; shift 2 ;;
    --dir) [ $# -ge 2 ] || usage_die "--dir needs a path"; DIR=$2; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    --help | -h) usage; exit 0 ;;
    *) usage >&2; usage_die "unknown option: $1" ;;
  esac
done

if [ -z "$DIR" ]; then
  if [ -n "${FACTORY_INSTALL_DIR:-}" ]; then
    DIR=$FACTORY_INSTALL_DIR
  else
    [ -n "${HOME:-}" ] || usage_die "cannot find a home directory, pass --dir"
    DIR=${HOME}/.local/bin
  fi
fi

if [ "$UNINSTALL" = 1 ]; then
  rm -f "${DIR:?}/factory"
  say "Removed ${DIR}/factory"
  exit 0
fi

case $(uname -s) in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) usage_die "this system is not supported, only macOS and Linux" ;;
esac
case $(uname -m) in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) usage_die "this processor is not supported, only amd64 and arm64" ;;
esac
asset="factory_${os}_${arch}.tar.gz"

root=${FACTORY_DOWNLOAD_BASE:-https://github.com/KaaS-team/factory/releases}
root=${root%/}
if [ -n "$VERSION" ]; then
  tag=v${VERSION#v}
  base="${root}/download/${tag}"
else
  tag=""
  base="${root}/latest/download"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  die "need sha256sum or shasum to check the download"
fi

mkdir -p "$DIR"
work="${DIR}/.factory.tmp.$$"
trap 'rm -rf "${work:?}"' EXIT INT TERM
mkdir "$work"
sums="${work}/checksums.txt"

curl -fsSL "${base}/checksums.txt" -o "$sums" || die "could not download the checksum list"
want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$sums")
[ -n "$want" ] || die "no checksum listed for ${asset}"

curl -fsSL "${base}/${asset}" -o "${work}/${asset}" || die "could not download ${asset}"
got=$(sha "${work}/${asset}")
[ "$got" = "$want" ] || die "checksum mismatch for $asset"

mkdir "${work}/x"
tar -xzf "${work}/${asset}" -C "${work}/x" factory 2>/dev/null || die "${asset} does not contain a factory binary"
staged="${work}/x/factory"
[ -f "$staged" ] || die "${asset} does not contain a factory binary"

if [ -f "${DIR}/factory" ] && [ "$(sha "${DIR}/factory")" = "$(sha "$staged")" ]; then
  label=$tag
  [ -n "$label" ] || label=$("${DIR}/factory" --version 2>/dev/null | awk '{ print $2; exit }')
  say "factory ${label:-latest} is already installed"
  exit 0
fi

chmod 755 "$staged"
mv -f "$staged" "${DIR}/factory"
say "Installed ${DIR}/factory"

case ":${PATH}:" in
  *":${DIR}:"*) ;;
  *) say "Add it to your PATH:  export PATH=\"${DIR}:\$PATH\"" ;;
esac
