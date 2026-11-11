// Scheduled notes. Runs in the main process while Rook is open or sitting in the tray.
//   - Daily note: created (from Templates/daily.md when there is one) on the weekdays the user picked.
//   - Weekly review: written by the agent once a week, on the chosen day and hour; if the PC was off
//     at that moment it is written the next time Rook is running that week.
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
    `Put the review in Reviews/${w.key}.md, unless the vault already keeps weekly reviews somewhere else; then follow that place and its naming and layout. If this week's review already exists, update it rather than making a second one.`,
    'Cover: what got done, decisions made, what is still open, and what to pick up next week. Keep it tight and link the source notes with [[wiki-links]].',
    'If nothing changed this week, write a two-line review saying so.',
    'Reply with one line naming the note you wrote.'
  ].join('\n');
}

// Makes sure today's daily note exists (from Templates/daily.md when there is one). Returns { rel, abs, created }.
function ensureDaily(cfg, now, resolveInside) {
  const rel = `Daily/${ymd(now)}.md`;
  const abs = resolveInside(cfg.vaultWin, rel);
  if (fs.existsSync(abs)) return { rel, abs, created: false };
  let body = `# ${ymd(now)}\n\n`;
  try {
    body = fs.readFileSync(path.join(cfg.vaultWin, 'Templates', 'daily.md'), 'utf8')
      .replace(/\{\{date(?::[^}]*)?\}\}/g, ymd(now)).replace(/\{\{title\}\}/g, ymd(now)).replace(/\{\{time(?::[^}]*)?\}\}/g, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
  } catch { /* no template: a plain heading */ }
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

function start({ loadCfg, userFile, readJson, resolveInside, runAgent, notify }) {
  const stateFile = () => userFile('schedule.json');
  const state = () => readJson(stateFile(), {});
  const save = (patch) => { try { fs.writeFileSync(stateFile(), JSON.stringify({ ...state(), ...patch })); } catch { /* best effort */ } };
  let running = false;

  function dailyNote(cfg, now) {
    if (!cfg.schedule.dailyDays.includes(now.getDay()) || now.getHours() < 5) return;
    const { rel, created } = ensureDaily(cfg, now, resolveInside);
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

  function tick() {
    const cfg = loadCfg(), now = new Date();
    try { dailyNote(cfg, now); } catch { /* vault unavailable right now */ }
    const st = state();
    if (weeklyDue(now, cfg.schedule.weeklyDay, cfg.schedule.weeklyHour) && st.weekly !== isoWeek(now).key && st.weeklyFailedOn !== ymd(now)) {
      weeklyReview(now, false).catch(() => {});
    }
  }

  setTimeout(tick, 45e3);        // shortly after launch
  setInterval(tick, 5 * 60e3);   // then every five minutes
  return { runWeeklyNow: () => weeklyReview(new Date(), true) };
}

module.exports = { start, isoWeek, weeklyDue, weeklyPrompt, ensureDaily, captureEntry };
