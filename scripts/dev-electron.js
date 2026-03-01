#!/usr/bin/env node
/**
 * Electron development mode with live rebuilding and automatic relaunching.
 * - Renderer changes: rebuilt automatically by esbuild watch (refresh window to see changes)
 * - Main process changes: TypeScript recompiled and Electron relaunched automatically
 */

const { spawn, spawnSync } = require('child_process');
const { watch, mkdirSync } = require('fs');
const { join } = require('path');

// The electron package exports the path to the Electron binary
const electronPath = require('electron');
const rootDir = join(__dirname, '..');
const distMainDir = join(rootDir, 'dist/main');

let electronProcess = null;
let rebuildDebounce = null;

/**
 * Launch (or relaunch) the Electron application process.
 */
function startElectron() {
  if (electronProcess) {
    electronProcess.kill();
    electronProcess = null;
  }
  console.log('🚀 Starting Electron...');
  electronProcess = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    cwd: rootDir,
  });
}

/**
 * Recompile the main process TypeScript and restart Electron.
 * Debounced to avoid multiple rapid restarts when many files change at once.
 */
function scheduleRebuildAndRestart() {
  clearTimeout(rebuildDebounce);
  rebuildDebounce = setTimeout(() => {
    console.log('🔨 Main process changed, recompiling...');
    const result = spawnSync('npx', ['tsc', '--noEmitOnError'], {
      stdio: 'inherit',
      cwd: rootDir,
      shell: true,
    });
    if (result.status === 0) {
      startElectron();
    } else {
      console.error('❌ TypeScript compilation failed — fix errors to restart Electron');
    }
  }, 300);
}

// Perform an initial full build to ensure dist/ is up to date before launching
console.log('📦 Initial build...');
spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  cwd: rootDir,
  shell: true,
});

// Start renderer in watch mode (esbuild watch + static file copy on change)
const rendererWatcher = spawn('node', [join(__dirname, 'build-renderer.js'), '--watch'], {
  stdio: 'inherit',
  cwd: rootDir,
});

// Watch main/preload/shared source directories for TypeScript changes
mkdirSync(distMainDir, { recursive: true });
for (const dir of ['src/main', 'src/preload', 'src/shared']) {
  watch(join(rootDir, dir), { recursive: true }, (_event, filename) => {
    if (filename && filename.endsWith('.ts')) {
      scheduleRebuildAndRestart();
    }
  });
}

// Launch Electron with the freshly built output
startElectron();

function cleanup() {
  clearTimeout(rebuildDebounce);
  if (electronProcess) electronProcess.kill();
  rendererWatcher.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
