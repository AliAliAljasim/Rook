# Rook
A note-taking assistant for an Obsidian vault. Electron app (Windows) -> `wsl.exe` -> Claude Code CLI.
Writes are allowed only inside the vault; everything else is read-only.

## What it does
- **Chat**: ask about the vault or tell Rook what to write. Replies render as markdown; edited notes show as chips. The Chat home page lists saved chats (filter, pin, rename, delete with undo), stored locally in the app's userData folder.
- **Notes**: a folder tree with a Note/Map toggle. Note is a read-only markdown viewer (frontmatter, callouts, nested lists, tables, wiki-links, linked notes). Map is a graph of notes (dots) and `[[links]]` (lines): drag, zoom, click a dot, double-click to open.
- **Mini modes**: a side chat (narrow always-on-top panel showing the conversation) and a quick-capture bar. Each remembers its own spot; Ctrl M toggles the last one used.
- **Answer buttons**: when Rook asks you to choose (for example where to save a summary), the options appear as buttons. It ends such a reply with a `<choices>` block, which the app turns into buttons.
- **Changes and undo**: each edited note's chip has a Changes button showing a before/after diff, with "Put it back as it was". A copy of the note is kept before every edit (userData/backups, 30 days); a note Rook created is moved to the Recycle Bin instead.
- **Search**: Ctrl K opens a palette over note names, note text and saved chats.
- **Attachments**: drop, paste or pick files and screenshots; they are filed in the vault's attachment folder and Rook is told where they are.
- **Dictation**: the microphone button (Alt V) opens Windows voice typing on the ask box. Rook has no speech engine of its own.
- **/agent**: type `/agent` in the ask box for a popup with the model and an effort slider (passed to the CLI as `--model` / `--effort`).
- **Projects**: Settings → Projects names folders (WSL or Windows paths) so Rook goes straight to them.
- **Scheduled notes**: Settings → Scheduled notes. Daily notes on the weekdays you pick; a weekly review written by the agent on a chosen day and hour (`src/schedule.js`). Both need Rook running, which the tray takes care of.
- **Appearance**: dark, light or match Windows; text size small, regular or large.
- **Capture from anywhere**: Ctrl Alt C (changeable) adds the highlighted text in any app, or the clipboard if nothing is highlighted, to today's daily note with the time and the window it came from. No agent run.
- **Show Rook from anywhere**: Ctrl Alt Space (changeable) brings Rook forward or hides it, from any app.

## Background
Closing the window keeps Rook running in the system tray, so a reply in progress carries on. Click the tray icon to reopen; right-click it to quit.
Starting Rook again brings the running one forward.
Rook also starts with Windows, hidden in the tray (Settings → Startup turns this off; only the installed app registers itself).

## Shortcuts
Settings → Keyboard shortcuts: click a shortcut and press the new keys (Ctrl, Alt or the Windows key with another key, or a function key). Changes are saved in config.json as `keys`.

## Updates
Rook checks GitHub releases shortly after launch and every few hours. A newer version shows as an "Update available" button in the top bar:
clicking it downloads in the background and Rook restarts into the new version when the download is done (Settings → About has a manual check). The repo is private, so each check gets a token from `gh auth token` inside WSL; nothing is stored.
Publish a version with `make release` after bumping `version` and pushing main.

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
