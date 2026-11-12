BRANCH: cluster/install-v9
HEAD: f9e9aa5edb32c64a682d2b8b02ec2f7f00fef99b
## Summary
install.sh now installs goreleaser archives (factory_<os>_<arch>.tar.gz, amd64 or arm64) and verifies them against checksums.txt. The Homebrew template and formula script use the same names, and the tests serve a fake release over local HTTP.
## Acceptance
- install.sh maps uname to archive name, downloads archive and checksums.txt from FACTORY_DOWNLOAD_BASE, verifies sha256, refuses on mismatch -> "installs the verified binary for each platform and it runs", "a corrupted sum aborts and leaves no file" -> done
- --version with/without v, latest, --dir, --uninstall keep working -> "--version reads that tag...", "--uninstall removes...", "--dir defaults..." -> done (already held, tests adapted)
- Tests use a local node HTTP server; cover success per os/arch (uname stub on PATH), mismatch, missing asset, unknown arch -> "a missing archive or missing checksums.txt aborts", "an unknown arch or os exits 2" -> done
- Homebrew template matches archive names -> brew.test.mjs "pairs each url with its own sha" -> done
- README install section updated -> done
## Files outside my area
none
## Goldens changed
none. Behaviour changes: arch name x64 is now amd64; the sums file is checksums.txt not SHA256SUMS; "already installed" is now decided after download by comparing the unpacked binary with the installed one (before: by listed sha, no binary download). Formula installs "factory" from the archive. Added tests: archive with no factory binary.
Bite proof: removed the mismatch check in install.sh, 3 tests failed; renamed AMD64 to X64 in the template, brew tests failed; both reverted.
Not changed (outside the acceptance lines, still on old names): scripts/fetch-release.mjs, npm-pack.mjs, scripts/release/publish.yml (old raw binary names and SHA256SUMS, cosign). publish.yml feeds brew-formula.mjs a SHA256SUMS from fetch-release, which will not list archive names, so the brew step will fail until the release pipeline is moved to v9 assets.
## Gate evidence
1..10
# tests 55
# suites 10
# pass 54
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 3502.245231
(shellcheck is not installed here, so lint ran sh -n only.)
## Learnings
- Existing tests used spawnSync with file:// base; an HTTP server needs async spawn. Defaults: note that in the brief.
- The brief's area covers scripts/ but the npm pipeline shares the asset names; say whether it should move too.
