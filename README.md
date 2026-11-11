# Vault Assistant
Electron chat app (Windows) -> `wsl.exe` -> Claude Code CLI. Writes allowed only in the Obsidian vault; everything else read-only.
Policy: src/policy.js (written to userData/policy.json at each run, outside the vault).
Run in Windows PowerShell from this folder (copy it to C: first, or use \\wsl$ path):
  npm install
  npm start         # dev
  npm run dist      # builds dist/vault-assistant-setup-0.1.0.exe (NSIS, per-user, like Groove)
