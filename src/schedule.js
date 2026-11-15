// Scheduled notes. Runs in the main process while Rook is open or sitting in the tray.
//   - Daily note: created where the vault keeps them (from its daily template when there is one) on the weekdays the user picked.
//   - Weekly review: written by the agent once a week, on the chosen day and hour; if the PC was off
//     at that moment it is written the next time Rook is running that week.
//   - The user's own prompts: each runs once on its days, at its hour or as soon as Rook is running
//     afterwards that day. The reply is handed to the window, which keeps it as a saved chat.
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekIndex = (day) => (day + 6) % 7; // Monday = 0 ... Sunday = 6

// ISO week of a date: { key: '2026-W46', monday: Date, sunday: Date }
function isoWeek(d) {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const monday = new Date(day); monday.setDate(day.getDate() - weekIndex(day.getDay()));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const thursday = new Date(monday); thursday.setDate(monday.getDate() + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const week1Monday = new Date(jan4); week1Monday.setDate(jan4.getDate() - weekIndex(jan4.getDay()));
  const week = 1 + Math.round((monday - week1Monday) / (7 * 86400e3));
  return { key: `${thursday.getFullYear()}-W${pad(week)}`, monday, sunday };
}

// True once the weekly moment (day + hour) of this week has passed.
function weeklyDue(now, weeklyDay, weeklyHour) {
  if (weeklyDay < 0) return false;
  const today = weekIndex(now.getDay()), target = weekIndex(weeklyDay);
  return today > target || (today === target && now.getHours() >= weeklyHour);
}

function weeklyPrompt(now) {
  const w = isoWeek(now);
  return [
    'This is a scheduled task. Nobody is at the keyboard, so do not ask questions and do not offer choices: decide and write.',
    `Write the weekly review for ISO week ${w.key} (${ymd(w.monday)} to ${ymd(w.sunday)}).`,
    `Find the notes created or changed this week (for example: find . -name '*.md' -newermt '${ymd(w.monday)}' -not -path './.*'), including any daily notes, and read the ones that matter.`,
    'If the user\'s instructions (the vault\'s CLAUDE.md) describe a weekly review, follow them: where it goes, its template and what it covers come before anything below.',
    `Put the review in Reviews/${w.key}.md, unless the vault already keeps weekly reviews somewhere else; then follow that place and its naming and layout. If this week's review already exists, update it rather than making a second one.`,
    'Cover: what got done, decisions made, what is still open, and what to pick up next week. Keep it tight and link the source notes with [[wiki-links]].',
    'If nothing changed this week, write a two-line review saying so.',
    'Reply with one line naming the note you wrote.'
  ].join('\n');
}

// One of the user's own prompts is due on its days once its hour has come, until it has run that day.
function promptDue(now, task, lastRun) {
  return task.days.includes(now.getDay()) && now.getHours() >= task.hour && lastRun !== ymd(now);
}
function customPrompt(task, now) {
  return [
    'This is a scheduled task the user set up. Nobody is at the keyboard, so do not ask questions and do not offer choices: decide and act.',
    `Today is ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]} ${ymd(now)}.`,
    'If the task produces something worth keeping and does not say where it goes, put it in the note that fits best (today\'s daily note when nothing else does).',
    'Reply with the result itself, kept short, and name any note you wrote or changed as a [[link]].',
    '',
    `The task, "${task.name}":`,
    task.prompt
  ].join('\n');
}

// ---- where daily notes live ----------------------------------------------------------
// A pattern like "01 Daily/{YYYY}/{MM}/{YYYY}-{MM}-{DD}.md". Users set it in Settings; when they have not, it is
// read off the daily notes already in the vault, so Rook files new ones where the user (and their CLAUDE.md) expect.
const DEFAULT_DAILY = 'Daily/{YYYY}-{MM}-{DD}.md';
function dailyRel(pattern, d) {
  return String(pattern || DEFAULT_DAILY).replace(/\{YYYY\}/g, String(d.getFullYear())).replace(/\{MM\}/g, pad(d.getMonth() + 1)).replace(/\{DD\}/g, pad(d.getDate()));
}
// rels: every note's vault path. The most common shape among notes named for a date wins; ties go to the newest.
function detectDaily(rels) {
  const seen = new Map();
  for (const rel of rels) {
    const m = /(?:^|\/)((\d{4})-(\d{2})-(\d{2}))\.md$/i.exec(rel);
    if (!m) continue;
    const [, , y, mo] = m, dir = rel.slice(0, rel.length - m[1].length - 3);
    // Folders named for the note's year (and a month folder right after it) become {YYYY} and {MM}.
    const segs = dir ? dir.slice(0, -1).split('/') : [];
    const shape = segs.map((seg, i) => (seg === y ? '{YYYY}' : seg === mo && segs[i - 1] === y ? '{MM}' : seg)).map((x) => x + '/').join('') + '{YYYY}-{MM}-{DD}.md';
    const cur = seen.get(shape) || { n: 0, last: '' };
    seen.set(shape, { n: cur.n + 1, last: m[1] > cur.last ? m[1] : cur.last });
  }
  let best = null;
  for (const [shape, v] of seen) if (!best || v.n > best.n || (v.n === best.n && v.last > best.last)) best = { shape, ...v };
  return best ? best.shape : DEFAULT_DAILY;
}
// The daily template: a note called "daily" (or "daily note") in a templates folder.
function detectTemplate(rels) {
  return rels.find((r) => /(^|\/)templates?\/daily( note)?\.md$/i.test(r)) || '';
}
// Fills Obsidian's core template variables: {{date}}, {{date:FORMAT}}, {{time}}, {{title}}, plus {{yesterday}}/{{tomorrow}}.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmt(d, f) {
  return String(f || 'YYYY-MM-DD').replace(/YYYY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm/g, (t) => ({
    YYYY: d.getFullYear(), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1,
    DD: pad(d.getDate()), D: d.getDate(), dddd: WEEKDAYS[d.getDay()], ddd: WEEKDAYS[d.getDay()].slice(0, 3), HH: pad(d.getHours()), mm: pad(d.getMinutes()) }[t]));
}
function fillTemplate(text, now, title) {
  const day = (k) => { const x = new Date(now); x.setDate(x.getDate() + k); return x; };
  return String(text)
    .replace(/\{\{date(?::([^}]*))?\}\}/g, (_, f) => fmt(now, f))
    .replace(/\{\{time(?::([^}]*))?\}\}/g, (_, f) => fmt(now, f || 'HH:mm'))
    .replace(/\{\{title\}\}/g, title || ymd(now))
    .replace(/\{\{yesterday\}\}/g, ymd(day(-1))).replace(/\{\{tomorrow\}\}/g, ymd(day(1)));
}

// Makes sure today's daily note exists, where the user keeps them, from their template when there is one.
// spec: { pattern, template } (see dailyRel / detectTemplate). Returns { rel, abs, created }.
function ensureDaily(cfg, now, resolveInside, spec = {}) {
  const rel = dailyRel(spec.pattern, now);
  const abs = resolveInside(cfg.vaultWin, rel);
  if (fs.existsSync(abs)) return { rel, abs, created: false };
  let body = `# ${ymd(now)}\n\n`;
  const tpl = spec.template === undefined ? 'Templates/daily.md' : spec.template;
  if (tpl) try { body = fillTemplate(fs.readFileSync(resolveInside(cfg.vaultWin, tpl), 'utf8'), now, path.basename(rel, '.md')); } catch { /* no template: a plain heading */ }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, { flag: 'wx' });
  return { rel, abs, created: true };
}

// One captured snippet as a line (or a quoted block) for the daily note.
function captureEntry(text, source, now) {
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const from = source ? ` — *from ${String(source).replace(/[\r\n*]+/g, ' ').trim().slice(0, 120)}*` : '';
  const t = String(text).replace(/\r\n?/g, '\n').trim().slice(0, 20000);
  if (!t.includes('\n') && t.length <= 240) return `- ${time} ${t}${from}\n`;
  return `- ${time}${from}\n${t.split('\n').map((l) => `  > ${l}`).join('\n')}\n`;
}

function start({ loadCfg, userFile, readJson, resolveInside, runAgent, notify, dailySpec = () => ({}) }) {
  const stateFile = () => userFile('schedule.json');
  const state = () => readJson(stateFile(), {});
  const save = (patch) => { try { fs.writeFileSync(stateFile(), JSON.stringify({ ...state(), ...patch })); } catch { /* best effort */ } };
  let running = false;

  function dailyNote(cfg, now) {
    if (!cfg.schedule.dailyDays.includes(now.getDay()) || now.getHours() < 5) return;
    const { rel, created } = ensureDaily(cfg, now, resolveInside, dailySpec(cfg));
    if (!created) return;
    notify('Daily note ready', rel);
  }

  async function weeklyReview(now, manual) {
    if (running) return { ok: false, text: 'A review is already being written.' };
    running = true;
    try {
      const key = isoWeek(now).key;
      const r = await runAgent(weeklyPrompt(now));
      if (r.ok) { save({ weekly: key }); notify(`Weekly review written (${key})`, r.text.split('\n')[0].slice(0, 160)); }
      else {
        save({ weeklyFailedOn: ymd(now) }); // try again tomorrow rather than every few minutes
        if (manual) notify('The weekly review could not be written', r.text.slice(0, 160) || 'Claude did not finish. Check that it is signed in inside WSL.');
      }
      return r;
    } finally { running = false; }
  }

  // Runs one of the user's prompts. A scheduled run is recorded for the day whether or not it worked,
  // so a failing prompt is tried again tomorrow rather than every few minutes.
  async function runPrompt(task, now, manual) {
    if (running) return { ok: false, busy: true, text: 'Another scheduled task is running. Try again when it has finished.' };
    running = true;
    try {
      const r = await runAgent(customPrompt(task, now));
      if (!manual) {
        const ids = new Set((loadCfg().schedule.prompts || []).map((t) => t.id)); // forget prompts that were removed
        const kept = Object.fromEntries(Object.entries(state().prompts || {}).filter(([id]) => ids.has(id)));
        save({ prompts: { ...kept, [task.id]: ymd(now) } });
      }
      const line = (r.text || '').split('\n').find((l) => l.trim()) || '';
      if (r.ok) notify(task.name, line.replace(/[#*`\[\]]/g, '').trim().slice(0, 160), { chat: { title: task.name, prompt: task.prompt, text: r.text, sessionId: r.sessionId || null } });
      else notify(`“${task.name}” could not run`, r.text.slice(0, 160) || 'Claude did not finish. Check that it is signed in inside WSL.');
      return r;
    } finally { running = false; }
  }

  function tick() {
    const cfg = loadCfg(), now = new Date();
    try { dailyNote(cfg, now); } catch { /* vault unavailable right now */ }
    const st = state();
    if (weeklyDue(now, cfg.schedule.weeklyDay, cfg.schedule.weeklyHour) && st.weekly !== isoWeek(now).key && st.weeklyFailedOn !== ymd(now)) {
      weeklyReview(now, false).catch(() => {});
    }
    // One at a time. A prompt that finds another task running is left for the next tick.
    const due = (cfg.schedule.prompts || []).filter((t) => promptDue(now, t, (st.prompts || {})[t.id]));
    if (due.length && !running) (async () => { for (const t of due) await runPrompt(t, new Date(), false); })().catch(() => {});
  }

  setTimeout(tick, 45e3);        // shortly after launch
  setInterval(tick, 5 * 60e3);   // then every five minutes
  return {
    runWeeklyNow: () => weeklyReview(new Date(), true),
    runPromptNow: (id) => {
      const task = (loadCfg().schedule.prompts || []).find((t) => t.id === id);
      return task ? runPrompt(task, new Date(), true) : { ok: false, text: 'That prompt is no longer in Settings.' };
    }
  };
}

module.exports = { start, isoWeek, weeklyDue, weeklyPrompt, promptDue, customPrompt, ensureDaily, captureEntry, dailyRel, detectDaily, detectTemplate, fillTemplate, DEFAULT_DAILY };
