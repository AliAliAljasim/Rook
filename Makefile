.PHONY: help login install start check dist clean

help:        ## list targets
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/ -/'

login:       ## sign in to Claude Code (same as /login)
	claude auth login

install:     ## install npm dependencies
	npm install

start:       ## run the app in dev mode (run from Windows, not WSL)
	npm start

check:       ## syntax-check all source files
	@for f in src/*.js; do node --check $$f && echo "ok $$f"; done

dist:        ## build the Windows NSIS installer (run from Windows) -> dist/
	npm run dist

clean:       ## remove build output and node_modules
	rm -rf dist node_modules
