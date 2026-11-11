const test = require('node:test');
const assert = require('node:assert');
const { tasksIn, setTask, linksIn, isEmptyNote, health, linkNotePath } = require('../src/vaultscan');

const NOTE = ['# Plan', '', '- [ ] Call Sam about [[Proofs]]', '  - [x] Send the file', '1. [ ] Numbered one', '```', '- [ ] not a task, this is code', '```', '- [ ]', '* [X] Done with a capital'].join('\n');

test('tasks are found with their line and state; code blocks and empty boxes are skipped', () => {
  assert.deepEqual(tasksIn(NOTE), [
    { line: 2, done: false, text: 'Call Sam about [[Proofs]]' },
    { line: 3, done: true, text: 'Send the file' },
    { line: 4, done: false, text: 'Numbered one' },
    { line: 9, done: true, text: 'Done with a capital' }
  ]);
});

test('ticking a task changes only its box', () => {
  const r = setTask(NOTE, { line: 2, text: 'Call Sam about [[Proofs]]', done: true });
  assert.equal(r.line, 2);
  assert.equal(r.content, NOTE.replace('- [ ] Call Sam', '- [x] Call Sam'));
  const back = setTask(r.content, { line: 2, text: 'Call Sam about [[Proofs]]', done: false });
  assert.equal(back.content, NOTE);
});

test('a task that moved is found by its text; one that is gone or already in that state is refused', () => {
  const moved = 'New first line\n\n' + NOTE;
  const r = setTask(moved, { line: 2, text: 'Call Sam about [[Proofs]]', done: true });
  assert.equal(r.line, 4);
  assert.match(r.content.split('\n')[4], /^- \[x\] Call Sam/);
  assert.equal(setTask(NOTE, { line: 2, text: 'Something else', done: true }), null);
  assert.equal(setTask(NOTE, { line: 3, text: 'Send the file', done: true }), null); // already ticked
  assert.equal(setTask(NOTE, { line: 6, text: 'not a task, this is code', done: true }).line, 6); // the caller only lists real tasks; the box itself is still found
});

test('Windows line endings survive a tick', () => {
  const r = setTask('- [ ] one\r\n- [ ] two\r\n', { line: 1, text: 'two', done: true });
  assert.equal(r.content, '- [ ] one\r\n- [x] two\r\n');
});

test('links: aliases and headings are cut off; code, same-note headings and template placeholders are skipped', () => {
  const t = 'See [[Budget|the numbers]] and [[Plan#Risks]].\n`[[not a link]]` [[#Heading]] [[{{date}}]]\n```\n[[in code]]\n```\n![[cover.png]]';
  assert.deepEqual(linksIn(t), [{ target: 'Budget', line: 0 }, { target: 'Plan', line: 0 }, { target: 'cover.png', line: 5 }]);
});

test('an empty note has nothing but frontmatter, comments and its own title', () => {
  assert.equal(isEmptyNote('Projects/Atlas.md', '---\ntags: [a]\n---\n# Atlas\n\n%% todo %%\n'), true);
  assert.equal(isEmptyNote('Untitled.md', ''), true);
  assert.equal(isEmptyNote('Projects/Atlas.md', '# Atlas\n\nOne line.'), false);
  assert.equal(isEmptyNote('Projects/Atlas.md', '# Something else'), false);
});

test('the health check reports broken links, empty notes, unlinked notes and repeated names', () => {
  const notes = [
    { rel: 'Projects/Plan.md', text: 'Links to [[Budget]], [[Missing note]], [[missing note]] again, ![[cover.png]] and ![[lost.png]].' },
    { rel: 'Projects/Budget.md', text: 'Numbers.' },
    { rel: 'Ideas.md', text: 'On its own.' },
    { rel: 'Untitled.md', text: '' },
    { rel: 'Inbox/Untitled.md', text: 'Has text.' },
    { rel: 'CLAUDE.md', text: 'Instructions for the agent.' },
    { rel: 'Daily/2026-11-11.md', text: 'A daily note with no links.' },
    { rel: 'Archive/Budget.md', text: 'Old numbers, see [[Projects/Plan]].' },
    { rel: 'Templates/daily.md', text: '[[Nowhere]] - [ ] placeholder' }
  ];
  const h = health(notes, ['Attachments/Cover.PNG']);
  assert.equal(h.notes, 9);
  assert.deepEqual(h.broken.map((b) => `${b.file} -> ${b.target}`), ['Projects/Plan.md -> Missing note', 'Projects/Plan.md -> lost.png']);
  assert.deepEqual(h.empty, [{ file: 'Untitled.md', empty: true, untitled: true }, { file: 'Inbox/Untitled.md', empty: false, untitled: true }]);
  // [[Budget]] reaches Archive/Budget.md (the shorter path wins, as in Obsidian), so the other Budget has no links.
  // The daily note, the template, the untitled notes and CLAUDE.md are not listed here; two Untitled notes are not reported as a shared name either.
  assert.deepEqual(h.orphans, ['Projects/Budget.md', 'Ideas.md']);
  assert.deepEqual(h.duplicates, [{ name: 'Budget', files: ['Archive/Budget.md', 'Projects/Budget.md'] }]);
});

test('a note for a broken link goes where the link says, or beside the note that links to it', () => {
  assert.equal(linkNotePath('Projects/Atlas/Plan.md', 'Printer quote'), 'Projects/Atlas/Printer quote.md');
  assert.equal(linkNotePath('Plan.md', 'Printer quote'), 'Printer quote.md');
  assert.equal(linkNotePath('Projects/Plan.md', 'People/Sam.md'), 'People/Sam.md');
  assert.equal(linkNotePath('Projects/Plan.md', 'What? Why: "now"'), 'Projects/What Why now.md');
  assert.equal(linkNotePath('Projects/Plan.md', '../../outside'), null);
  assert.equal(linkNotePath('Projects/Plan.md', '???'), null);
});
