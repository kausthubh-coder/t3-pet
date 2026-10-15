// Peeks at T3 Code's state DB (read-only) to find where live thread status lives.
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
const db = new DatabaseSync(`${os.homedir()}/.t3/userdata/statev2.sqlite`, { readOnly: true });
const q = (sql) => console.table(db.prepare(sql).all());
q(`select status, count(*) n from orchestration_v2_projection_runs group by status`);
q(`select r.thread_id, t.title, r.status, r.requested_at, r.completed_at from orchestration_v2_projection_runs r
   join orchestration_v2_projection_threads t using(thread_id) order by r.requested_at desc limit 6`);
q(`select kind, status, count(*) n from orchestration_v2_projection_runtime_requests group by kind, status`);
