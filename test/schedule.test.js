const test = require('node:test');
const assert = require('node:assert');
const { isoWeek, weeklyDue, weeklyPrompt } = require('../src/schedule');

test('ISO week numbers, including the year boundary', () => {
  assert.equal(isoWeek(new Date(2026, 10, 11)).key, '2026-W46'); // Wed 11 Nov 2026
  assert.equal(isoWeek(new Date(2026, 11, 31)).key, '2026-W53'); // Thu 31 Dec 2026
  assert.equal(isoWeek(new Date(2027, 0, 3)).key, '2026-W53');   // Sun 3 Jan 2027 still belongs to 2026's last week
  assert.equal(isoWeek(new Date(2027, 0, 4)).key, '2027-W01');
  const w = isoWeek(new Date(2026, 10, 11));
  assert.equal(w.monday.getDate(), 9);
  assert.equal(w.sunday.getDate(), 15);
});

test('the weekly review is due from its day and hour until the week ends', () => {
  const wed3pm = new Date(2026, 10, 11, 15);
  assert.equal(weeklyDue(wed3pm, -1, 0), false);  // off
  assert.equal(weeklyDue(wed3pm, 3, 16), false);  // Wednesday 16:00 has not come yet
  assert.equal(weeklyDue(wed3pm, 3, 15), true);   // Wednesday 15:00 has
  assert.equal(weeklyDue(wed3pm, 2, 23), true);   // Tuesday was missed: still due this week
  assert.equal(weeklyDue(wed3pm, 4, 9), false);   // Thursday is ahead
  assert.equal(weeklyDue(wed3pm, 0, 9), false);   // Sunday is the end of the week, not the start
  assert.equal(weeklyDue(new Date(2026, 10, 15, 10), 0, 9), true);
});

test('the weekly prompt names the week and tells the agent not to ask questions', () => {
  const p = weeklyPrompt(new Date(2026, 10, 11));
  assert.match(p, /2026-W46 \(2026-11-09 to 2026-11-15\)/);
  assert.match(p, /do not ask questions/);
  assert.match(p, /Reviews\/2026-W46\.md/);
});

test('a captured snippet becomes a line, or a quoted block when it is long or multi-line', () => {
  const { captureEntry } = require('../src/schedule');
  const at = new Date(2026, 10, 11, 9, 5);
  assert.equal(captureEntry('  https://example.com  ', 'Docs - Edge', at), '- 09:05 https://example.com — *from Docs - Edge*\n');
  assert.equal(captureEntry('one\r\ntwo', 'Mail', at), '- 09:05 — *from Mail*\n  > one\n  > two\n');
  assert.equal(captureEntry('x', '', at), '- 09:05 x\n');
});

test('one of the user\'s own prompts is due on its days from its hour, until it has run that day', () => {
  const { promptDue, customPrompt } = require('../src/schedule');
  const task = { id: 'p1', name: 'Morning brief', prompt: 'List what is open.', days: [1, 3], hour: 9 };
  const wed = (h) => new Date(2026, 10, 11, h); // Wednesday
  assert.equal(promptDue(wed(8), task, undefined), false);        // before its hour
  assert.equal(promptDue(wed(9), task, undefined), true);
  assert.equal(promptDue(wed(17), task, '2026-11-09'), true);     // PC was off at nine: still due later that day
  assert.equal(promptDue(wed(17), task, '2026-11-11'), false);    // already ran today
  assert.equal(promptDue(new Date(2026, 10, 12, 12), task, undefined), false); // Thursday is not one of its days
  const p = customPrompt(task, wed(9));
  assert.match(p, /do not ask questions/);
  assert.match(p, /Wednesday 2026-11-11/);
  assert.match(p, /"Morning brief":\nList what is open\.$/);
});
