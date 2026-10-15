# t3-pet

A desktop pet for [T3 Code](https://github.com/pingdotgg/t3code): a 2D pixel-art version of the T3 mascot
(`assets/mascot-reference.png`) that lives on top of your screen, follows your cursor and shows what your
T3 Code agents are doing. Same idea as Codex Pets, built as a demo for a video.

Status: spec only. The build is being done in a Claude Code cloud session.

## Spec

### The sprite

- Pixel art drawn in code on a small canvas (about 32 to 40 px wide), scaled up with nearest-neighbour so the
  pixels stay crisp. No external image assets needed.
- Match the reference: a big white sphere with soft grey shading, "T3" in bold black on the forehead, grey
  eyes with a highlight, a pink smile, thin arms hanging at the sides, two short legs with little feet.
- Animations: idle (breathing bob, blinks), walk and run (legs alternate, faces the way it moves), sleep
  (eyes closed, floating "Z"), working, waiting, done, error, picked up (legs dangle), petted (hearts).

### On the screen

- An Electron app: one transparent, frameless, always-on-top, click-through window covering the work area of
  the display the cursor is on (it moves to another monitor when the cursor does). Not in the taskbar.
- The pet follows the cursor and stops a short distance from it, walking or running depending on distance.
  It stands on the bottom of the work area (above the taskbar) when idle, and falls asleep after some time
  without cursor movement. Moving the cursor wakes it.
- Hovering the pet turns off click-through for that spot only, so you can click it (hearts) or drag it
  around (drop it and it falls back down).
- A tray icon with Quit, Pause following and a state menu.

### T3 Code status

The pet reads T3 Code's local state database read-only and shows a small pixel speech bubble:

| State | When | Pet |
|---|---|---|
| working | a run has `status = 'running'` | thinking dots, busy animation |
| waiting | a runtime request has `status = 'pending'` | bubble "?", bounces/waves for attention |
| done | a run completed in the last ~6 s | jumps, sparkles, bubble "done" |
| error | a run failed in the last ~6 s | bubble "!", sad face |
| idle | none of the above | normal follow behaviour |

- Database: `%USERPROFILE%\.t3\userdata\statev2.sqlite` (SQLite in WAL mode, open read-only, poll every ~1 s).
- `orchestration_v2_projection_runs (run_id, thread_id, status, requested_at, completed_at, ...)`. Status
  values seen: `running`, `completed`, `failed`, `cancelled`, `interrupted`, `rolled_back`. Timestamps are
  ISO strings in UTC.
- `orchestration_v2_projection_runtime_requests (runtime_request_id, thread_id, kind, status, created_at,
  resolved_at, ...)`. `kind` is `user_input`; `status` is `pending` while the agent waits on you.
- `orchestration_v2_projection_threads (thread_id, title, archived_at, deleted_at, ...)`. Use the title in
  the bubble tooltip, for example "working: Add a T3 Code Screen Pet".
- `scripts/peek-t3-state.mjs` shows these queries against a real database.

For filming, global hotkeys force a state: Ctrl+Alt+1 idle, 2 working, 3 waiting, 4 done, 5 error,
0 back to live T3 status.

## Run

```
npm install
npm start
```
