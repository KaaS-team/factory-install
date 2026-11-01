.PHONY: check lint test

check: lint test

lint:
	@sh -n install.sh
	@for f in scripts/*.sh; do sh -n "$$f"; done
	@if command -v shellcheck >/dev/null 2>&1; then \
		shellcheck -s sh install.sh scripts/*.sh; \
	else echo "shellcheck not installed"; fi
	@node --check npm/factory/bin/factory.js
	@for f in scripts/*.mjs tests/*.mjs tests/fixtures/*.mjs; do node --check "$$f" || exit 1; done

test:
	@node --test
