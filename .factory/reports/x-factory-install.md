# x-factory-install report

## 1. Demo commands
```
git fetch origin wb/x-factory-install
git show origin/wb/x-factory-install:README.md     # the 6-line pointer
git show origin/wb/x-factory-install:PARITY.md     # the parity table
```
Gate: none needed (docs only). Every `next` path in PARITY.md was checked with `ls` in a clone of `next` at ad206c6.

## 2. Acceptance
- PARITY.md lists every feature with a verdict and a path that exists on `next`: done. Rows marked missing or dropped have no path by definition and say why.
- README.md is the pointer; no other file changed: done. Only README.md and PARITY.md changed, plus this report as the brief requires.

## 3. Upstreams copied
None. No code copied. Read KaaS-team/KaaS-factory@ad206c6 (branch `next`).

## 4. Files outside my area / workflow changes
None.

## Missing rows (tickets for the factory)
1. npm install path. Problem: `npm i -g @kaas-team/factory` is gone. Acceptance: launcher plus four platform packages from the goreleaser archives, with a test that it runs the right binary.
2. Cosign check. Problem: nothing verifies the signature of `checksums.txt`. Acceptance: release signs it, install.sh or selfupdate verifies it when cosign is present.
3. Same-binary check. Problem: nothing proves script, brew and npm ship identical bytes. Acceptance: a release step fails on any sha256 difference.
4. Scheduled publish. Problem: new releases are not pushed to npm automatically. Acceptance: a workflow publishes the latest tag within an hour and skips published tags.
5. `already installed` message. Problem: a repeat install.sh run gives no sign nothing changed. Acceptance: a second run with the same version prints `already installed` and leaves the binary alone.
