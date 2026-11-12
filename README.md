# factory-install

Installers for [KaaS Factory](https://github.com/KaaS-team/KaaS-factory): a POSIX `install.sh` and an npm launcher.

**Status:** `install.sh` and the Homebrew template read the goreleaser release layout: `factory_<os>_<arch>.tar.gz` archives (os `linux` or `darwin`, arch `amd64` or `arm64`) and `checksums.txt`. They are tested against a local fake release server. The npm launcher and `scripts/fetch-release.mjs` still read the older raw binary names and `SHA256SUMS`; they are not changed here.

## Install

```sh
curl -fsSL https://factory.kaas.team/install.sh | sh
```

`factory.kaas.team` is not live yet. Until it is, run `install.sh` from this repo.

| Flag | Effect |
|---|---|
| `--version <tag>` | Install a release such as `v6.2.0`. Default: latest. |
| `--dir <path>` | Where to put the binary. Default: `$HOME/.local/bin`. |
| `--uninstall` | Remove `<dir>/factory` and nothing else. |
| `--help` | Show usage. |

Set `FACTORY_INSTALL_DIR` to change the default dir and `FACTORY_DOWNLOAD_BASE` to read releases from another place. The script downloads the archive for your system and `checksums.txt`, checks the archive's sha256 (`sha256sum` or `shasum`), refuses on a mismatch, unpacks the `factory` binary and then moves it into place. A second run with the same binary says `already installed`.

Or with npm or Homebrew (after the first publish):

```sh
npm i -g @kaas-team/factory
brew install KaaS-team/tap/factory
```

The npm package is a launcher that runs the platform package for your machine. All three installers put the same binary on disk, and `publish.yml` checks that on every release.

`scripts/release/publish.yml` is the publish workflow. Copy it to `.github/workflows/publish.yml` by hand.

## Develop

```sh
make check
```

## Part of KaaS

More at [kaas.team](https://kaas.team). Licensed Apache-2.0.
