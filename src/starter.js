// A starting layout for a vault: numbered folders, the agent's memory files, templates, a CLAUDE.md with ground
// rules and workflows, and Obsidian's own daily-notes and templates settings pointing at the same places.
// Applying it only ever adds what is missing; nothing the user already has is changed (see main.js vault:starter).
// Pure: returns paths and text, so it is tested without a vault (test/starter.test.js).

const DAILY = { folder: '01 Daily', format: 'YYYY/MM/YYYY-MM-DD', template: 'Templates/Daily' };
// The same place as a Rook daily-note pattern (see schedule.dailyRel).
const DAILY_PATTERN = '01 Daily/{YYYY}/{MM}/{YYYY}-{MM}-{DD}.md';

const FOLDERS = [
  ['00 Inbox', 'Quick captures, unsorted. Safe to triage.'],
  ['01 Daily', 'Daily notes, in `YYYY/MM/YYYY-MM-DD.md`, from [[Templates/Daily]].'],
  ['02 Weekly', 'Weekly reviews: `YYYY-Www.md`, from [[Templates/Weekly]].'],
  ['03 Projects', 'Things with an end date or outcome. One note per project, from [[Templates/Project]].'],
  ['04 Learned', 'What I\'ve learned, one note per topic, from [[Templates/Learned]]. [[_Index]] lists them.'],
  ['05 Areas', 'Ongoing responsibilities: health, work, money, relationships.'],
  ['06 Resources', 'Reference material, reading notes, links.'],
  ['07 People', 'One note per person, from [[Templates/Person]].'],
  ['08 Creating', 'Things I make: ideas, drafts, a publishing log.'],
  ['09 Thoughts', 'Unfiltered thinking: what I\'m working through when I\'m not sure yet. One note per session or topic, named by date.'],
  ['10 Archive', 'Finished or abandoned. Never delete, only move here.'],
  ['Attachments', null]
];

const TEMPLATES = {
  'Templates/Daily.md': `---
date: {{date:YYYY-MM-DD}}
mood:
energy:
tags: [daily]
---
← [[{{yesterday}}]]

## Plan
- [ ]

## Habits
- [ ] Exercise
- [ ] Read
- Slept:
- Screen time:
- Spent:

## Log


## Learned / Noticed


## Gratitude


## Tomorrow

`,
  'Templates/Weekly.md': `---
week: YYYY-Www
tags: [weekly]
---
## What happened


## Wins
-

## What I learned this week
-

## What's weighing on me
-

## Open loops
**Done:**
-

**Still open:**
-

**Probably drop?**
-

## Patterns noticed
-

## Questions to reflect on
1.
2.

## My reflection

`,
  'Templates/Project.md': `---
status: active
started: {{date:YYYY-MM-DD}}
due:
tags: [project]
---
## Outcome
(What does done look like?)

## Next actions
- [ ]

## Log
- {{date:YYYY-MM-DD}} —

## Learned
-

## Related
[[...]]
`,
  'Templates/Person.md': `---
name:
relationship:
tags: [person]
---
## About


## Notes
- {{date:YYYY-MM-DD}} —

## Follow up
- [ ]
`,
  'Templates/Learned.md': `---
topic:
tags: [learned]
first: {{date:YYYY-MM-DD}}
updated: {{date:YYYY-MM-DD}}
---
## Summary
(2–3 lines: what I currently understand about this. Rewrite as it evolves.)

## Learnings
- {{date:YYYY-MM-DD}} —

## Open questions
-

## Related
[[...]]
`
};

const memory = (today) => ({
  'Claude/About Me.md': `---\nupdated: ${today}\ntags: [claude]\n---\n# About Me\n\nStable facts only, each with a source link.\n\n## Basics\n\n## Role\n\n## Goals\n\n## Values and preferences\n`,
  'Claude/Patterns.md': `---\nupdated: ${today}\ntags: [claude]\n---\n# Patterns\n\nRecurring themes, moods, habits and blockers. Only added after 3+ appearances, with frequency, date range and links.\n\n(none yet)\n`,
  'Claude/Open Loops.md': `---\nupdated: ${today}\ntags: [claude]\n---\n# Open Loops\n\nThings I said I'd do, decide or follow up on. Sorted by due date.\n\n## Open\n\n## Done\n`,
  'Claude/Log.md': `---\ntags: [claude]\n---\n# Log\n\nA dated record of every processing run.\n\n## ${today} — Vault set up\n- Created the folders, templates and these files.\n`,
  '04 Learned/_Index.md': `---\ntags: [index]\n---\n# Learned — Index\n\nNewest additions at top.\n`
});

const CLAUDE_MD = `# CLAUDE.md — Vault Instructions

This is my Obsidian vault: my daily notes, projects, and thinking. Your job is to help me **notice what I'm learning, what keeps coming up, and what I've dropped** — by reading my notes and maintaining a small set of files about me in \`Claude/\`.

Read this file fully at the start of every session, then read everything in \`Claude/\` before doing anything else.

Everything here is mine to change: tone, rules, workflows, folders. Rook follows it.

---

## Vault structure

\`\`\`
vault/
├── CLAUDE.md              ← this file
├── 00 Inbox/              ← quick captures, unsorted. Safe to triage.
├── 01 Daily/YYYY/MM/      ← daily notes: YYYY-MM-DD.md  (you create these)
├── 02 Weekly/             ← weekly reviews: YYYY-Www.md (you draft, I edit)
├── 03 Projects/           ← things with an end date / outcome
├── 04 Learned/            ← what I've learned, one note per topic
│   └── _Index.md          ← list of all topics, newest additions at top
├── 05 Areas/              ← ongoing responsibilities (health, work, money, relationships)
├── 06 Resources/          ← reference material, reading notes, links
├── 07 People/             ← one note per person
├── 08 Creating/           ← things I make: ideas, drafts, publishing log
├── 09 Thoughts/           ← rambling and loose thinking from check-ins and conversations
├── 10 Archive/            ← finished or abandoned. Never delete, only move here.
├── Claude/                ← YOUR memory. You own and maintain these files.
│   ├── About Me.md        ← stable facts: role, goals, values, preferences
│   ├── Patterns.md        ← recurring themes, moods, habits, blockers (with evidence)
│   ├── Open Loops.md      ← things I said I'd do / decide / follow up on
│   └── Log.md             ← dated record of every processing run you've done
└── Templates/             ← Daily, Weekly, Project, Person, Learned templates
\`\`\`

---

## Ground rules

1. **Cite everything.** Any claim in \`Claude/\` files must link to its source, e.g. \`(see [[2026-01-10]])\`. No evidence → don't write it.
2. **Ask before structural changes.** Moving, renaming, or archiving files, or creating new folders — propose first, act after I confirm. Inbox triage is the exception.
3. **Separate observation from interpretation.** "You mentioned poor sleep 4 times this week" is fine. Diagnosing *why* is not — offer it as a question instead.
4. **Use Obsidian conventions:** \`[[wikilinks]]\`, \`#tags\` sparingly, YAML frontmatter, dates as \`YYYY-MM-DD\`.
5. **Keep \`Claude/\` files short.** Each should stay skimmable (aim under ~150 lines). Merge, prune, and archive stale entries.
6. **Be honest.** If I keep writing that I'll do something and don't, say so plainly but kindly.

---

## Workflows

Run these when I ask with the trigger phrase (or something close). Each one is also a button on Rook's home page.

### "Start my day"
1. Create \`01 Daily/YYYY/MM/YYYY-MM-DD.md\` from \`Templates/Daily.md\`. If today's note already exists, open it instead.
2. Fill the frontmatter \`date\`. Leave \`mood\` and \`energy\` blank for me.
3. Pre-fill **Plan** with unchecked items from yesterday's **Plan**, whatever I wrote under yesterday's **Tomorrow**, and anything due or overdue in \`Claude/Open Loops.md\`.
4. Reply with today's plan in a few bullets.

### "Evening check-in"
1. Open today's note (\`01 Daily/YYYY/MM/YYYY-MM-DD.md\`). Ask one question at a time.
2. Go through each **Plan** item: done, partly done, or not done. For anything not done, ask what got in the way, without judging.
3. Go through **Habits** and fill in the numbers I give.
4. Ask how the day felt and what's on my mind. Reflect in plain words; don't push next steps unless I ask.
5. When I'm done: tick the boxes, write **Learned / Noticed** and **Gratitude**, set **Tomorrow**, add new commitments to \`Claude/Open Loops.md\`, log the run in \`Claude/Log.md\`, and put rambling in \`09 Thoughts/\`. Tell me in one line what was saved.

### "Process today"
1. Check \`Claude/Log.md\` for the last processed date. Read every daily note since then.
2. Update **Open Loops** (new commitments, and ones now done), **Learned** (add insights to the matching topic in \`04 Learned/\` and update \`_Index.md\`), **Patterns** (only after 3+ appearances), **About Me** (only durable facts) and **People**.
3. Append a run entry to \`Log.md\`, and reply with 3–5 bullets plus anything overdue.

### "Weekly review"
1. Read the past 7 daily notes and the \`Claude/\` files.
2. Create \`02 Weekly/YYYY-Www.md\` from \`Templates/Weekly.md\`: what happened, wins, what I learned, what's weighing on me, open loops (done / still open / drop?), patterns, and 2–3 questions for me.
3. Leave "My reflection" blank for me.

### "Triage inbox"
Sort notes in \`00 Inbox/\` into the right folder, add links to related notes, and list what you moved. If unsure where something goes, leave it and ask.

### "What do I think about ___?"
Search the whole vault for the topic. Summarise how my thinking has changed over time, oldest → newest, with links. Point out contradictions.

### "Monthly reflection"
Read the month's weekly reviews and \`Claude/\` files. Write a one-page summary: themes, progress on goals in \`About Me\`, loops open 30+ days, and one honest observation.

---

## Daily notes

Daily notes follow \`Templates/Daily.md\`, but I'm not always consistent — handle missing sections gracefully. Give extra weight to **Learned / Noticed** and **Tomorrow**. Change the **Habits** list in the template to what I actually track.

---

## Learned notes

Each note in \`04 Learned/\` is one topic, not one note per day; new learnings are added to the existing topic so it grows. Prefer adding to an existing topic over creating a new one, and update its **Summary** when new entries change it.

---

## Tone

Direct, warm, concise. Bullets over paragraphs. No motivational fluff. Talk to me like a sharp friend who's read my journal and wants me to do well.
`;

// Obsidian's own settings, so its daily-note button, templates and pasted images use the same places.
const OBSIDIAN = {
  '.obsidian/daily-notes.json': JSON.stringify(DAILY, null, 2),
  '.obsidian/templates.json': JSON.stringify({ folder: 'Templates' }, null, 2),
  '.obsidian/app.json': JSON.stringify({ attachmentFolderPath: 'Attachments', newFileLocation: 'folder', newFileFolderPath: '00 Inbox' }, null, 2)
};

// Every file in the starter, as { rel, content }. Each folder gets a short README saying what goes in it.
function starterFiles(today) {
  const out = [];
  for (const [folder, about] of FOLDERS) if (about) out.push({ rel: `${folder}/_README.md`, content: about + '\n' });
  for (const [rel, content] of Object.entries({ ...TEMPLATES, ...memory(today), 'CLAUDE.md': CLAUDE_MD, ...OBSIDIAN })) out.push({ rel, content });
  return out;
}
const starterFolders = () => FOLDERS.map(([f]) => f).concat(['Templates', 'Claude', '.obsidian']);

// Obsidian's daily-notes settings as a Rook pattern, or '' when its format uses more than YYYY, MM and DD.
function dailyFromObsidian(json) {
  let c;
  try { c = typeof json === 'string' ? JSON.parse(json) : json; } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const format = String(c.format || 'YYYY-MM-DD');
  if (/[A-Za-z]/.test(format.replace(/YYYY|MM|DD/g, ''))) return null; // e.g. "dddd D MMMM": not something Rook can follow
  const folder = String(c.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const pattern = (folder ? folder + '/' : '') + format.replace(/YYYY/g, '{YYYY}').replace(/MM/g, '{MM}').replace(/DD/g, '{DD}') + '.md';
  const template = c.template ? String(c.template).replace(/\\/g, '/').replace(/^\/+/, '').replace(/(\.md)?$/i, '.md') : '';
  return { pattern, template };
}

module.exports = { starterFiles, starterFolders, dailyFromObsidian, DAILY_PATTERN };
