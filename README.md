# Rook
A note-taking assistant for an Obsidian vault. Electron app (Windows) -> `wsl.exe` -> Claude Code CLI.
Writes are allowed only inside the vault; everything else is read-only.

## What it does
- **Chat**: ask about the vault or tell Rook what to write. Replies render as markdown; edited notes show as chips. The Chat home page lists saved chats (filter, pin, rename, delete with undo), stored locally in the app's userData folder.
- **Notes**: a folder tree with a Note/Map/Health toggle. Note is a read-only markdown viewer (frontmatter, callouts, nested lists, tables, wiki-links, linked notes). Map is a graph of notes (dots) and `[[links]]` (lines): drag, zoom, click a dot, double-click to open.
- **Health** (the third face of Notes): broken `[[links]]`, empty or Untitled notes, notes with no links in or out (daily notes, templates and CLAUDE.md are left out) and notes that share a name. Fixes: create the missing note (with Undo), move an empty note to the Recycle Bin, or hand the fix to Rook, whose edits show the usual Changes button.
- **Tasks** (Ctrl 3): every open `- [ ]` line in the vault, grouped by note, newest note first. Ticking one rewrites just that checkbox in the note. Templates/ is skipped.
- **Ask about this note**: "Ask Rook about this" in the viewer offers ready-made questions (summarize, find related notes, turn into tasks, what is missing). Highlight part of the note first and the question is about that passage.
- **Web clipping**: `/clip https://…`, or a message that is only a web address, fetches the page and has Rook write a summary note in Clippings/ with the source in its frontmatter. Rook fetches the page itself (`src/clip.js`) and passes its text to the agent, which cannot open pages itself.
- **Mini modes**: a side chat (narrow always-on-top panel showing the conversation) and a quick-capture bar. Each remembers its own spot; Ctrl M toggles the last one used.
- **Answer buttons**: when Rook asks you to choose (for example where to save a summary), the options appear as buttons. It ends such a reply with a `<choices>` block, which the app turns into buttons.
- **Changes and undo**: each edited note's chip has a Changes button showing a before/after diff, with "Put it back as it was". A copy of the note is kept before every edit (userData/backups, 30 days); a note Rook created is moved to the Recycle Bin instead.
- **Moving, renaming, deleting**: Rook has full control of the vault's files. The agent cannot change files with shell commands (a rule cannot keep `mv` or `rm` inside the vault), so it ends its reply with a `<files>` block and the app does each action through the vault guard (`src/moves.js`). Moves never overwrite; `[[links]]` that would break are rewritten, with a backup of each note changed, and one Undo puts moves and links back. Deletes go to the Recycle Bin. `.obsidian` and `.claude` are left alone.
- **Time and the web**: every run tells the agent the local date, time and time zone, so "today", "next Friday" and daily-note names are right, even in a chat resumed days later. It can search the web (Settings → Access → Web search) and names its sources with links.
- **Search**: Ctrl K opens a palette over note names, note text and saved chats.
- **Attachments**: drop, paste or pick files and screenshots; they are filed in the vault's attachment folder and Rook is told where they are. Removing one before sending moves its vault copy to the Recycle Bin.
- **Voice, hold to talk**: hold the microphone button (or Alt V), speak, let go; the words are typed into the ask box. Speech is transcribed on this PC by whisper.cpp (`src/voice.js`), which is downloaded once on request (about 157 MB: the engine from the whisper.cpp GitHub releases, the English "base" model from Hugging Face, each checked against a pinned SHA-256). Until then the button offers Windows voice typing.
- **/agent**: type `/agent` in the ask box for a popup with the model and an effort slider (passed to the CLI as `--model` / `--effort`).
- **Projects**: Settings → Projects names folders so Rook goes straight to them. Browse WSL opens the folder picker in the WSL home; a typed path can be `~/…`, `/home/…`, `C:\…` or `\\wsl.localhost\<distro>\…`. Each folder is checked inside WSL before it is saved.
- **Scheduled notes**: Settings → Scheduled notes. Daily notes on the weekdays you pick; a weekly review written by the agent on a chosen day and hour; and your own prompts (up to twelve), each with its days and hour, whose replies are kept as saved chats (`src/schedule.js`). All need Rook running, which the tray takes care of. With Rook on two PCs sharing a vault, schedule these on one of them only.
- **Notifications**: a Windows notification when a reply finishes while Rook is in the tray, minimized or behind other apps (Settings → Notifications turns it off). Clicking any Rook notification opens the window.
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
- The agent is denied WebFetch: with the whole PC readable, fetching any address it chooses could send a file's contents out. WebSearch is allowed unless Settings → Access → Web search is off; the instructions treat results as untrusted and keep private details out of queries. A clipped page reaches it as text inside the message, marked as source material whose instructions are not to be followed.

## Make targets
`make install` · `make check` · `make test` · `make dist` (builds the Windows installer from WSL; needs wine32) · `make release` · `make login`

`make dist` writes `dist/rook-setup-<version>.exe`.
`npx electron --no-sandbox scripts/shot.js <dir>` renders the UI with sample data and saves screenshots.
