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
