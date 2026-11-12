// Vault write guard. Every file the APP writes itself goes through resolveInside().
// It follows symlinks/junctions (realpath), compares case-insensitively on Windows,
// and refuses anything that lands outside the vault root.
const fs = require('fs');
const path = require('path');

function realpathOfExistingPart(p) {
  // Real path of the deepest existing ancestor, with the not-yet-existing tail re-attached.
  const tail = [];
  let cur = p;
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...tail.reverse()); }
    catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      const parent = path.dirname(cur);
      if (parent === cur) throw e;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

function resolveInside(root, target, opts = {}) {
  const ci = opts.caseInsensitive ?? process.platform === 'win32';
  if (typeof root !== 'string' || !root) throw new Error('blocked: no vault chosen');
  if (typeof target !== 'string' || !target || target.includes('\0')) throw new Error('blocked: invalid path');
  const rootReal = fs.realpathSync.native(root);
  const abs = path.resolve(rootReal, target);           // absolute targets stay absolute
  const real = realpathOfExistingPart(abs);
  const norm = (s) => (ci ? s.toLowerCase() : s);
  const rel = path.relative(norm(rootReal), norm(real));
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('blocked: outside the vault');
  }
  return real;
}

module.exports = { resolveInside };
