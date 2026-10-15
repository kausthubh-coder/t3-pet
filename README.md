# t3-pet

A desktop pet for [T3 Code](https://github.com/pingdotgg/t3code): a pixel-art T3 mascot that lives on top
of your screen, follows your cursor and shows what your T3 Code agents are doing. Same idea as Codex Pets.

## Run

```
npm install
npm start
```

Electron 44 (pinned), plain JavaScript, no build step. A tray icon has Pause following, Pet it, Go to sleep,
a State menu and Quit.

To check the art without Electron, open `preview.html` in a browser. It shows every animation, the speech
bubbles, frame strips, and a playground that runs the real overlay behaviour inside the page.

## What it does

- One transparent, click-through, always-on-top window covers the work area of the display your cursor is
  on, and moves with the cursor to other monitors.
- The pet walks, or runs when you're far away, to a spot a short distance from the cursor and stands on
  the bottom of the screen. After 30 s without cursor movement it sits down and sleeps; moving the cursor
  wakes it.
- Hover over the pet and that spot becomes clickable. Click it for hearts, or drag it and let go to watch it
  fall and land.

## Hotkeys (for filming)

| Keys | State |
|---|---|
| Ctrl+Alt+1 | idle |
| Ctrl+Alt+2 | working: types on a laptop, bubble with dots |
| Ctrl+Alt+3 | waiting: hops and waves, bubble "?" |
| Ctrl+Alt+4 | done: jumps with sparkles (about 6 s, then idle) |
| Ctrl+Alt+5 | error: sad face and sweat drop (about 6 s, then idle) |
| Ctrl+Alt+0 | back to the live T3 status |

Forced states use the title of your latest T3 thread as the caption.

## How T3 status is detected

The pet polls `%USERPROFILE%\.t3\userdata\statev2.sqlite` once a second, opening it **read-only** and
running only `SELECT`s (`src/status/queries.js`):

| State | When |
|---|---|
| waiting | a row in `orchestration_v2_projection_runtime_requests` has `status = 'pending'` |
| error | a run in `orchestration_v2_projection_runs` has `status = 'failed'` and `completed_at` in the last 6 s |
| done | a run has `status = 'completed'` and `completed_at` in the last 6 s |
| working | a run has `status = 'running'` |
| idle | none of the above |

The states are checked in that order. Runs on archived or deleted threads are ignored, and so are
`running` rows more than 6 hours old (left behind by a crash). The thread title from
`orchestration_v2_projection_threads` is shown in the bubble for a few seconds after a change, and again
while you hover the pet.

The DB is read with `node:sqlite` inside Electron. If that module isn't available, the app spawns the system
`node` to run `src/status/poll-child.js`, which prints one JSON line per second. If the database file
doesn't exist, the pet runs in demo mode (hotkeys only).

Environment overrides: `T3_STATE_DB` (DB path), `T3PET_SQLITE=child` (force the fallback poller),
`T3PET_NODE` (path to the node binary used by the fallback).
