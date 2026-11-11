const test = require('node:test');
const assert = require('node:assert');
const { pageText, fetchPage, decode } = require('../src/clip');

const para = 'Proofs are due on Friday and the printer wants the final manuscript a week before that. '.repeat(6);
const PAGE = `<!doctype html><html><head><title>Old &amp; tired title</title><meta property="og:title" content="Printing a book &#8212; a guide">
<style>p { color: red }</style><script>var x = "<p>not text</p>";</script></head><body>
<header><a href="/">Site name</a></header><nav><ul><li>Home</li><li>About</li></ul></nav>
<article><h1>Printing a book</h1><p>${para}</p><h2>Costs</h2><ul><li>Print run&nbsp;4,200</li><li>Proofs <b>380</b></li></ul>
<p>Read <a href="https://example.com/more">the rest</a>.<br>Second line.</p><aside>Related: buy our course</aside></article>
<footer>Copyright &copy; 2026</footer><!-- a comment --></body></html>`;

test('entities are decoded, unknown ones are left alone', () => {
  assert.equal(decode('a &amp; b &lt;c&gt; &#65;&#x42; &nbsp;&mdash; &unknown;'), 'a & b <c> AB  — &unknown;');
});

test('a page becomes its title and the readable text of its article', () => {
  const p = pageText(PAGE);
  assert.equal(p.title, 'Printing a book — a guide');
  assert.equal(p.truncated, false);
  assert.match(p.text, /^## Printing a book\n\nProofs are due on Friday/);
  assert.match(p.text, /### Costs\n\n- Print run 4,200\n- Proofs 380/);
  assert.match(p.text, /Read the rest\.\nSecond line\./);
  for (const gone of ['Site name', 'Home', 'Copyright', 'not text', 'color: red', 'buy our course', 'a comment', '<']) assert.ok(!p.text.includes(gone), gone);
});

test('a page with no article falls back to the whole body, without header and footer', () => {
  const p = pageText('<html><head><title>T</title></head><body><header>Top bar</header><div><p>First.</p><p>Second.</p></div><footer>Bottom</footer></body></html>');
  assert.equal(p.title, 'T');
  assert.equal(p.text, 'First.\n\nSecond.');
});

test('very long pages are cut and say so', () => {
  const p = pageText(`<body><p>${'word '.repeat(20000)}</p></body>`);
  assert.equal(p.text.length, 60000);
  assert.equal(p.truncated, true);
});

const respond = (body, { status = 200, type = 'text/html; charset=utf-8' } = {}) => async (u) =>
  Object.defineProperty(new Response(body, { status, headers: { 'content-type': type } }), 'url', { value: u });

test('fetching: only web addresses, only pages, and only ones with text in them', async () => {
  assert.equal((await fetchPage('not a url', respond(PAGE))).ok, false);
  assert.match((await fetchPage('file:///etc/passwd', respond(PAGE))).reason, /Only http and https/);
  assert.match((await fetchPage('https://example.com/x', respond('nope', { status: 404 }))).reason, /404/);
  assert.match((await fetchPage('https://example.com/x.pdf', respond('%PDF', { type: 'application/pdf' }))).reason, /not a web page/);
  assert.match((await fetchPage('https://example.com/app', respond('<html><body><div id="root"></div></body></html>'))).reason, /No readable text/);
  assert.match((await fetchPage('https://example.com/x', async () => { throw new Error('offline'); })).reason, /could not be reached/);
  const ok = await fetchPage(' https://example.com/book ', respond(PAGE));
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://example.com/book');
  assert.equal(ok.title, 'Printing a book — a guide');
  assert.match(ok.text, /Proofs are due on Friday/);
});
