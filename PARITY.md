# Parity with the Go factory

factory-install is archived. This table lists every feature it had and where the Go factory
(`KaaS-team/KaaS-factory`, branch `next` at `ad206c6`, soon `KaaS-team/factory`) covers it.
Paths are in that repo. Verdicts: **covered**, **dropped** (on purpose) or **missing**.

## Installers

| Feature here | Verdict | Where on `next` |
|---|---|---|
| `install.sh`: detect OS and CPU, fetch `factory_<os>_<arch>.tar.gz` and `checksums.txt`, check sha256, refuse on mismatch, no sudo | covered | `install.sh` |
| `--version <tag>`, `--dir <path>`, `--uninstall`, `--help` flags | covered | `install.sh` |
| `FACTORY_INSTALL_DIR`, `FACTORY_DOWNLOAD_BASE` env vars | covered, renamed `FACTORY_BIN_DIR`, `FACTORY_BASE_URL` (also `FACTORY_VERSION`, `PREFIX`) | `install.sh`, `docs/install.md` |
| Second run says `already installed` | missing | none (`install.sh` has no such message) |
| Install tests against a local fake release server | covered | `packaging/installsh/install_test.go` |
| Homebrew formula template and `scripts/brew-formula.mjs` render | covered, goreleaser pushes the formula to the tap | `packaging/homebrew/factory.rb.tmpl`, `.goreleaser.yaml`, `.github/workflows/release.yml` |
| Formula tests | covered | `packaging/homebrew/factory_test.go` |
| npm launcher `@kaas-team/factory` plus four platform packages (`npm/`, `scripts/npm-pack.mjs`, `scripts/npm-publish.sh`, `.github/workflows/npm-publish.yml`) | missing | none; `docs/install.md` lists script, brew and `go install` only |
| npm launcher and pack tests (`tests/npm*.test.mjs`, `tests/fixtures/*`) | missing | follows the npm launcher |
| `scripts/fetch-release.mjs`: cosign-verify `SHA256SUMS` before trusting a release | missing | none; `internal/selfupdate/selfupdate.go` checks sha256 but no cosign check was found |
| `scripts/same-sha.sh`: every installer ships the same binary | missing | none |
| `scripts/release/publish.yml`: hourly publish of the latest release | missing | none; `release.yml` publishes the release and the brew formula only |
| `site/Dockerfile`, `site/nginx.conf`: serve `install.sh` at `factory.kaas.team` | dropped | `factory.kaas.team` now runs the factory app (`docker-compose.yml`); `install.sh` is served from raw GitHub (`docs/install.md`) |
| `Makefile` (`lint`, `test`, `check`) | dropped | the factory has its own gate: `gate.sh`, `justfile` |

## Factory template files shipped in this repo

| Feature here | Verdict | Where on `next` |
|---|---|---|
| Skills: factory-triage, -plan, -build, -verify, -pr, -retro, -comment (with `assets/*.md`), -operator | covered | `template/.claude/skills/` |
| Skill references `factory-build/references/ui-route.md`, `factory-verify/references/ui-route.md`, `factory-verify/references/prove.md` | covered | `template/.claude/skills/factory-build`, `template/.claude/skills/factory-verify` |
| Agents: factory-plan-critic, factory-reviewer | covered | `template/.claude/agents/` |
| Hooks: guard-paths, post-edit-check, stop-artifact, stop-verifier-evidence | covered | `template/.claude/hooks/` |
| `.claude/settings.json` (deny list, hook wiring) | covered | `template/.claude/settings.json` |
| `.agents/skills` symlink to `.claude/skills` | covered by the template layout | `template/.claude/skills/` |
| `.factory/charter.md` | covered | `template/.factory/charter.md` |
| `.factory/config.example.json` (gates, agentCommands, protectedPaths, riskPolicy, concurrency, tracker, labels, agents, stages, routes) | covered | `template/.factory/config.example.json`, `docs/config.md` |
| `.factory/config.json` (this repo's own settings) | dropped | repo-specific, not a feature |
| `.factory/gates.sh`, `.factory/mutate.sh` | covered | `template/.factory/gates.sh`, `template/.factory/mutate.sh` |
| `.factory/manifest.json` (file hashes for upgrades) | covered | `internal/upgrade/upgrade.go` |
| `.factory/memory/lessons.md` | covered | `template/.factory/memory/lessons.md` |
| `.factory/minions/wiki-refresh.yml.example` | covered | `template/.factory/minions/wiki-refresh.yml.example` |
| Workflows: feature-to-pr, bug-to-pr, docs-to-pr, planned-to-pr, approved-plan-to-pr, dependency-update, flaky-tests, security-audit | covered | `template/.factory/workflows/*.yml`, `docs/workflows.md` |
| Workflows: backlog-triage, ci-cd-authoring, ci-fix, coverage-gap, harness-learn, pr-review, release-notes, spec-to-plan, test-authoring, ui-component | covered | `template/.factory/workflows/*.md` |
| `.github/pull_request_template.md`, `.github/workflows/ci.yml` | covered (PR template); CI is repo-specific | `template/.github/pull_request_template.md`, `.github/workflows/ci.yml` |

## Missing rows, as tickets for the factory

1. **npm install path.** Problem: `npm i -g @kaas-team/factory` worked here and is gone. Acceptance: a launcher plus four platform packages built from the goreleaser archives, with a test that the launcher runs the right binary.
2. **Cosign check on releases.** Problem: nothing verifies the signature of `checksums.txt`. Acceptance: release job signs it, and `install.sh` or `selfupdate` verifies it when `cosign` is present.
3. **Same-binary check.** Problem: nothing proves script, brew and npm ship identical bytes. Acceptance: a release step fails if the sha256 differs across installers.
4. **Scheduled publish.** Problem: a new release is not pushed to npm on its own. Acceptance: a workflow publishes the latest tag to npm within an hour, skipping tags already published.
5. **`already installed` message.** Problem: a repeat `install.sh` run gives no sign nothing changed. Acceptance: running twice with the same version prints `already installed` and leaves the binary alone.
