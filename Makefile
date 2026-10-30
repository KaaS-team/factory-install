.PHONY: check lint test

check: lint test

lint:
	@if command -v shellcheck >/dev/null 2>&1; then \
		shellcheck -s sh install.sh scripts/npm-publish.sh tests/install.test.sh; \
	else echo "shellcheck not installed"; fi
	@node --check npm/factory/bin/factory.js
	@node --check scripts/npm-pack.mjs

test:
	@sh tests/install.test.sh
	@node --test
