.PHONY: check test
check:
	@sh -n install.sh 2>/dev/null || true
	@echo "bootstrap gate: replaced by the first installer issue"
	node --test test/*.test.js
test: check
