const test = require('node:test');
const assert = require('node:assert');
const { starterFiles, dailyFromObsidian, DAILY_PATTERN } = require('../src/starter');
const { workflowsIn } = require('../src/vaultscan');

test('the starter lays out folders, templates, memory, CLAUDE.md and Obsidian settings that agree with each other', () => {
  const files = starterFiles('2026-11-14'), rels = files.map((f) => f.rel);
  for (const r of ['00 Inbox/_README.md', '10 Archive/_README.md', 'Templates/Daily.md', 'Claude/Open Loops.md', 'CLAUDE.md', '.obsidian/daily-notes.json']) assert.ok(rels.includes(r), r);
  const daily = dailyFromObsidian(files.find((f) => f.rel === '.obsidian/daily-notes.json').content);
  assert.deepEqual(daily, { pattern: DAILY_PATTERN, template: 'Templates/Daily.md' });
  const md = files.find((f) => f.rel === 'CLAUDE.md').content;
  assert.deepEqual(workflowsIn(md).map((w) => w.label), ['Start my day', 'Evening check-in', 'Process today', 'Weekly review', 'Triage inbox', 'What do I think about ___?', 'Monthly reflection']);
  assert.ok(files.find((f) => f.rel === 'Claude/Log.md').content.includes('2026-11-14'));
});

test('Obsidian daily-notes settings become a Rook location when Rook can follow the format', () => {
  assert.deepEqual(dailyFromObsidian({ folder: 'Journal/', format: 'YYYY-MM-DD' }), { pattern: 'Journal/{YYYY}-{MM}-{DD}.md', template: '' });
  assert.equal(dailyFromObsidian({ format: 'dddd, D MMMM YYYY' }), null);
  assert.equal(dailyFromObsidian('not json'), null);
});
