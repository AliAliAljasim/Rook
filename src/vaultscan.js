// Scans over the text of the vault's notes: the tasks list and the health check.
// Everything here works on strings, so it is tested without a vault (test/vaultscan.test.js).

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const DATED = /^\d{4}-\d{2}-\d{2}$/;
const baseKey = (rel) => rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, '').toLowerCase();
const inTemplates = (rel) => /^templates\//i.test(rel);
const UNTITLED = /^untitled( \d+)?$/;
const AGENT_FILE = /^(claude|agents)$/; // CLAUDE.md and AGENTS.md are instructions for the agent, not notes that should be linked

// Calls fn(line, index) for every line that is not inside a fenced code block.
function eachLine(text, fn) {
  let fence = null;
  String(text).split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const f = FENCE.exec(line);
    if (f) { fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1]; return; }
    if (!fence) fn(line, i);
  });
}

// ---- tasks: "- [ ] text" lines -------------------------------------------------------
function tasksIn(text) {
  const out = [];
  eachLine(text, (line, i) => {
    const m = TASK.exec(line);
    if (m && m[3].trim()) out.push({ line: i, done: m[2] !== ' ', text: m[3].trim() });
  });
  return out;
}

// Ticks or unticks one task. `want` is { line, text, done } with done the state to end up in.
// The note may have changed since it was listed, so the line is found again by its text, nearest first.
// Returns { content, line }, or null when that task is no longer there.
function setTask(content, want) {
  const lines = String(content).split('\n');
  const fits = (i) => {
    const m = TASK.exec((lines[i] || '').replace(/\r$/, ''));
    return !!m && m[3].trim() === want.text && (m[2] !== ' ') !== want.done;
  };
  let at = -1;
  if (fits(want.line)) at = want.line;
  else {
    for (let d = 1; d < lines.length && at < 0; d++) {
      if (fits(want.line - d)) at = want.line - d;
      else if (fits(want.line + d)) at = want.line + d;
    }
  }
  if (at < 0) return null;
  lines[at] = lines[at].replace(/\[[ xX]\]/, want.done ? '[x]' : '[ ]');
  return { content: lines.join('\n'), line: at };
}

// ---- links ---------------------------------------------------------------------------
// Resolves a [[link]] to a note the way Obsidian does: full path first, then the name, shortest path winning.
function noteIndex(files) {
  const byBase = new Map(), byPath = new Map();
  for (const f of files) {
    byPath.set(f.rel.replace(/\.md$/i, '').toLowerCase(), f.rel);
    const k = baseKey(f.rel), cur = byBase.get(k);
    if (!cur || f.rel.length < cur.length) byBase.set(k, f.rel);
  }
  return (name) => {
    const n = String(name).split('#')[0].split('|')[0].trim().replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase();
    if (!n) return null;
    return byPath.get(n) || byBase.get(n.slice(n.lastIndexOf('/') + 1)) || null;
  };
}

// The [[targets]] a note links to, with the line each is on. Code is skipped, and so are links to a
// heading in the same note ([[#Heading]]) and template placeholders ([[{{date}}]]).
function linksIn(text) {
  const out = [];
  eachLine(text, (line, i) => {
    const re = /\[\[([^\]\n]+)\]\]/g, plain = line.replace(/`[^`]*`/g, (c) => ' '.repeat(c.length));
    let m;
    while ((m = re.exec(plain))) {
      const target = m[1].split('|')[0].split('#')[0].trim();
      if (target && !target.includes('{{')) out.push({ target, line: i });
    }
  });
  return out;
}

// A note with nothing in it: no text besides frontmatter, comments and a heading that repeats its name.
function isEmptyNote(rel, text) {
  const title = baseKey(rel);
  const body = String(text).replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/%%[\s\S]*?%%/g, '').replace(/<!--[\s\S]*?-->/g, '');
  return !body.split('\n').some((l) => {
    const t = l.trim();
    return t && t.replace(/^#{1,6}\s+/, '').trim().toLowerCase() !== title;
  });
}

// The health check. notes: [{ rel, text }]; otherFiles: lower-cased paths of everything in the vault that is not a note.
function health(notes, otherFiles = []) {
  const resolve = noteIndex(notes);
  const others = new Set();
  for (const f of otherFiles) { const p = String(f).toLowerCase(); others.add(p); others.add(p.slice(p.lastIndexOf('/') + 1)); }
  const isFile = (target) => { const t = target.replace(/\\/g, '/').toLowerCase(); return others.has(t) || others.has(t.slice(t.lastIndexOf('/') + 1)); };
  const linked = new Set(); // notes with at least one link in or out
  const broken = [], empty = [];
  for (const n of notes) {
    if (inTemplates(n.rel)) continue;
    const seen = new Set();
    for (const l of linksIn(n.text)) {
      const to = resolve(l.target);
      if (to) { if (to !== n.rel) { linked.add(n.rel); linked.add(to); } continue; }
      if (isFile(l.target)) continue;
      const key = l.target.toLowerCase();
      if (!seen.has(key)) { seen.add(key); broken.push({ file: n.rel, target: l.target, line: l.line }); }
    }
    const untitled = UNTITLED.test(baseKey(n.rel)), blank = isEmptyNote(n.rel, n.text);
    if (untitled || blank) empty.push({ file: n.rel, empty: blank, untitled });
  }
  // Daily notes stand on their own by design, so a date for a name is not reported as unlinked.
  const listed = new Set(empty.map((e) => e.file));
  const orphans = notes.filter((n) => !inTemplates(n.rel) && !linked.has(n.rel) && !listed.has(n.rel) && !DATED.test(baseKey(n.rel)) && !AGENT_FILE.test(baseKey(n.rel))).map((n) => n.rel);
  const groups = new Map();
  for (const n of notes) { const k = baseKey(n.rel); if (!UNTITLED.test(k)) groups.set(k, [...(groups.get(k) || []), n.rel]); } // untitled notes are already listed above
  const duplicates = [...groups.values()].filter((g) => g.length > 1).map((files) => ({ name: files[0].slice(files[0].lastIndexOf('/') + 1).replace(/\.md$/i, ''), files: files.sort() }));
  return { notes: notes.length, broken, empty, orphans, duplicates };
}

// Where the note for a broken link goes: the path the link gives, or next to the note that links to it.
// Returns a vault-relative .md path, or null when the link cannot be a file name.
function linkNotePath(from, target) {
  const clean = (s) => s.replace(/[<>:"|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const parts = String(target).replace(/\\/g, '/').replace(/\.md$/i, '').split('/').map(clean);
  if (!parts.length || parts.some((p) => !p || p === '.' || p === '..')) return null;
  const dir = parts.length > 1 ? '' : String(from).slice(0, String(from).lastIndexOf('/') + 1);
  return `${dir}${parts.join('/')}.md`.slice(0, 240);
}

module.exports = { tasksIn, setTask, noteIndex, linksIn, isEmptyNote, health, linkNotePath, baseKey, inTemplates };
