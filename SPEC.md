<!-- factory:planned v1 -->
Repo: KaaS-team/factory-install
Deps: none
Epic: e5-distribution
Milestone: phase-5
Runner: factory

## Why
`install.sh` (merged in 008d1e9) is the only way to install the factory today. Many users reach for `npx @kaas-team/factory` or `npm i -g @kaas-team/factory` first. This issue adds that path: a thin Node launcher that resolves one platform package (`@kaas-team/factory-darwin-arm64`, `-darwin-x64`, `-linux-x64`, `-linux-arm64`, listed as optionalDependencies), checks the binary's sha256 against the sha the pack step recorded from the release `SHA256SUMS`, then runs it with the same arguments, stdio, exit code and signals. One script builds all five packages from one template and one version. Publishing needs the npm org and `NPM_TOKEN`, which a human sets up, so this issue proves the whole path (pack, publish, install, run) against a local registry stand-in and never talks to the public registry. It is the npm half of T2 in the E5.2 epic (#4). The cosign check, the brew formula and the live publish stay there.

## Today
- `main` holds `install.sh` (POSIX sh, 107 lines) and `tests/install.test.sh` (121 lines, plain sh with `ok`/`FAIL` lines and a python3 `http.server` fake release). The asset names are `factory-<os>-<arch>` with `os` in `darwin|linux` and `arch` in `x64|arm64`, next to `SHA256SUMS`. A sums line is `<sha>  <file>` or `<sha> *<file>`; `install.sh:83` reads it with `awk -v f="$file" '$2 == f || $2 == "*" f { print $1; exit }'`.
- The one-liner is the comment at `install.sh:3`: `#   curl -fsSL https://factory.kaas.team/install.sh | sh`.
- `Makefile`: `check: lint test`; `lint` runs `shellcheck -s sh install.sh tests/install.test.sh` when shellcheck exists; `test` runs `sh tests/install.test.sh`. There is no `package.json`, no `.gitignore` and no Node code on `main`.
- `.github/workflows/ci.yml` runs `make check` on ubuntu-latest, Node 22 (npm 10 or later bundled), with a 3 minute timeout. `.github/**` is protected (`.factory/charter.md`), so a workflow can only be staged in the repo.
- `.factory/config.json` sets the test gate `cmd` and `fileCmd` to `make check`, so a mutation runs the whole suite. `.factory/mutate.sh` accepts only removal or flip operators (`true`, `false`, `null`, a `!` flip or a comparison swap).
- Branch `origin/factory/issue-2` (f7bd721) holds an earlier build that verify rejected in round 1. It forks from the stub `Makefile` before 008d1e9, writes to `test/` not `tests/`, and misses signal forwarding and any checksum check. Build from `main`; do not merge that branch.
- No npm org `kaas-team` exists and no `NPM_TOKEN` is set. The cloud session has neither.

## Change
### T1: The launcher package
Files: `npm/factory/package.json`, `npm/factory/bin/factory.js`, `npm/factory/README.md`, `tests/npm-launcher.test.mjs`, `tests/fixtures/fake-platforms.mjs`
Model: sonnet
1. Create `npm/factory/package.json`: `name` `@kaas-team/factory`, `description`, `license` `MIT`, `repository` `{ "type": "git", "url": "git+https://github.com/KaaS-team/factory-install.git", "directory": "npm/factory" }`, `bin` `{ "factory": "bin/factory.js" }`, `files` `["bin/", "README.md"]`, `engines` `{ "node": ">=18" }`. It has no `version`, no `dependencies` and no `optionalDependencies`: the pack step in T2 sets them, so the version exists in one place per build.
2. Create `npm/factory/bin/factory.js`: CommonJS, first line `#!/usr/bin/env node`, then `'use strict';`. It requires only `node:child_process`, `node:crypto`, `node:fs` and `node:path`.
3. Define `const INSTALL_LINE = 'curl -fsSL https://factory.kaas.team/install.sh | sh';` and `const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];`. Export `platformPackage(platform, arch)`: build `const pair = \`${platform}-${arch}\`;` and return `PLATFORMS.includes(pair) ? \`@kaas-team/factory-${pair}\` : null`.
4. Export `resolveBinary({ platform, arch, baseDir })`, returning `{ ok: true, bin, name }` or `{ ok: false, reason }`. With no name, the reason is `no npm build for ${platform}-${arch}`. Otherwise `require.resolve(\`${name}/package.json\`, { paths: [baseDir] })`; on failure the reason is `${name} is not installed (saw ${platform}-${arch}); reinstall without --omit=optional`. Then read `factorySha256` from that package.json, hash `<pkgdir>/bin/factory` with `crypto.createHash('sha256')` over `fs.readFileSync`, and write the comparison exactly as `if (got !== want) return { ok: false, reason: \`checksum mismatch for ${name}, not running it\` };`. The text `got !== want` appears once in the file. A missing `factorySha256` counts as a mismatch.
5. Export `main(argv, { platform = process.platform, arch = process.arch, baseDir = __dirname } = {})`. When `resolveBinary` fails, write `factory: ${reason}\nInstall with:\n  ${INSTALL_LINE}\n` to stderr and set `process.exitCode = 1`. Otherwise `spawn(bin, argv, { stdio: 'inherit' })`. Forward `SIGINT`, `SIGTERM` and `SIGHUP` to the child with `process.on(sig, fwd)` and remove those listeners on the child's `exit`. On exit with a signal, re-raise it with `process.kill(process.pid, signal)`; otherwise set `process.exitCode` to the child's code. On a spawn `error`, print `factory: could not start ${bin}: ${err.message}` and exit 1.
6. End with `if (require.main === module) main(process.argv.slice(2));` and `module.exports = { INSTALL_LINE, PLATFORMS, platformPackage, resolveBinary, main };`.
7. `npm/factory/README.md`: the two npm lines, the curl line, and one sentence saying the package runs the binary from the matching platform package after checking its sha256. Keep it under 15 lines.
8. `tests/fixtures/fake-platforms.mjs` exports `fakeBinary(pair)`, a POSIX sh script. It prints `fake ${pair}` and then each argument on its own line, wrapped in `[` and `]`. When `$FAKE_MARK` is set it touches that file. It traps TERM to print `got TERM` and exit 143. When `$FAKE_SLEEP` is set it waits on a background `sleep` so the trap can fire. It exits with `${FAKE_EXIT:-0}`. The fixture also exports `writePlatformPackage(dir, pair, { sha })`, which writes `package.json` (name, version `9.9.9`, `os`, `cpu`, `factorySha256` set to the real sha unless `sha` is given) and `bin/factory` (mode 755). And it exports `sha256(file)`.
9. `tests/npm-launcher.test.mjs` (`node:test`, `node:assert/strict`, no dependencies). Each case drives the launcher through `spawnSync(process.execPath, ['-e', harness, '--', ...args])`, where `harness` requires the launcher and calls `main(process.argv.slice(1), { platform, arch, baseDir })`, so stdio and exit codes are real. Cases:
   - (a) `platformPackage` maps all four pairs and returns `null` for `win32-x64`, `linux-ia32` and `freebsd-x64`.
   - (b) With all four fake packages under one temp `node_modules/@kaas-team/`, each injected pair runs its own binary: stdout starts `fake <pair>`.
   - (c) Arguments `--flag`, `a b` and an empty string arrive intact. `FAKE_EXIT=7` gives exit 7.
   - (d) `win32-x64` prints `win32-x64` and `INSTALL_LINE` to stderr and exits 1.
   - (e) A supported pair whose package is absent prints the package name, `--omit=optional` and `INSTALL_LINE`, and exits 1.
   - (f) A tampered binary (one byte appended after the sha was recorded) exits 1 with `checksum mismatch`, and the `FAKE_MARK` file does not exist, so the binary never ran.
   - (g) Spawn the launcher with `FAKE_SLEEP=1`, wait for the child's first stdout line, send SIGTERM to the launcher, and see `got TERM` in its stdout.
   - (h) Structural: every `require(` in `bin/factory.js` names a `node:` module. The shebang is line 1. `npm/factory/package.json` has `bin.factory` and none of `version`, `dependencies` or `optionalDependencies`. `install.sh` contains `INSTALL_LINE` verbatim, so the two one-liners cannot drift.

### T2: The pack step and the platform template
Files: `npm/platform.package.json`, `scripts/npm-pack.mjs`, `tests/fixtures/npm-assets.mjs`, `tests/npm-pack.test.mjs`, `.gitignore`
Model: sonnet
Deps: T1
1. `npm/platform.package.json` is the single platform template, valid JSON: `description` `"KaaS Factory binary, installed by @kaas-team/factory"`, `license`, `repository` (as in T1 with `directory` `npm`), `files` `["bin/"]`, `preferUnplugged` `true`. It has no `name`, `version`, `os`, `cpu` or `bin`: the pack step sets the first four, and a platform package never declares `bin`, so only the wrapper owns the `factory` command.
2. `scripts/npm-pack.mjs` (ESM, built-ins only) imports `PLATFORMS` from the launcher (`createRequire(import.meta.url)('../npm/factory/bin/factory.js')`), so the platform list exists once. Export `readSums(text)`, which returns a `Map` from file name to sha and applies the same rule as `install.sh:83` (a leading `*` on the name is dropped).
3. Export `pack({ assets, out, version })`. Strip one leading `v` from `version` and refuse anything that does not match `/^\d+\.\d+\.\d+$/`. Verify first, write second. For each pair, `asset = \`factory-${pair}\``; read `${assets}/${asset}` and its sum. A missing file or a missing sums line throws `no checksum listed for ${asset}`. The comparison is written exactly as `if (got !== want) throw new Error(\`checksum mismatch for ${asset}\`);`, and the text `got !== want` appears once in the file. Nothing under `out` is created until all four pass.
4. Then, for each pair, write `${out}/factory-${pair}/package.json`. Parse the template, then set `name` `@kaas-team/factory-${pair}`, `version`, `os: [os]`, `cpu: [cpu]` and `factorySha256: want`, so a value is never substituted as raw text. Copy the asset to `bin/factory` with mode 755.
5. Write `${out}/factory/`: copy `npm/factory/bin/factory.js` and `npm/factory/README.md`, the repo `LICENSE` into both the wrapper and each platform dir, and `package.json` from `npm/factory/package.json` with `version` set and `optionalDependencies` built from `PLATFORMS`, each at that version. Return the five directory paths.
6. CLI: `node scripts/npm-pack.mjs --assets <dir> --out <dir> --version <tag>`. All three flags are required. An error prints `npm-pack: <message>` to stderr and exits 1. Add `dist/` to a new `.gitignore`. The default `--out` used by the docs is `dist/npm`.
7. `tests/fixtures/npm-assets.mjs` exports `makeAssets(dir)`. It writes the four `fakeBinary` scripts from T1 as `factory-<pair>` and a `SHA256SUMS` in `sha256sum` format, with one line in `*file` form to cover that rule.
8. `tests/npm-pack.test.mjs`:
   - (a) `pack` with `v9.9.9` writes five package.json files whose `version` is `9.9.9`.
   - (b) The wrapper's `optionalDependencies` keys equal the four names from `PLATFORMS`, each at `9.9.9`.
   - (c) Each platform package has `os` and `cpu` matching its directory, no `bin`, a `factorySha256` equal to its `SHA256SUMS` line, and `bin/factory` with mode 755.
   - (d) A sums line changed by one hex digit makes the CLI exit 1 naming that asset, and `out` does not exist.
   - (e) A sums file missing one line exits 1 with `no checksum listed`.
   - (f) `--version 9.9` exits 1.
   - (g) Running `resolveBinary` from T1 against the packed host-platform directory returns `ok`, which proves the pack and the launcher agree on `factorySha256`.

### T3: Publish to a local registry stand-in, install and run
Files: `scripts/npm-publish.sh`, `ci/npm-publish.yml`, `tests/fixtures/registry.mjs`, `tests/npm-registry.test.mjs`, `Makefile`
Model: sonnet
Deps: T2
1. `scripts/npm-publish.sh <out-dir> [npm publish flags...]` (POSIX sh, `set -eu`). It counts the `"$1"/factory-*-*/` directories and dies unless there are exactly 4 and `"$1/factory/package.json"` exists. It runs `npm publish "$d" --access public "$@"` for each platform directory in glob order, then for `"$1/factory"` last, so the wrapper never points at a version that is not there yet. It reads no token itself: auth comes from the npm config the caller provides.
2. `tests/fixtures/registry.mjs` exports `startRegistry()`, which resolves to `{ url, published, requests, close }`. It is a `node:http` server on `127.0.0.1:0` that stands in for the npm registry with built-ins only:
   - `PUT /<name>` (the name is URL-decoded, so `@kaas-team%2ffactory` works) requires an `authorization` header, stores the `versions` manifests and the base64 `_attachments` tarball, rewrites each `dist.tarball` to `${url}/-/<file>`, pushes the name onto `published`, and answers 201.
   - `GET /<name>` returns the packument (`name`, `dist-tags.latest`, `versions`).
   - `GET /-/<file>` returns the tarball.
   - Anything else is 404. Every path is pushed onto `requests`.
3. `tests/npm-registry.test.mjs` (one `describe`, a 120 s timeout, all files in one `mkdtemp` dir). The npm env is `npm_config_userconfig` (a temp `.npmrc` holding `registry=<url>/` and `//127.0.0.1:<port>/:_authToken=stand-in`), `npm_config_globalconfig` (an empty temp file), `npm_config_cache` (temp), `npm_config_audit=false`, `npm_config_fund=false` and `npm_config_update_notifier=false`. The user's own npm config and any token never reach the test, and no request leaves 127.0.0.1. Cases, in order:
   - (a) `makeAssets`, then `node scripts/npm-pack.mjs --version 9.9.9`, then `sh scripts/npm-publish.sh <out>`. `published` equals the four platform names in `PLATFORMS` order followed by `@kaas-team/factory`.
   - (b) `npm install -g --prefix <p> @kaas-team/factory@9.9.9`, then run `<p>/bin/factory --flag "a b"` with `FAKE_EXIT=3`. Stdout starts `fake <host pair>`, the args come through intact and the exit code is 3. Under `<p>/lib/node_modules/@kaas-team/` (or nested under the wrapper's `node_modules`) only the host platform package exists, because npm skips the other three by `os` and `cpu`.
   - (c) `npm exec --yes --package @kaas-team/factory@9.9.9 -- factory --version` (the `npx` path) prints `fake <host pair>`.
   - (d) A second prefix installed with `--omit=optional` exits 1 and prints `--omit=optional` and the install line.
   - (e) Corrupting the installed platform `bin/factory` in the first prefix makes `<p>/bin/factory` exit 1 with `checksum mismatch`.
   - (f) Every entry in `requests` is a `PUT` or `GET` of a `@kaas-team` name or a `/-/` tarball.
   - (g) Structural: `ci/npm-publish.yml` names `NPM_TOKEN` as its only secret, passes `--provenance`, runs `scripts/npm-pack.mjs` before `scripts/npm-publish.sh`, and pins every `uses:` to a 40 hex commit sha.
   The test fails, never skips, when the host pair is not in `PLATFORMS`. CI (linux-x64) and the dev Mac (darwin-arm64) both are.
4. `ci/npm-publish.yml` is staged for an operator to copy to `.github/workflows/npm-publish.yml` after the npm org and `NPM_TOKEN` exist. It runs on `workflow_dispatch` with a `tag` input, in one job with `permissions: { contents: read, id-token: write }`. Its steps are checkout and setup-node (each pinned to a commit sha with the tag in a comment, `registry-url: https://registry.npmjs.org`), then `gh release download "$TAG" -R KaaS-team/KaaS-factory -p 'factory-*' -p SHA256SUMS -D dist/assets`, then `node scripts/npm-pack.mjs --assets dist/assets --out dist/npm --version "$TAG"`, then `sh scripts/npm-publish.sh dist/npm --provenance` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. A 2 line header comment says it is staged and why. It contains no cosign step: that is #4 T2.
5. `Makefile`: `lint` also shellchecks `scripts/npm-publish.sh` and runs `node --check` on `npm/factory/bin/factory.js` and `scripts/npm-pack.mjs`. `test` keeps `sh tests/install.test.sh` and adds `node --test` with no path argument, so any new `*.test.mjs` is picked up and none is skipped by a glob. `make check` runs both and fails when either fails.

## Tests
- `tests/npm-launcher.test.mjs`: [permanent] each platform choice, unsupported and missing messages, argument and exit code passthrough, checksum refusal before run, SIGTERM forwarding, built-ins only, one install line shared with `install.sh`.
- `tests/npm-pack.test.mjs`: [permanent] five packages at one version from one template, `os` and `cpu`, no platform `bin`, sha recorded from `SHA256SUMS`, mismatch and missing line write nothing, launcher accepts what pack wrote.
- `tests/npm-registry.test.mjs`: [permanent] pack, publish (platforms first) to the local stand-in, `npm i -g` and `npm exec` run the host binary with args and exit code, `--omit=optional` and a tampered install refuse, no request leaves the stand-in, the staged workflow's secret, provenance and pins.
- `tests/install.test.sh`: [permanent] existing; must stay green.
- First real publish: [manual] after the operator steps under Risk, `npx @kaas-team/factory@<version> --version` prints `factory <version> (kaas.team)` on macOS and Linux.

## Mutation
```json
{"name":"launcher: a tampered binary is refused","file":"npm/factory/bin/factory.js","find":"got !== want","replace":"false","test":"tests/npm-launcher.test.mjs"}
```
```json
{"name":"launcher: unsupported platform has no package","file":"npm/factory/bin/factory.js","find":"PLATFORMS.includes(pair)","replace":"true","test":"tests/npm-launcher.test.mjs"}
```
```json
{"name":"pack: a bad sum aborts","file":"scripts/npm-pack.mjs","find":"got !== want","replace":"false","test":"tests/npm-pack.test.mjs"}
```

## Acceptance
- AC-1: the launcher resolves the right platform package for each of the four pairs, passes args, stdio, exit code and SIGTERM through, refuses an unsupported or missing package with the platform and the install line and exit 1, and refuses a binary whose sha256 differs from the recorded one: checked by `tests/npm-launcher.test.mjs` (T1)
- AC-2: one template and one version produce five package.json files at one version, and a binary that does not match `SHA256SUMS` stops the pack with nothing written: checked by `tests/npm-pack.test.mjs` (T2)
- AC-3: the packed packages publish (platforms first) to a local registry stand-in and install with `npm i -g` and `npm exec`, running only the host binary, with no request leaving the stand-in: checked by `tests/npm-registry.test.mjs` (T3)
- AC-4: `make check` runs the install tests and every `node --test` file, and the gate is green: checked by `.factory/gates.sh` (T3)

## Non-goals
- NG-1: nothing is published to the public npm registry, no `NPM_TOKEN` is read or set, and no file under `.github/` changes. The publish workflow is staged at `ci/npm-publish.yml` for an operator to copy.
- NG-2: the launcher never downloads anything: no postinstall script, no network fallback. A missing package prints the install line.
- NG-3: no runtime or dev dependency in any package.json, and no registry package (the stand-in is built-ins only).
- NG-4: no cosign verification of `SHA256SUMS` and no brew formula; both stay in #4 T2.
- NG-5: no change to `install.sh` behaviour. No Windows package.
- NG-6: no real factory binary and no generated `dist/` output is committed.

## Files
- `npm/factory/package.json` (new)
- `npm/factory/bin/factory.js` (new)
- `npm/factory/README.md` (new)
- `npm/platform.package.json` (new)
- `scripts/npm-pack.mjs` (new)
- `scripts/npm-publish.sh` (new)
- `ci/npm-publish.yml` (new)
- `tests/fixtures/fake-platforms.mjs` (new)
- `tests/fixtures/npm-assets.mjs` (new)
- `tests/fixtures/registry.mjs` (new)
- `tests/npm-launcher.test.mjs` (new)
- `tests/npm-pack.test.mjs` (new)
- `tests/npm-registry.test.mjs` (new)
- `.gitignore` (new)
- `Makefile` (edit: lint the new scripts, `node --test` in `test`)

## Risk: high
The charter rates the npm wrapper's launch code medium and anything that downloads and runs a binary, or the publish step, high. The launcher runs a binary that npm downloaded, and T3 adds the publish script, so this is high. The trust chain is: `npm-pack.mjs` checks each asset against `SHA256SUMS` and records the sha. npm checks the tarball integrity on install. The launcher re-checks the sha before every run. Both checks have a mutation. Hashing costs one read of the binary per run, which is a known trade for refusing a tampered install. If the registry e2e shows npm dropped the exec bit from `bin/factory`, the fix goes in `npm-pack.mjs` (the file mode written before pack), never as a chmod in the launcher at run time. Operator steps before the first publish, in order: create the npm org `kaas-team`; `! npm login`; `! gh secret set NPM_TOKEN -R KaaS-team/factory-install`; copy `ci/npm-publish.yml` to `.github/workflows/npm-publish.yml`; run it with a released tag. Rollback: `npm deprecate @kaas-team/factory@<version> "<reason>"` and the same for the four platform packages.
