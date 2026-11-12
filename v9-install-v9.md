You are one of twenty agents working in parallel. You work alone in KaaS-team/factory-install; the others are in other repos.

## Why

The v9 factory releases with goreleaser: project `factory`, archives `factory_<os>_<arch>.tar.gz` (os linux or darwin, arch amd64 or arm64), and `checksums.txt` in each GitHub release of KaaS-team/KaaS-factory (renamed to KaaS-team/factory later; follow the redirect). `install.sh` must install those.

## Setup

`git fetch origin && git checkout -b cluster/install-v9 origin/main`. The gate is `make check` (sh -n, shellcheck if present, node --check, `node --test`). Your file area: `install.sh`, `scripts/`, `tests/`, `README.md`, `homebrew/`.

## Acceptance

- [ ] `install.sh` maps `uname` to the archive name, downloads the archive and `checksums.txt` from `FACTORY_DOWNLOAD_BASE` (default the GitHub release URL), verifies the sha256 (sha256sum or shasum), and refuses on mismatch.
- [ ] `--version` with and without a leading `v`, `latest`, `--dir`, `--uninstall` keep working.
- [ ] Tests serve a fake release from a local HTTP server (node) and cover: success on each os/arch pair the script can emulate via an env override, checksum mismatch, missing asset, unknown arch.
- [ ] The homebrew formula template matches the archive names.
- [ ] README install section updated; no other behaviour removed (list anything you changed).

## Lessons from the last wave (apply them)

- Long checks (mutation runs, full test suites) can pass a 120 s tool timeout. Start them in the background, write output to a file, and wait for it.
- Run the linter before committing test edits.
- If a test passes the first time, prove it bites by breaking the code once (revert after) and say so.

## Order of work, for each acceptance line

1. Check whether it already holds. If it does, change no code and record the evidence.
2. Write a test that fails, then the code that makes it pass. Revert the fix once and watch the test fail.
3. Run the repo's gate (`make check`) before every push. Commit with `git commit -s`, one commit per acceptance group, and push after each so a dropped session loses little.

## Checkpoints, before every commit

1. Area: every changed file is in your area or listed under "Files outside my area".
2. Scope: the diff serves only an acceptance line below.
3. Meaning: each acceptance line still means what it says; if it cannot be met, record it blocked, never weaken it.
4. Proof: you saw each new test fail before the fix and pass after.
5. Pins: you raised no cap, baseline or golden just to make a test pass; any golden you update is named in the report with the reason.
6. Forbidden paths: nothing under `.github/`, `.factory/`, `.claude/`, `.agents/`; no version or changelog edit.

## Rules

- No network, real token or model call in any test. Use fixtures and fake executables on `PATH`.
- No `ANTHROPIC_*` or other provider key anywhere.
- This repo may become public. Name no customer. No model name, token count or cost in customer-facing output except where an acceptance line asks for an estimate in the operator report.
- No em dashes in prose. Plain sentences. Never write a claim the code does not do.
- Do not comment on, label or close issues, and do not open a PR. Never force-push or push to `main`.
- No session URL, `claude.ai` link or `Claude-Session:` trailer in any commit or file.
- If one line is blocked, record why and continue.

## When you finish

Write the report below to a file outside the repo, then push it:

```
b=$(git hash-object -w /tmp/report.md); t=$(printf '100644 blob %s\treport.md\n' "$b" | git mktree); c=$(git commit-tree "$t" -m report); git push origin "$c:refs/heads/report/v9-install-v9"
```

Your final message is that same report, exactly:

```
BRANCH: cluster/install-v9
HEAD: <full sha you pushed, checked with git ls-remote>
## Summary
<one or two sentences>
## Acceptance
- <line> -> <test name> -> done | already held | blocked (why)
## Files outside my area
<each, with why, or none>
## Goldens changed
<each, with why, or none>
## Gate evidence
<last lines of `make check`, verbatim>
## Learnings
<what cost time; what the defaults should do instead. One line each.>
```