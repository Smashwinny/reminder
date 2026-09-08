const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// A corrupt/unreadable existing store must never become an empty database.
function readArray(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Invalid storage array');
  return value;
}

function writeArray(file, value) {
  if (!Array.isArray(value)) throw new Error('Invalid storage array');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    readArray(file); // Refuse overwriting damaged data; keep the evidence for recovery.
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const backup = path.join(path.dirname(file), '.history');
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    const name = `${path.basename(file)}.${new Date().toISOString().slice(0, 10)}.${digest}.json`;
    const destination = path.join(backup, name);
    if (!fs.existsSync(destination)) {
      fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
    }
    // Bounded per-file history; daily off-host archives are a separate deployment concern.
    const prefix = path.basename(file) + '.';
    const versions = fs.readdirSync(backup).filter(name => name.startsWith(prefix))
      .map(name => ({ name, at: fs.statSync(path.join(backup, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const old of versions.slice(64)) fs.unlinkSync(path.join(backup, old.name));
  }
  const next = `${file}.next`;
  const fd = fs.openSync(next, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(next, file);
}
module.exports = { readArray, writeArray };
