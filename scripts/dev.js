#!/usr/bin/env node
/**
 * Web server development mode with live rebuilding.
 * Runs the Express server via tsx watch (hot reloads on main process changes)
 * and watches renderer files for incremental rebuilds.
 */

const { spawn } = require('child_process');
const { join } = require('path');

const rootDir = join(__dirname, '..');

const procs = [
  // Watch and rebuild renderer on changes (esbuild watch + static file copy)
  spawn('node', [join(__dirname, 'build-renderer.js'), '--watch'], {
    stdio: 'inherit',
    cwd: rootDir,
  }),
  // Run server with hot reload (tsx restarts on main process file changes)
  spawn('npx', ['tsx', 'watch', 'src/main/index.ts'], {
    stdio: 'inherit',
    cwd: rootDir,
    shell: true,
  }),
];

function cleanup() {
  procs.forEach(p => p.kill());
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
