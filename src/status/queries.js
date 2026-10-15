// Turns T3 Code's state DB into one pet status. Read-only: only SELECTs, on a connection the
// caller opened with readOnly. Shared by the in-process reader and poll-child.js.
'use strict';

const RECENT_MS = 6000; // how long "done" / "error" stays up after a run finishes
const STALE_RUN_MS = 6 * 60 * 60 * 1000; // ignore "running" rows left behind by a crash

const LIVE = `t.thread_id IS NULL OR (t.archived_at IS NULL AND t.deleted_at IS NULL)`;
const SQL = {
  running: `SELECT r.thread_id, r.requested_at, t.title FROM orchestration_v2_projection_runs r
    LEFT JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
    WHERE r.status = 'running' AND (${LIVE}) ORDER BY r.requested_at DESC`,
  pending: `SELECT q.thread_id, q.created_at, t.title FROM orchestration_v2_projection_runtime_requests q
    LEFT JOIN orchestration_v2_projection_threads t ON t.thread_id = q.thread_id
    WHERE q.status = 'pending' AND (${LIVE})
      -- T3 leaves orphaned 'pending' rows on threads whose run already ended; only a live run can wait on you.
      AND EXISTS (SELECT 1 FROM orchestration_v2_projection_runs r
        WHERE r.thread_id = q.thread_id AND r.status = 'running')
    ORDER BY q.created_at DESC`,
  finished: `SELECT r.run_id, r.thread_id, r.status, r.completed_at, t.title FROM orchestration_v2_projection_runs r
    LEFT JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
    WHERE r.status IN ('completed', 'failed') AND r.completed_at IS NOT NULL
    ORDER BY r.completed_at DESC LIMIT 5`,
};

const cache = new WeakMap();
function stmts(db) {
  let s = cache.get(db);
  if (!s) {
    s = {};
    for (const [k, sql] of Object.entries(SQL)) s[k] = db.prepare(sql);
    cache.set(db, s);
  }
  return s;
}

// T3 stores ISO strings in UTC; tolerate a missing "Z" or a space separator.
function parseTime(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  let s = String(v).trim().replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  return Date.parse(s);
}

// Priority: waiting on you > error > done > working > idle.
function computeStatus(db, now = Date.now()) {
  const s = stmts(db);
  const pending = s.pending.all();
  const running = s.running.all().filter((r) => {
    const t = parseTime(r.requested_at);
    return !(now - t > STALE_RUN_MS);
  });
  const recent = s.finished.all().filter((r) => {
    const t = parseTime(r.completed_at);
    return t && now - t <= RECENT_MS && now - t > -60000;
  });
  const failed = recent.find((r) => r.status === 'failed');
  const completed = recent.find((r) => r.status === 'completed');

  if (pending.length) {
    const p = pending[0];
    return { state: 'waiting', title: p.title || '', count: pending.length, key: `waiting:${p.thread_id}:${p.created_at}` };
  }
  if (failed) return { state: 'error', title: failed.title || '', count: 1, key: `error:${failed.run_id}` };
  if (completed) return { state: 'done', title: completed.title || '', count: 1, key: `done:${completed.run_id}` };
  if (running.length) {
    const r = running[0];
    return { state: 'working', title: r.title || '', count: running.length, key: `working:${r.thread_id}` };
  }
  return { state: 'idle', title: '', count: 0, key: 'idle' };
}

// Most recent thread title, used as the bubble caption for demo hotkeys.
function latestTitle(db) {
  try {
    const row = db.prepare(`SELECT title FROM orchestration_v2_projection_threads
      WHERE archived_at IS NULL AND deleted_at IS NULL AND title IS NOT NULL AND title != ''
      ORDER BY rowid DESC LIMIT 1`).get();
    return row ? row.title : '';
  } catch {
    return '';
  }
}

module.exports = { computeStatus, latestTitle, parseTime, RECENT_MS };
