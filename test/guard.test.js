const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveInside } = require('../src/guard');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-guard-'));
const vault = path.join(tmp, 'vault');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(path.join(vault, 'Daily'), { recursive: true });
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
const vaultReal = fs.realpathSync(vault);

test('allows a new file inside the vault', () => {
  assert.strictEqual(resolveInside(vault, 'Daily/new.md'), path.join(vaultReal, 'Daily', 'new.md'));
});
test('allows a nested path that does not exist yet', () => {
  assert.strictEqual(resolveInside(vault, 'A/B/C/n.md'), path.join(vaultReal, 'A', 'B', 'C', 'n.md'));
});
test('blocks .. escapes', () => {
  assert.throws(() => resolveInside(vault, '../outside/secret.txt'), /outside the vault/);
  assert.throws(() => resolveInside(vault, 'Daily/../../outside/x'), /outside the vault/);
});
test('blocks absolute paths outside the vault', () => {
  assert.throws(() => resolveInside(vault, path.join(outside, 'secret.txt')), /outside the vault/);
  assert.throws(() => resolveInside(vault, path.join(tmp, 'vault-evil', 'x')), /outside the vault/); // prefix trap
});
test('allows an absolute path inside the vault', () => {
  assert.doesNotThrow(() => resolveInside(vault, path.join(vault, 'Daily', 'a.md')));
});
test('blocks a symlink that points outside', () => {
  fs.symlinkSync(outside, path.join(vault, 'link'), 'dir');
  assert.throws(() => resolveInside(vault, 'link/secret.txt'), /outside the vault/);
  assert.throws(() => resolveInside(vault, 'link/new.txt'), /outside the vault/);
});
test('blocks a symlinked file that points outside', () => {
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(vault, 'Daily', 'file-link.md'));
  assert.throws(() => resolveInside(vault, 'Daily/file-link.md'), /outside the vault/);
});
test('case-insensitive mode (Windows) catches case tricks', () => {
  assert.throws(() => resolveInside(vault, path.join(outside.toUpperCase(), 'x'), { caseInsensitive: true }), /outside the vault/);
  assert.doesNotThrow(() => resolveInside(vault, path.join(vaultReal.toUpperCase(), 'Daily', 'a.md'), { caseInsensitive: true }));
});
test('rejects empty and NUL paths', () => {
  assert.throws(() => resolveInside(vault, ''), /invalid path/);
  assert.throws(() => resolveInside(vault, 'a\0b'), /invalid path/);
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
