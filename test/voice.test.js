const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { unzip, wanted } = require('../src/voice');

// Builds a small zip in memory: one stored entry and one deflated entry.
function makeZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text, deflate] of entries) {
    const data = Buffer.from(text), body = deflate ? zlib.deflateRawSync(data) : data, n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    locals.push(local, n, body); central.push(cen, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('unzip reads stored and deflated entries and skips what is not wanted', () => {
  const zip = makeZip([['Release/whisper-cli.exe', 'program', false], ['Release/ggml-base.dll', 'library '.repeat(50), true], ['Release/SDL2.dll', 'not needed', true]]);
  const files = unzip(zip, wanted);
  assert.deepEqual(files.map((f) => f.name), ['Release/whisper-cli.exe', 'Release/ggml-base.dll']);
  assert.equal(files[0].data.toString(), 'program');
  assert.equal(files[1].data.toString(), 'library '.repeat(50));
});

test('only the transcriber and its libraries are kept from the engine download', () => {
  assert.ok(wanted('Release/whisper-cli.exe') && wanted('Release/whisper.dll') && wanted('Release/ggml-cpu-haswell.dll'));
  assert.ok(!wanted('Release/whisper-server.exe') && !wanted('Release/llama.dll') && !wanted('whisper-cli.exe') && !wanted('Release/../evil.dll'));
});

test('unzip refuses data that is not a zip', () => {
  assert.throws(() => unzip(Buffer.from('this is not a zip file at all, just some text'), wanted), /not a zip/);
});
