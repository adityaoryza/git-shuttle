# git-shuttle: developer tasks.   `make help` lists them.
SHELL := bash
SOURCES := bin/git-shuttle $(wildcard lib/*/*.sh) $(wildcard tests/*.sh) $(wildcard tests/helpers/*.sh) $(wildcard tests/cli/*.sh)
PYTHON := $(wildcard ui/shuttle_ui/*.py) $(wildcard tests/ui/*.py)
JS := $(wildcard ui/shuttle_ui/static/js/*.js) $(wildcard ui/shuttle_ui/static/js/components/*.js) $(wildcard tests/ui/*.mjs)
PREFIX ?= $(HOME)/.local

.PHONY: help lint test install uninstall

help: ## show this help
	@grep -hE '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

lint: ## syntax check and ShellCheck (and the Python and JavaScript of the UI)
	bash -n $(SOURCES)
	shellcheck -x $(SOURCES)
	python3 -m py_compile $(PYTHON)
	@if command -v node >/dev/null 2>&1; then for f in $(JS); do node --check $$f || exit 1; done; else echo "node is missing: JavaScript not checked"; fi

test: ## run the tests (each builds its own throw-away repositories; no network)
	bash tests/run.sh

install: ## link bin/git-shuttle into $(PREFIX)/bin, so that `git shuttle` works
	mkdir -p "$(PREFIX)/bin"
	ln -sf "$(CURDIR)/bin/git-shuttle" "$(PREFIX)/bin/git-shuttle"
	@echo "installed: $(PREFIX)/bin/git-shuttle  (is $(PREFIX)/bin in your PATH?)"

uninstall: ## remove the link
	rm -f "$(PREFIX)/bin/git-shuttle"
