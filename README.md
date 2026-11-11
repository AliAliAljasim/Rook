# Rook
A note-taking assistant for an Obsidian vault. Electron app (Windows) -> `wsl.exe` -> Claude Code CLI.
Writes are allowed only inside the vault; everything else is read-only.

## What it does
- **Chat**: ask about the vault or tell Rook what to write. Replies render as markdown; edited notes show as chips. The Chat home page lists saved chats (filter, pin, rename, delete with undo), stored locally in the app's userData folder.
- **Notes**: a folder tree with a Note/Map toggle. Note is a read-only markdown viewer (frontmatter, callouts, nested lists, tables, wiki-links, linked notes). Map is a graph of notes (dots) and `[[links]]` (lines): drag, zoom, click a dot, double-click to open.
- **Mini modes**: a side chat (narrow always-on-top panel showing the conversation) and a quick-capture bar. Each remembers its own spot; Ctrl M toggles the last one used.

## Design
Shares Groove's design language (`src/style.css`): warm near-black ground, one amber accent, Instrument Sans / DM Mono / Anton,
pill controls, soft panels, the splash that swipes up. Fonts are bundled in `src/fonts/` so the app works offline.

## Safety
- Agent policy: `src/policy.js` (written to userData/policy.json at each run, outside the vault). Reading scope is a setting.
- App's own file access goes through `src/guard.js` (tests: `test/guard.test.js`, `make test`). The viewer only reads `.md` files inside the vault.

## Make targets
`make install` · `make check` · `make test` · `make dist` (builds the Windows installer from WSL; needs wine32) · `make release` · `make login`

`make dist` writes `dist/rook-setup-<version>.exe`.
`npx electron --no-sandbox scripts/shot.js <dir>` renders the UI with sample data and saves screenshots.
