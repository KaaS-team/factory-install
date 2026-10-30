#!/bin/sh
# Installs the factory CLI.
#   curl -fsSL https://factory.kaas.team/install.sh | sh
#   curl -fsSL https://factory.kaas.team/install.sh | sh -s -- --version v6.2.0
set -eu

REPO="${FACTORY_REPO:-KaaS-team/KaaS-factory}"
DIR="${HOME:-}/.local/bin"
VERSION=""
UNINSTALL=0

usage() {
  cat <<'EOF'
Usage: install.sh [--version <tag>] [--dir <path>] [--uninstall] [--help]

  --version <tag>  install a release, for example v6.2.0 or 6.2.0 (default: latest)
  --dir <path>     where to put the factory binary (default: $HOME/.local/bin)
  --uninstall      remove <dir>/factory and nothing else
  --help           show this text

Set FACTORY_INSTALL_BASE_URL to read the release files from another place.
EOF
}

say() { printf '%s\n' "$*"; }
die() { code=$1; shift; printf 'factory install: %s\n' "$*" >&2; exit "$code"; }

while [ $# -gt 0 ]; do
  case $1 in
    --version) [ $# -ge 2 ] || die 2 "--version needs a tag"; VERSION=$2; shift 2 ;;
    --dir) [ $# -ge 2 ] || die 2 "--dir needs a path"; DIR=$2; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    --help | -h) usage; exit 0 ;;
    *) usage >&2; die 2 "unknown option: $1" ;;
  esac
done

[ -n "$DIR" ] && [ "$DIR" != "/.local/bin" ] || die 2 "cannot find a home directory, pass --dir"

if [ "$UNINSTALL" = 1 ]; then
  rm -f "${DIR:?}/factory"
  say "Removed ${DIR}/factory"
  exit 0
fi

case $(uname -s) in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die 2 "this system is not supported, only macOS and Linux" ;;
esac
case $(uname -m) in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die 2 "this processor is not supported, only x64 and arm64" ;;
esac
file="factory-${os}-${arch}"

if [ -n "${FACTORY_INSTALL_BASE_URL:-}" ]; then
  base=${FACTORY_INSTALL_BASE_URL%/}
elif [ -n "$VERSION" ]; then
  tag=v${VERSION#v}
  base="https://github.com/${REPO}/releases/download/${tag}"
else
  base="https://github.com/${REPO}/releases/latest/download"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  die 1 "need sha256sum or shasum to check the download"
fi

tmp=$(mktemp -d)
trap 'rm -rf "${tmp:?}"' EXIT INT TERM

curl -fsSL "${base}/SHA256SUMS" -o "${tmp}/SHA256SUMS" || die 1 "could not download the checksum list"
curl -fsSL "${base}/${file}" -o "${tmp}/${file}" || die 1 "could not download ${file}"

want=$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1; exit }' "${tmp}/SHA256SUMS")
[ -n "$want" ] || die 1 "no checksum listed for ${file}"
got=$(sha "${tmp}/${file}")
[ "$want" = "$got" ] || die 1 "checksum mismatch for ${file}, nothing was installed"

mkdir -p "$DIR"
staged="${DIR}/.factory.new.$$"
cp "${tmp}/${file}" "$staged"
chmod 755 "$staged"
mv -f "$staged" "${DIR}/factory"
say "Installed ${DIR}/factory"

case ":${PATH}:" in
  *":${DIR}:"*) ;;
  *) say "Add it to your PATH:  export PATH=\"${DIR}:\$PATH\"" ;;
esac
