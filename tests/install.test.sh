#!/bin/sh
# Runs install.sh against a local fake release server, for all four platforms.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
WORK=$(mktemp -d)
pass=0
fail=0
srv=""

cleanup() {
  [ -z "$srv" ] || kill "$srv" 2>/dev/null || true
  rm -rf "${WORK:?}"
}
trap cleanup EXIT INT TERM

ok() { pass=$((pass + 1)); printf 'ok %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n' "$1"; }
check() { if "$@"; then ok "$DESC"; else bad "$DESC"; fi; }
has() { grep -q "$1" "$2"; }

mkdir -p "$WORK/bin" "$WORK/rel"
cat > "$WORK/bin/uname" <<'EOF'
#!/bin/sh
case "$1" in -s) echo "$STUB_OS" ;; -m) echo "$STUB_ARCH" ;; esac
EOF
chmod +x "$WORK/bin/uname"

for pair in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  printf '#!/bin/sh\necho served-%s\n' "$pair" > "$WORK/rel/factory-$pair"
done
(cd "$WORK/rel" && for f in factory-*; do
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f"; else shasum -a 256 "$f"; fi
done > SHA256SUMS)

port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$WORK/rel" >/dev/null 2>&1 &
srv=$!
i=0
while ! curl -fs "http://127.0.0.1:$port/SHA256SUMS" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -lt 50 ] || { echo "fake server did not start"; exit 1; }
  sleep 0.1
done

# install <os> <arch> <home> [args...]: runs the installer with the stubbed platform
install() {
  os=$1; arch=$2; home=$3; shift 3
  STUB_OS=$os STUB_ARCH=$arch HOME=$home PATH="$WORK/bin:$PATH" \
    FACTORY_INSTALL_BASE_URL="http://127.0.0.1:$port" sh "$ROOT/install.sh" "$@"
}

for pair in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  os=${pair%-*}; arch=${pair#*-}
  case $os-$arch in darwin-arm64) u=Darwin m=arm64 ;; darwin-x64) u=Darwin m=x86_64 ;;
    linux-arm64) u=Linux m=aarch64 ;; linux-x64) u=Linux m=x86_64 ;; esac
  home="$WORK/home-$pair"
  install "$u" "$m" "$home" >"$WORK/out" 2>&1
  DESC="$pair installs"; check test -f "$home/.local/bin/factory"
  DESC="$pair is executable"; check test -x "$home/.local/bin/factory"
  DESC="$pair serves the right bytes"; check test "$("$home/.local/bin/factory")" = "served-$pair"
  DESC="$pair leaves no staged file"; check test -z "$(find "$home/.local/bin" -name '.factory.new.*')"
  DESC="$pair prints a PATH hint"; check has "export PATH" "$WORK/out"
  install "$u" "$m" "$home" >/dev/null 2>&1
  DESC="$pair runs twice"; check test "$("$home/.local/bin/factory")" = "served-$pair"
done

# a bad checksum installs nothing and keeps the old binary
home="$WORK/home-bad"; mkdir -p "$home/.local/bin"
printf '#!/bin/sh\necho old\n' > "$home/.local/bin/factory"; chmod +x "$home/.local/bin/factory"
cp "$WORK/rel/SHA256SUMS" "$WORK/rel/SHA256SUMS.good"
sed 's/^[0-9a-f]\{8\}/00000000/' "$WORK/rel/SHA256SUMS.good" > "$WORK/rel/SHA256SUMS"
install Linux x86_64 "$home" >"$WORK/out" 2>&1; code=$?
DESC="bad checksum exits 1"; check test "$code" = 1
DESC="bad checksum says so"; check has "checksum mismatch" "$WORK/out"
DESC="bad checksum keeps the old binary"; check test "$("$home/.local/bin/factory")" = old
mv -f "$WORK/rel/SHA256SUMS.good" "$WORK/rel/SHA256SUMS"

# --dir
install Linux x86_64 "$WORK/home-dir" --dir "$WORK/custom" >/dev/null 2>&1
DESC="--dir installs there"; check test -x "$WORK/custom/factory"

# --uninstall removes only factory
touch "$WORK/custom/keep"
install Linux x86_64 "$WORK/home-dir" --dir "$WORK/custom" --uninstall >/dev/null 2>&1
DESC="--uninstall removes the binary"; check test ! -e "$WORK/custom/factory"
DESC="--uninstall keeps other files"; check test -e "$WORK/custom/keep"
install Linux x86_64 "$WORK/home-dir" --dir "$WORK/custom" --uninstall >/dev/null 2>&1; code=$?
DESC="--uninstall twice is fine"; check test "$code" = 0

# --version builds the release URL (curl stub records it)
cat > "$WORK/bin/curl" <<'EOF'
#!/bin/sh
echo "$@" >> "$CURL_LOG"
exit 22
EOF
chmod +x "$WORK/bin/curl"
for v in v6.2.0 6.2.0; do
  : > "$WORK/curl.log"
  STUB_OS=Linux STUB_ARCH=x86_64 HOME="$WORK/h" PATH="$WORK/bin:$PATH" CURL_LOG="$WORK/curl.log" \
    sh "$ROOT/install.sh" --version "$v" >/dev/null 2>&1
  DESC="--version $v reads the v6.2.0 release"; check has "releases/download/v6.2.0/" "$WORK/curl.log"
done
: > "$WORK/curl.log"
STUB_OS=Linux STUB_ARCH=x86_64 HOME="$WORK/h" PATH="$WORK/bin:$PATH" CURL_LOG="$WORK/curl.log" \
  sh "$ROOT/install.sh" >/dev/null 2>&1
DESC="no version reads the latest release"; check has "releases/latest/download/" "$WORK/curl.log"
rm -f "$WORK/bin/curl"

# unsupported platforms
STUB_OS=FreeBSD STUB_ARCH=x86_64 HOME="$WORK/h" PATH="$WORK/bin:$PATH" sh "$ROOT/install.sh" >/dev/null 2>&1; code=$?
DESC="unsupported os exits 2"; check test "$code" = 2
STUB_OS=Linux STUB_ARCH=riscv64 HOME="$WORK/h" PATH="$WORK/bin:$PATH" sh "$ROOT/install.sh" >/dev/null 2>&1; code=$?
DESC="unsupported arch exits 2"; check test "$code" = 2

sh "$ROOT/install.sh" --help >/dev/null 2>&1; code=$?
DESC="--help works"; check test "$code" = 0

DESC="no em dashes"; check test -z "$(grep -l "$(printf '\342\200\224')" install.sh tests/install.test.sh)"

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
