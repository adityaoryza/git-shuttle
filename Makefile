# git-shuttle: developer tasks.   `make help` lists them.
SHELL := bash
SOURCES := bin/git-shuttle install.sh $(wildcard lib/*/*.sh) $(wildcard tests/*.sh) $(wildcard tests/helpers/*.sh) $(wildcard tests/cli/*.sh)
PYTHON := $(wildcard ui/shuttle_ui/*.py) $(wildcard lib/addons/*.py) $(wildcard tests/ui/*.py)
JS := $(wildcard ui/shuttle_ui/static/js/*.js) $(wildcard ui/shuttle_ui/static/js/components/*.js) $(wildcard tests/ui/*.mjs) $(wildcard tests/e2e/*.mjs tests/e2e/lib/*.mjs tests/e2e/scenarios/*.mjs tests/e2e/screenshots/*.mjs)
PREFIX ?= $(HOME)/.local

.PHONY: help lint test e2e screenshots install uninstall

help: ## show this help
	@grep -hE '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

lint: ## syntax check and ShellCheck (and the Python and JavaScript of the UI)
	bash -n $(SOURCES)
	shellcheck -x $(SOURCES)
	python3 -m py_compile $(PYTHON)
	@if command -v node >/dev/null 2>&1; then for f in $(JS); do node --input-type=module --check < $$f || { echo "syntax error in $$f"; exit 1; }; done; else echo "node is missing: JavaScript not checked"; fi

test: ## run the tests (each builds its own throw-away repositories; no network)
	bash tests/run.sh

e2e: ## browser tests (needs Node and a download of Playwright and Chromium; the other tests do not)
	@command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || { echo "SKIPPED: Node and npm are needed for the browser tests"; exit 0; }
	cd tests/e2e && npm install --no-audit --no-fund --silent && npx playwright install chromium >/dev/null && node run.mjs

screenshots: ## regenerate docs/images from the made-up demo repository
	cd tests/e2e && npm install --no-audit --no-fund --silent && npx playwright install chromium >/dev/null && node run.mjs --screenshots

install: ## link bin/git-shuttle into $(PREFIX)/bin, so that `git shuttle` works
	mkdir -p "$(PREFIX)/bin"
	ln -sf "$(CURDIR)/bin/git-shuttle" "$(PREFIX)/bin/git-shuttle"
	@echo "installed: $(PREFIX)/bin/git-shuttle  (is $(PREFIX)/bin in your PATH?)"

uninstall: ## remove the link
	rm -f "$(PREFIX)/bin/git-shuttle"
