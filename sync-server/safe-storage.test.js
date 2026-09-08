const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readArray, writeArray } = require('./safe-storage');
const { createAuthStore } = require('./auth-store');
const root = path.resolve(__dirname, '../tmp');
fs.mkdirSync(root, { recursive: true });
test('damaged existing tasks are not mistaken for empty storage or overwritten', () => {
  const dir = fs.mkdtempSync(path.join(root, 'storage-test-'));
  const file = path.join(dir, 'tasks.json');
  assert.deepEqual(readArray(file), []);
  for (const damaged of ['{broken', '{"not":"array"}']) {
    fs.writeFileSync(file, damaged);
    assert.throws(() => readArray(file));
    assert.throws(() => writeArray(file, []));
    assert.equal(fs.readFileSync(file, 'utf8'), damaged);
  }
});
test('history restores the complete prior task set', () => {
  const dir = fs.mkdtempSync(path.join(root, 'storage-test-'));
  const file = path.join(dir, 'tasks.json');
  const prior = [{ id: 'phone-new', text: 'must survive' }, { id: 'deleted', deleted: true }];
  writeArray(file, prior); writeArray(file, [...prior, { id: 'web-new' }]);
  const history = path.join(dir, '.history');
  const backup = path.join(history, fs.readdirSync(history)[0]);
  assert.deepEqual(readArray(backup), prior);
  assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
});
test('corrupt authentication store cannot silently recreate an existing username', () => {
  const dir = fs.mkdtempSync(path.join(root, 'storage-test-'));
  const file = path.join(dir, 'users.json');
  fs.writeFileSync(file, 'broken-auth');
  const store = createAuthStore(dir, { inviteCode: 'long-test-invite-code' });
  assert.throws(() => store.register('hulk', 'password123', 'long-test-invite-code'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken-auth');
});
test('missing account database with surviving user data cannot register a replacement identity', () => {
  const dir = fs.mkdtempSync(path.join(root, 'storage-test-'));
  fs.mkdirSync(path.join(dir, 'users'));
  const store = createAuthStore(dir, { inviteCode: 'long-test-invite-code' });
  assert.throws(() => store.register('hulk', 'password123', 'long-test-invite-code'), /账号库缺失/);
  assert.equal(fs.existsSync(path.join(dir, 'users.json')), false);
});
