// Cleans the settings added for the Notes page, animations, the agent's instructions and limits, and daily notes, before
// config:set writes them. config:set keeps only the fields it knows, so every new setting has to be listed here
// (or in config:set itself), or it is silently dropped on the next save. Tests: test/settings.test.js.
const { protectList } = require('./policy');

const rel = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
const safeRel = (p) => { const r = rel(p); return r && !r.split('/').includes('..') && r.length <= 300 ? r : ''; };
const bool = (v, cur) => (typeof v === 'boolean' ? v : cur);

function cleanExtras(c, cur) {
  const show = c.mapShow && typeof c.mapShow === 'object' ? c.mapShow : cur.mapShow || {};
  const daily = typeof c.dailyNote === 'string' ? safeRel(c.dailyNote) : cur.dailyNote;
  return {
    motion: ['on', 'system', 'off'].includes(c.motion) ? c.motion : cur.motion,
    // hidden keeps the trailing slash that marks a folder
    hidden: Array.isArray(c.hidden) ? [...new Set(c.hidden.map(safeRel).filter(Boolean))].slice(0, 500) : cur.hidden,
    // when the user last opened each note Rook changed (file -> ms), so its "changed" mark can be cleared
    seen: c.seen && typeof c.seen === 'object' ? Object.fromEntries(Object.entries(c.seen).map(([f, t]) => [safeRel(f), Number(t)])
      .filter(([f, t]) => f && Number.isFinite(t)).slice(-500)) : cur.seen,
    mapShow: { hidden: !!show.hidden, files: !!show.files, missing: !!show.missing, changes: show.changes !== false },
    instructions: typeof c.instructions === 'string' ? c.instructions.slice(0, 8000) : cur.instructions,
    allowMoves: bool(c.allowMoves, cur.allowMoves),
    allowDeletes: bool(c.allowDeletes, cur.allowDeletes),
    protect: Array.isArray(c.protect) ? [...new Set(protectList(c.protect))].slice(0, 100) : cur.protect,
    // a daily-note location must name a dated .md file, or it is left to the vault ('')
    dailyNote: daily && /\.md$/i.test(daily) && daily.includes('{DD}') ? daily : '',
    dailyTemplate: typeof c.dailyTemplate === 'string' ? safeRel(c.dailyTemplate) : cur.dailyTemplate
  };
}

module.exports = { cleanExtras };
