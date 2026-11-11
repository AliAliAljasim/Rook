// Builds the Claude Code permission policy. Read-only everywhere except the vault.
// In `claude -p` mode anything not allowed is denied, so writes outside the vault fail.
function buildPolicy(vaultWsl) {
  const v = `//${vaultWsl}`; // permission rules use "//abs/path" for absolute paths
  return {
    permissions: {
      defaultMode: 'default',
      allow: [
        'Read', 'Glob', 'Grep',
        `Edit(${v}/**)`, // Edit rules cover Write too
        'Bash(ls:*)', 'Bash(date:*)', 'Bash(pwd)', 'Bash(wc:*)',
        'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)'
      ],
      deny: [
        // the agent must not rewrite its own guard rails or Obsidian config
        `Edit(${v}/.claude/**)`,
        `Edit(${v}/.obsidian/**)`,
        'WebFetch', 'WebSearch',
        'Bash(rm:*)', 'Bash(mv:*)', 'Bash(cp:*)', 'Bash(sudo:*)'
      ]
    }
  };
}

const SYSTEM_PROMPT = (vaultWsl) => `
You are the user's personal note-taking assistant. Your home is the Obsidian vault at ${vaultWsl}.
- You may create/edit files ONLY inside the vault. Everything else on this machine (WSL and Windows, e.g. /mnt/c) is READ-ONLY; use it to observe, never to change.
- Notes are Markdown with [[wiki-links]]. Daily notes go in Daily/YYYY-MM-DD.md (use Templates/daily.md). Project notes go in Projects/<name>/.
- When asked to make observations, read the relevant files (read-only), then write a concise note into the vault linking to sources.
- Don't read the whole vault; grep first. Say plainly when something was refused due to read-only rules.
`.trim();

module.exports = { buildPolicy, SYSTEM_PROMPT };
