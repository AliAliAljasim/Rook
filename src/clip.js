// Web clipping. Rook itself fetches the page and hands its text to the agent, so the agent stays
// without opening pages itself (WebFetch remains denied in src/policy.js; WebSearch is a setting).
// pageText() turns HTML into plain readable text with no DOM; it is tested in test/clip.test.js.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', laquo: '«', raquo: '»', euro: '€', pound: '£', deg: '°' };
const codePoint = (n) => { try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; } catch { return ''; } };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, e) => {
  if (e[0] !== '#') return Object.prototype.hasOwnProperty.call(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : all;
  return codePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const dropBlocks = (html, tags) => html.replace(new RegExp(`<(${tags})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), ' ');

function toText(html) {
  return decode(html
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n\n${'#'.repeat(Math.min(4, Number(n) + 1))} `)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|h[1-6]|ul|ol|table|tr|blockquote|pre|figure|figcaption|dd|dt)\s*>/gi, '\n\n')
    .replace(/<(p|div|section|tr|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' | ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t\f\v ]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter((l) => l !== '-').join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

const MAX_TEXT = 60000;
// { title, text, truncated } from a page's HTML. The article or main part is used when the page marks one.
function pageText(html) {
  const src = String(html);
  const meta = /<meta\b[^>]*property=["']og:title["'][^>]*>/i.exec(src);
  const og = meta && /content=["']([^"']*)["']/i.exec(meta[0]);
  const tt = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(src);
  const title = decode((og && og[1]) || (tt && tt[1]) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  let body = dropBlocks(src.replace(/<!--[\s\S]*?-->/g, ' '), 'script|style|noscript|svg|template|iframe|head|select|button');
  body = dropBlocks(body, 'nav|aside|form');
  const whole = toText(dropBlocks(body, 'header|footer'));
  let text = whole;
  for (const tag of ['article', 'main']) {
    const a = body.search(new RegExp(`<${tag}\\b`, 'i')), b = body.toLowerCase().lastIndexOf(`</${tag}`);
    if (a < 0 || b <= a) continue;
    const part = toText(body.slice(a, b));
    if (part.length >= 400 || part.length * 3 >= whole.length) { text = part; break; } // a tiny <article> is a teaser, not the page
  }
  return { title, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
}

const MAX_BYTES = 5 * 1024 * 1024;
// Fetches a page and returns { ok: true, url, title, text, truncated } or { ok: false, reason }.
async function fetchPage(input, fetchImpl = fetch) {
  let url;
  try { url = new URL(String(input).trim()); } catch { return { ok: false, reason: 'That is not a web address.' }; }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: 'Only http and https addresses can be clipped.' };
  try {
    const res = await fetchImpl(url.href, { redirect: 'follow', signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' } });
    if (!res.ok) return { ok: false, reason: `The site answered with an error (${res.status}).` };
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type && !/html|text\/plain|xml/.test(type)) return { ok: false, reason: 'That address is not a web page (it may be a file or a download).' };
    const chunks = []; let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { reader.cancel().catch(() => {}); break; }
      chunks.push(Buffer.from(value));
    }
    const charset = (/charset=([\w-]+)/.exec(type) || [])[1] || 'utf-8';
    let raw;
    try { raw = new TextDecoder(charset).decode(Buffer.concat(chunks)); } catch { raw = Buffer.concat(chunks).toString('utf8'); }
    const page = /text\/plain/.test(type) ? { title: '', text: raw.slice(0, MAX_TEXT), truncated: raw.length > MAX_TEXT } : pageText(raw);
    if (page.text.length < 200) return { ok: false, reason: 'No readable text was found there. The page may need a sign-in, or build itself with scripts.' };
    return { ok: true, url: res.url || url.href, title: page.title || url.hostname, text: page.text, truncated: page.truncated };
  } catch (e) {
    return { ok: false, reason: e && e.name === 'TimeoutError' ? 'The site took too long to answer.' : 'The page could not be reached. Check the address and your connection.' };
  }
}

module.exports = { pageText, fetchPage, decode };
