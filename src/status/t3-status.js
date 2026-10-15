// Polls T3 Code's state DB (read-only) about once a second and emits 'status'.
// Uses node:sqlite inside Electron when available, else spawns the system `node` with
// poll-child.js. If the DB file doesn't exist we stay in demo mode (hotkeys only).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { computeStatus, latestTitle } = require('./queries');

function defaultDbPath() {
  return process.env.T3_STATE_DB || path.join(os.homedir(), '.t3', 'userdata', 'statev2.sqlite');
}

function loadNativeSqlite() {
  if (process.env.T3PET_SQLITE === 'child') return null;
  try {
    // eslint-disable-next-line global-require
    const { DatabaseSync } = require('node:sqlite');
    return typeof DatabaseSync === 'function' ? DatabaseSync : null;
  } catch {
    return null;
  }
}

class T3Status extends EventEmitter {
  constructor({ dbPath = defaultDbPath(), intervalMs = 1000, log = console.log } = {}) {
    super();
    this.dbPath = dbPath;
    this.intervalMs = intervalMs;
    this.log = log;
    this.DatabaseSync = loadNativeSqlite();
    this.mode = 'starting';
    this.db = null;
    this.child = null;
    this.timer = null;
    this.lastError = '';
    this.latestTitle = '';
    this.stopped = false;
  }

  start() {
    this.log(`[t3] state db: ${this.dbPath} (reader: ${this.DatabaseSync ? 'node:sqlite in Electron' : 'system node child'})`);
    this.tick();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.closeDb();
    this.killChild();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.log(`[t3] mode: ${mode}`);
    this.emit('mode', mode);
  }

  schedule(ms) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), ms);
  }

  logErrorOnce(msg) {
    if (msg !== this.lastError) { this.lastError = msg; this.log(`[t3] ${msg}`); }
  }

  tick() {
    if (this.stopped) return;
    if (!fs.existsSync(this.dbPath)) {
      this.closeDb();
      this.killChild();
      this.setMode('demo');
      this.emit('status', null);
      return this.schedule(5000);
    }
    if (this.DatabaseSync) return this.tickNative();
    this.ensureChild();
    this.schedule(5000); // keep checking the file still exists
  }

  tickNative() {
    try {
      if (!this.db) this.db = new this.DatabaseSync(this.dbPath, { readOnly: true });
      const status = computeStatus(this.db);
      this.latestTitle = latestTitle(this.db) || this.latestTitle;
      this.lastError = '';
      this.setMode('live');
      this.emit('status', status);
      this.schedule(this.intervalMs);
    } catch (e) {
      this.closeDb();
      this.logErrorOnce(`read failed: ${e.message}`);
      this.setMode('error');
      this.emit('status', null);
      this.schedule(3000);
    }
  }

  closeDb() {
    if (this.db) { try { this.db.close(); } catch {} this.db = null; }
  }

  ensureChild() {
    if (this.child) return;
    const node = process.env.T3PET_NODE || 'node';
    const script = path.join(__dirname, 'poll-child.js');
    let child;
    try {
      child = spawn(node, ['--no-warnings', script, this.dbPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return this.childFailed(`could not start ${node}: ${e.message}`);
    }
    this.child = child;
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.onChildLine(line);
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', (e) => this.childFailed(`system node not usable (${e.code || e.message})`));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (!this.stopped) this.childFailed(`poller exited (${code})`);
    });
  }

  onChildLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.ok) {
      this.lastError = '';
      if (msg.latestTitle) this.latestTitle = msg.latestTitle;
      this.setMode('live');
      this.emit('status', msg.status);
    } else {
      this.logErrorOnce(msg.error);
      this.setMode(msg.fatal ? 'demo' : 'error');
      this.emit('status', null);
    }
  }

  childFailed(reason) {
    this.killChild();
    this.logErrorOnce(`${reason}; running in demo mode, retrying in 30 s`);
    this.setMode('demo');
    this.emit('status', null);
    this.schedule(30000);
  }

  killChild() {
    if (this.child) {
      const c = this.child;
      this.child = null;
      try { c.kill(); } catch {}
    }
  }
}

module.exports = { T3Status, defaultDbPath };
