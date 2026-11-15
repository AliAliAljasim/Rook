const test = require('node:test');
const assert = require('node:assert');
const { cleanExtras } = require('../src/settings');

const cur = { motion: 'on', hidden: [], seen: {}, mapShow: { changes: true }, instructions: '', allowMoves: true, allowDeletes: true, protect: [], dailyNote: '', dailyTemplate: '' };

test('new settings survive a save, cleaned', () => {
  const out = cleanExtras({ motion: 'off', hidden: ['Claude/', 'a/../b.md', 'Claude/', ' x.md '], mapShow: { files: 1 }, instructions: 'Be brief.',
    allowMoves: false, allowDeletes: 'no', protect: ['Claude/', '../etc'], dailyNote: '01 Daily/{YYYY}/{MM}/{YYYY}-{MM}-{DD}.md', dailyTemplate: 'Templates/daily.md' }, cur);
  assert.deepEqual(out, { motion: 'off', hidden: ['Claude/', 'x.md'], seen: {}, mapShow: { hidden: false, files: true, missing: false, changes: true }, instructions: 'Be brief.',
    allowMoves: false, allowDeletes: true, protect: ['Claude'], dailyNote: '01 Daily/{YYYY}/{MM}/{YYYY}-{MM}-{DD}.md', dailyTemplate: 'Templates/daily.md' });
});

test('missing fields keep what was saved; a daily location without a date falls back to the vault', () => {
  const kept = cleanExtras({}, { ...cur, motion: 'system', hidden: ['A/'], instructions: 'x', dailyNote: 'D/{YYYY}-{MM}-{DD}.md' });
  assert.equal(kept.motion, 'system'); assert.deepEqual(kept.hidden, ['A/']); assert.equal(kept.instructions, 'x'); assert.equal(kept.dailyNote, 'D/{YYYY}-{MM}-{DD}.md');
  assert.equal(cleanExtras({ dailyNote: 'Daily/today.md' }, cur).dailyNote, '');
});

test('seen notes keep only safe paths and real times', () => {
  const out = cleanExtras({ seen: { 'a/b.md': 5, '../x.md': 6, 'c.md': 'soon', 'd\\e.md': '7' } }, cur);
  assert.deepEqual(out.seen, { 'a/b.md': 5, 'd/e.md': 7 });
  assert.deepEqual(cleanExtras({}, { ...cur, seen: { 'k.md': 1 } }).seen, { 'k.md': 1 });
});
