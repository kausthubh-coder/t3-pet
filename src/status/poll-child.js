// Fallback poller, run with the system `node` when Electron's Node lacks node:sqlite:
//   node poll-child.js <path-to-statev2.sqlite>
// Prints one JSON line per second: {"ok":true,"status":{...},"latestTitle":"..."} or {"ok":false,"error":"..."}.
'use strict';
const { computeStatus, latestTitle } = require('./queries');

const dbPath = process.argv[2];
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, fatal: true, error: 'node:sqlite unavailable in ' + process.version }) + '\n');
  process.exit(2);
}

let db = null;
function tick() {
  try {
    if (!db) db = new DatabaseSync(dbPath, { readOnly: true });
    const status = computeStatus(db);
    process.stdout.write(JSON.stringify({ ok: true, status, latestTitle: latestTitle(db) }) + '\n');
  } catch (e) {
    try { db && db.close(); } catch {}
    db = null;
    process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e) }) + '\n');
  }
}
tick();
setInterval(tick, 1000);
// Exit with the parent.
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
