.PHONY: help login install start check dist release clean

help:        ## list targets
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/ -/'

login:       ## sign in to Claude Code (same as /login)
	claude auth login

install:     ## install npm dependencies
	npm install

start:       ## run the app in dev mode (needs a display; use the installer on Windows)
	npm start

check:       ## syntax-check all source files
	@for f in src/*.js; do node --check $$f && echo "ok $$f"; done

dist:        ## build the Windows installer from WSL -> dist/vault-assistant-setup-<ver>.exe
	WINEDEBUG=-all npm run dist:win

release:     ## build + publish a GitHub release (bump version, push main first)
	npm run release:win

clean:       ## remove build output and node_modules
	rm -rf dist node_modules
