# KaaS-team/factory-install factory charter

## Stack

A POSIX shell installer, a small Node npm wrapper package, and their tests.

## Risk tiers

- **low**: docs, one test, or one flag of the installer.
- **medium**: install logic, checksum handling, PATH changes, or the npm wrapper's launch code.
- **high**: the release workflow, the publish step or anything that downloads and runs a binary.

## Protected paths

A plan that requires editing any of these is refused at triage and needs a
human PR. Keep this list identical to `protectedPaths` in `config.json`.

- `.factory/**`
- `.claude/**`
- `.agents/**`
- `.github/**`

## STOP_IF

When `maxOpenFactoryPrs` factory PRs are already open, no new
`factory:ready` issue is picked up. Existing runs, approvals, answers and
revises keep going.
