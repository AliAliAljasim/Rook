# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Releases: only when asked

- Never bump the version, push, or run `make release` unless the user asks for that in the current request. Releasing publishes to GitHub and every installed Rook updates itself from it.
- Committing is fine when asked; pushing and releasing are separate asks.
- To let the user try a change, use `make try` (below), not a release.

## Commands

Development happens in WSL; the app runs on Windows.

- `make check` – syntax-check every `src/*.js` (`node --check`).
- `make test` / `npm test` – unit tests (`node --test test/*.test.js`). One file: `node --test test/moves.test.js`; one test: add `--test-name-pattern "<regex>"`.
- `make try` – build the working tree (committed or not) as a throwaway test copy in `%TEMP%\rook-try-<version>-<time>` and start it. It copies settings from the installed Rook (`%APPDATA%\Rook\config.json`); `make try FRESH=1` starts with none, which shows the first-run setup. A hidden PowerShell watcher deletes the folder once the copy has quit (log: `%TEMP%\rook-try.log`); leftovers are cleared by the next `make try`. The copy works on the real vault.
- `make dist` – build the installer, `dist/rook-setup-<version>.exe`.
- `make release` – only when asked (see above). `scripts/release.sh` refuses unless the tree is clean and `HEAD` equals `origin/main`, and refuses a version that is already released. Bump `version` with `npm version X.Y.Z --no-git-tag-version`, commit, push, then `NOTES="…" make release`. The build needs `node_modules` (`npm ci`), or electron-builder fails on the `^` Electron range.
- `npx electron --no-sandbox scripts/shot.js <dir>` – renders the real UI with mocked IPC (sample data) and writes screenshots plus `checks.txt` / `errors.txt`. It is the way to verify UI changes from WSL; new IPC channels need a mock in its handler table.

## Architecture

Electron app on Windows that runs the Claude Code CLI inside WSL (`wsl.exe --cd <vault> -e <claudePath> -p …`) against an Obsidian vault. The agent may write only inside the vault; everything else is read-only.

- `src/main.js` – main process: config, vault index, every IPC handler, agent runs, tray, global shortcuts, updater. Config is `userData/config.json` merged over `DEFAULTS`. Vault, CLI path and name are blank by default and filled in by the first-run setup (`needsSetup`); never put machine-specific paths in `DEFAULTS`.
- `src/renderer.js`, `src/features.js`, `src/views.js` – the page: plain JS, no framework, no bundler. Loaded as classic `<script>`s in `index.html`, so they share one global scope (`S` state, `h()` DOM builder). Never inject HTML; build nodes. `preload.js` is the only bridge (`window.api`).
- Shared pure modules (`markdown.js`, `moves.js`) work under both `require` and `window.*`; `vaultscan.js`, `schedule.js`, `clip.js`, `voice.js`, `guard.js` are main-side. Pure logic goes in modules like these so it can be unit tested without Electron.

### Safety model (two layers; keep both)

1. **Agent permissions** – `src/policy.js` builds a Claude Code `--settings` file written to `userData/policy.json` (outside the vault) on every run: `Edit(//<vault>/**)` allowed; `.obsidian`, `.claude`, WebFetch and `rm`/`mv`/`cp`/`sudo` denied. WebSearch is allowed when the `webSearch` setting is on; WebFetch stays denied because with the whole machine readable it would be a way to send files out (pages come in through `/clip`, fetched by the app). Reading scope is `machine` (adds `--add-dir /`) or `vault`. `SYSTEM_PROMPT` in the same file is the agent's instructions; it is rebuilt every run and carries the local date/time (`nowForAgent` in main.js).
2. **App file access** – everything the app itself writes or deletes goes through `resolveInside(root, rel)` in `src/guard.js` (realpath, case-insensitive on Windows, refuses paths outside the vault).

The agent cannot move, rename or delete files itself (a shell rule cannot keep `mv`/`rm` inside the vault). Instead it ends its reply with a `<files>` block (`- a.md -> b/a.md`, `- delete x.md`; `<moves>` also accepted). `src/moves.js` parses it and rewrites `[[links]]`. When the reply is done, the renderer (`runMoves`) calls `vault:move`. That runs each action through the guard, sends deletes to the Recycle Bin, backs up notes whose links change, and returns what `vault:moveUndo` needs. `<choices>` blocks become answer buttons the same way (`splitChoices`).

### Agent run flow

`chat:send` → `agentArgs()` → `wsl.exe` with `--output-format stream-json`; the prompt goes on stdin. Main parses the JSON lines, backs up a note before each Write/Edit (`keepBefore` → `userData/backups`, 30 days, used by the Changes/undo viewer), and forwards events to the renderer (`onEvent`). Scheduled runs (`src/schedule.js`) reuse `agentArgs` with `--output-format json`. `agentProblem()` stops a run early with a readable message when setup is incomplete or the vault folder is missing.

### Test copy

A `ROOK_TRY` file next to the exe (written by `scripts/try.sh`) sets `TRY` in `main.js`. A test copy keeps userData inside its own folder, uses its own AppUserModelId, and turns off the tray (closing quits it), startup registration, global shortcuts, scheduled runs and updates, so it never competes with the installed app. The page shows a "test" tag next to the wordmark.

## Conventions

- UI copy is plain English addressed to the user ("Rook could not…", "Open Settings to…"), no jargon; comments explain why, in full sentences.
- The design language (`src/style.css`) uses color tokens with a light theme; fonts are bundled in `src/fonts/` so the app works offline.
- Updates come from GitHub releases of the private repo; the updater gets a token from `gh auth token` inside WSL each time and stores nothing.
