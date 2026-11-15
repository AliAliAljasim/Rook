const test = require('node:test');
const assert = require('node:assert');
const { buildPolicy, SYSTEM_PROMPT } = require('../src/policy');

test('web search is a setting; opening pages (WebFetch) is always denied', () => {
  const on = buildPolicy('mnt/c/V', 'machine', { webSearch: true }).permissions;
  assert.ok(on.allow.includes('WebSearch') && !on.deny.includes('WebSearch'));
  assert.ok(on.deny.includes('WebFetch') && !on.allow.includes('WebFetch'));
  const off = buildPolicy('mnt/c/V', 'vault', { webSearch: false }).permissions;
  assert.ok(off.deny.includes('WebSearch') && off.deny.includes('WebFetch') && !off.allow.includes('WebSearch'));
});

test('the instructions carry the local time and say what the web allows', () => {
  const p = SYSTEM_PROMPT('/mnt/c/V', 'machine', { now: 'Thursday 12 November 2026, 14:05 (Europe/London, UTC+00:00)', webSearch: true });
  assert.match(p, /It is now Thursday 12 November 2026, 14:05/);
  assert.match(p, /search the web with the WebSearch tool/);
  assert.match(SYSTEM_PROMPT('/mnt/c/V', 'machine', { webSearch: false }), /no web access/);
});

test('the user sets the rules: their instructions and limits reach the agent, protected paths are denied', () => {
  const { buildPolicy, SYSTEM_PROMPT, isProtected } = require('../src/policy');
  const p = buildPolicy('mnt/c/V', 'vault', { protect: ['Claude/', ' 05 Areas/R.md ', '../etc'] });
  assert.ok(p.permissions.deny.includes('Edit(//mnt/c/V/Claude/**)'));
  assert.ok(p.permissions.deny.includes('Edit(//mnt/c/V/05 Areas/R.md)'));
  assert.ok(!p.permissions.deny.some((r) => r.includes('..')));
  assert.ok(isProtected('claude/Log.md', ['Claude']) && isProtected('Claude', ['Claude/']) && !isProtected('Claudette.md', ['Claude']));
  const s = SYSTEM_PROMPT('/mnt/c/V', 'vault', { instructions: 'Reply in bullets.', allowDeletes: false, protect: ['Claude'], daily: { today: '01 Daily/2026/11/2026-11-14.md', pattern: '01 Daily/{YYYY}/{MM}/{YYYY}-{MM}-{DD}.md', template: '' } });
  assert.ok(s.includes('Reply in bullets.') && s.indexOf('Reply in bullets.') > s.indexOf('## Defaults'));
  assert.ok(s.includes('Deleting is turned off') && !s.includes('- delete Scratch.md'));
  assert.ok(s.includes('01 Daily/2026/11/2026-11-14.md') && !s.includes('Daily/YYYY-MM-DD.md'));
  assert.ok(s.includes('you cannot change, move or delete anything in them: Claude'));
});
