// Prints the pet status computed from the real T3 Code state DB (read-only).
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import os from 'node:os';
const { computeStatus } = createRequire(import.meta.url)('../src/status/queries.js');
const db = new DatabaseSync(process.env.T3_STATE_DB || `${os.homedir()}/.t3/userdata/statev2.sqlite`, { readOnly: true });
console.log(computeStatus(db));
