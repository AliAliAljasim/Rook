// Hold-to-talk voice: speech is turned into text on this PC by whisper.cpp, never sent anywhere.
// The engine (a small Windows program) and its speech model are not bundled with Rook; they are
// downloaded once, on request, from the two places below, and each file must match its checksum
// before it is used.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ENGINE = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip', // official build of whisper.cpp 1.9.5
  sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb', size: 8928640
};
const MODEL = {
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin', // English, "base" size
  sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', size: 147964211
};
const TOTAL = ENGINE.size + MODEL.size;
// From the engine's zip, only the transcriber and the libraries it loads are kept.
const wanted = (name) => /^Release\/(whisper-cli\.exe|whisper\.dll|ggml[\w-]*\.dll)$/.test(name);

// Reads a zip held in memory and returns [{ name, data }] for the entries `pick` accepts.
function unzip(buf, pick) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('damaged zip file');
    const method = buf.readUInt16LE(at + 10), packed = buf.readUInt32LE(at + 20), size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || !pick(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + packed);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data || data.length !== size) throw new Error(`could not unpack ${name}`);
    out.push({ name, data });
  }
  return out;
}

// Downloads to `dest`, reporting bytes as they arrive, and refuses the file unless its SHA-256 matches.
async function download(item, dest, onBytes) {
  const res = await fetch(item.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const part = dest + '.part';
  const file = fs.createWriteStream(part);
  const hash = crypto.createHash('sha256');
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise((r) => file.once('drain', r));
      onBytes(chunk.length);
    }
    await new Promise((resolve, reject) => file.end((e) => (e ? reject(e) : resolve())));
    if (hash.digest('hex') !== item.sha256) throw new Error('the downloaded file did not match its checksum');
    fs.renameSync(part, dest);
  } catch (e) {
    file.destroy();
    try { fs.unlinkSync(part); } catch { /* nothing to remove */ }
    throw e;
  }
}

function create(dir) {
  const exe = path.join(dir, 'whisper-cli.exe'), model = path.join(dir, 'ggml-base.en.bin');
  let installing = null, percent = 0;
  const installed = () => fs.existsSync(exe) && fs.existsSync(model);
  const status = () => ({ installed: installed(), installing: !!installing, percent, sizeMb: Math.round(TOTAL / 1e6) });

  function install(onProgress) {
    if (installing) return installing;
    installing = (async () => {
      await null; // let `installing` be set before the first progress report
      fs.mkdirSync(dir, { recursive: true });
      let got = 0;
      const bytes = (n) => { got += n; const p = Math.min(99, Math.floor((got / TOTAL) * 100)); if (p !== percent) { percent = p; onProgress(status()); } };
      percent = 0; onProgress(status());
      if (!fs.existsSync(exe)) {
        const zip = path.join(dir, 'engine.zip');
        await download(ENGINE, zip, bytes);
        const files = unzip(fs.readFileSync(zip), wanted);
        if (!files.some((f) => f.name.endsWith('whisper-cli.exe'))) throw new Error('the engine download did not contain the transcriber');
        for (const f of files) fs.writeFileSync(path.join(dir, path.basename(f.name)), f.data);
        fs.unlinkSync(zip);
      } else bytes(ENGINE.size);
      if (!fs.existsSync(model)) await download(MODEL, model, bytes);
      percent = 100;
    })().finally(() => { installing = null; onProgress(status()); });
    return installing;
  }

  function remove() {
    if (installing) return false;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { return false; }
    return true;
  }

  // wav: 16 kHz mono 16-bit PCM. Resolves with the text heard ('' for silence).
  function transcribe(wav) {
    return new Promise((resolve, reject) => {
      if (!installed()) return reject(new Error('Voice is not installed.'));
      const base = path.join(dir, `clip-${Date.now()}`);
      const clean = () => { for (const ext of ['.wav', '.txt']) { try { fs.unlinkSync(base + ext); } catch { /* not there */ } } };
      fs.writeFileSync(base + '.wav', Buffer.from(wav));
      execFile(exe, ['-m', model, '-f', base + '.wav', '-l', 'en', '-nt', '-np', '-otxt', '-of', base], { windowsHide: true, timeout: 120000, cwd: dir }, (err, stdout) => {
        let text = '';
        try { text = fs.readFileSync(base + '.txt', 'utf8'); } catch { text = err ? '' : String(stdout); }
        clean();
        if (err && !text) return reject(new Error('The recording could not be transcribed.'));
        // Whisper marks silence and noises in brackets, e.g. [BLANK_AUDIO] or (wind blowing): those are not speech.
        resolve(text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim());
      });
    });
  }

  return { status, install, remove, transcribe };
}

module.exports = { create, unzip, wanted, ENGINE, MODEL };
