# factory-install

Installers for [KaaS Factory](https://github.com/KaaS-team/KaaS-factory): a POSIX `install.sh` and an npm launcher.

**Status:** the installers are built and tested against a fake release server. They cannot install a real build until a KaaS Factory release carries binaries; v6.1.1 has none. Both then work without changes.

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

Set `FACTORY_INSTALL_BASE_URL` to read release files from another place. The script checks the download against `SHA256SUMS` before it moves the binary into place.

Or with npm (after the first publish):

```sh
npm i -g @kaas-team/factory
```

The package is a launcher that fetches the platform binary.

## Develop

```sh
make check
```

## Part of KaaS

More at [kaas.team](https://kaas.team). Licensed Apache-2.0.
