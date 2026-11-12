const test = require('node:test');
const assert = require('node:assert');
const { splitMoves, okPath, rewriteLinks } = require('../src/moves');

test('the moves block is taken out of the reply and read as from -> to pairs', () => {
  const r = splitMoves('Moving the three notes.\n\n<moves>\n- Coding Languages.md -> Learning/Coding Languages.md\n- `Python.md` → Learning/Python.md\n- Hash.md -> Hash.md\n</moves>');
  assert.equal(r.text, 'Moving the three notes.');
  assert.deepEqual(r.moves, [{ op: 'move', from: 'Coding Languages.md', to: 'Learning/Coding Languages.md' }, { op: 'move', from: 'Python.md', to: 'Learning/Python.md' }]);
});

test('text after the block (a choices block) is kept; a block still streaming in is hidden and not run', () => {
  assert.equal(splitMoves('Done.\n<moves>\n- a.md -> b/a.md\n</moves>\n<choices>\n- Yes\n</choices>').text, 'Done.\n\n<choices>\n- Yes\n</choices>');
  assert.deepEqual(splitMoves('Done.\n<moves>\n- a.md -> b/a.md'), { text: 'Done.', moves: [] });
  assert.equal(splitMoves('Done.\n<mov').text, 'Done.\n');
});

test('only plain vault-relative paths may be moved', () => {
  assert.ok(okPath('Learning/Python.md'));
  for (const p of ['', '/etc/passwd', 'C:/x.md', '../x.md', 'a/../../x.md', '.obsidian/app.json', 'Notes/.claude/x', 'a//b']) assert.ok(!okPath(p), p);
});

test('links follow a move: path links get the new path, bare names stay, renames change the name', () => {
  const map = [{ from: 'Python.md', to: 'Learning/Python.md' }, { from: 'Old/Hash.md', to: 'Learning/Hashing.md' }, { from: 'img/a.png', to: 'Attachments/a.png' }];
  const text = 'See [[Python]], [[Python#Setup|setup]], [[Old/Hash]], [[Hash|the hash note]], [[Hash.md]] and ![[img/a.png]]. Not [[Pythonic]].';
  assert.equal(rewriteLinks(text, map),
    'See [[Python]], [[Python#Setup|setup]], [[Learning/Hashing]], [[Hashing|the hash note]], [[Hashing.md]] and ![[Attachments/a.png]]. Not [[Pythonic]].');
});

test('a <files> block takes moves, renames and deletes, in order', () => {
  const r = splitMoves('Tidied up.\n<files>\n- rename Draft.md -> Final.md\n- delete Scratch.md\n- Remove: Old/Temp\n- delete me.md -> Kept/delete me.md\n</files>');
  assert.equal(r.text, 'Tidied up.');
  assert.deepEqual(r.moves, [{ op: 'move', from: 'Draft.md', to: 'Final.md' }, { op: 'delete', path: 'Scratch.md' }, { op: 'delete', path: 'Old/Temp' },
    { op: 'move', from: 'delete me.md', to: 'Kept/delete me.md' }]);
  assert.equal(splitMoves('Working.\n<fil').text, 'Working.\n');
});
