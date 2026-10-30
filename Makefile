.PHONY: check lint test

check: lint test

lint:
	@if command -v shellcheck >/dev/null 2>&1; then \
		shellcheck -s sh install.sh tests/install.test.sh; \
	else echo "shellcheck not installed"; fi

test:
	@sh tests/install.test.sh
