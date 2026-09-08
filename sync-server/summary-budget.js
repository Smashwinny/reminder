const fs = require('node:fs');
const path = require('node:path');
const { readArray, writeArray, StorageError } = require('./safe-storage');

// Single-writer store: reserve durably BEFORE issuing work, including retries.
function createSummaryBudget(dataDir, { perUser = 20, global = 200, now = Date.now } = {}) {
  for (const limit of [perUser, global]) if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid summary limit');
  const file = path.join(dataDir, 'summary-usage.json');
  function reserve(userId, kind = 'api') {
    if (!['api', 'job'].includes(kind) || !userId) throw new Error('Invalid budget reservation');
    const history = path.join(dataDir, '.history');
    if (!fs.existsSync(file) && fs.existsSync(history) && fs.readdirSync(history).some(name => name.startsWith('summary-usage.json.')))
      throw new StorageError(new Error('Summary budget missing; restore backup'));
    const time = now(), day = new Date(time).toISOString().slice(0,10);
    let rows = readArray(file);
    if (rows.some(r => !r || typeof r.userId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || !['api','job'].includes(r.kind) || !Number.isSafeInteger(r.count) || r.count < 0))
      throw new StorageError(new Error('Invalid summary usage'));
    rows = rows.filter(r => r.day >= new Date(time - 7 * 86400000).toISOString().slice(0,10));
    const today = rows.filter(r => r.day === day && r.kind === kind);
    const multiplier = kind === 'job' ? 3 : 1;
    if (today.filter(r => r.userId === userId).reduce((n,r)=>n+r.count,0) >= perUser * multiplier ||
        today.reduce((n,r)=>n+r.count,0) >= global * multiplier) return false;
    const row = today.find(r => r.userId === userId);
    if (row) row.count++;
    else rows.push({ day, userId, kind, count:1 });
    writeArray(file, rows);
    return true;
  }
  return { reserve, file };
}
module.exports = { createSummaryBudget };
