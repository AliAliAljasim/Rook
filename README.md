# Rook
A note-taking assistant for an Obsidian vault.
Electron chat app (Windows) -> `wsl.exe` -> Claude Code CLI. Writes allowed only in the Obsidian vault; everything else read-only.

- Design: Wren's "Classical" system. Tokens/components in `src/tokens.css`, `src/components.css`, `src/app.css`; fonts are bundled in `src/fonts/` (works offline).
- Read-only policy for the agent: `src/policy.js` (written to userData/policy.json at each run, outside the vault). Reading scope is a setting: whole machine or vault only.
- Write guard for the app's own file writes (Save as note, Undo): `src/guard.js`, tested in `test/guard.test.js` (`make test`).
- Saved chats are stored locally in the app's userData folder.

## Make targets
`make install` · `make check` · `make test` · `make dist` (builds the Windows installer from WSL; needs wine32) · `make release` · `make login`

`make dist` writes `dist/rook-setup-<version>.exe`.
`node scripts/shot.js <dir>` (run with `npx electron --no-sandbox`) renders the UI with sample data and saves screenshots.
