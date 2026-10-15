// Starts Electron without ELECTRON_RUN_AS_NODE. T3 Code (itself Electron) sets it for its child processes,
// so a terminal opened from T3 would otherwise run main.js as plain Node and crash on `app`.
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(__dirname, '..')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
