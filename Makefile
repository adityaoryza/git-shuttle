# git-shuttle: developer tasks.   `make help` lists them.
SHELL := bash
SOURCES := bin/git-shuttle $(wildcard lib/*.sh) $(wildcard tests/*.sh) $(wildcard tests/lib/*.sh) $(wildcard tests/unit/*.sh)
PREFIX ?= $(HOME)/.local

.PHONY: help lint test install uninstall

help: ## show this help
	@grep -hE '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

lint: ## syntax check and ShellCheck (and the Python and JavaScript of the UI)
	bash -n $(SOURCES)
	shellcheck -x $(SOURCES)
	python3 -m py_compile ui/server.py tests/ui/test_server.py
	@if command -v node >/dev/null 2>&1; then node --check ui/static/logic.js ui/static/app.js tests/ui/test_logic.js tests/ui/test_page.js; else echo "node is missing: JavaScript not checked"; fi

test: ## run the tests (each builds its own throw-away repositories; no network)
	bash tests/run.sh

install: ## link bin/git-shuttle into $(PREFIX)/bin, so that `git shuttle` works
	mkdir -p "$(PREFIX)/bin"
	ln -sf "$(CURDIR)/bin/git-shuttle" "$(PREFIX)/bin/git-shuttle"
	@echo "installed: $(PREFIX)/bin/git-shuttle  (is $(PREFIX)/bin in your PATH?)"

uninstall: ## remove the link
	rm -f "$(PREFIX)/bin/git-shuttle"
