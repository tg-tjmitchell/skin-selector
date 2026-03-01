#!/usr/bin/env node
/**
 * Build the renderer bundle and copy static assets to dist/renderer.
 * Combines the esbuild bundling and static file copying into a single step,
 * removing the need for the copyfiles dependency.
 *
 * Pass --watch to enable watch mode for incremental development rebuilds.
 */

const esbuild = require('esbuild');
const { mkdirSync, cpSync, watch } = require('fs');
const { join } = require('path');

const isWatch = process.argv.includes('--watch');
const srcDir = join(__dirname, '../src/renderer');
const outDir = join(__dirname, '../dist/renderer');
const staticFiles = ['index.html', 'style.css'];

/** Copy HTML and CSS static files from src/renderer to dist/renderer. */
function copyStaticFiles() {
  for (const file of staticFiles) {
    cpSync(join(srcDir, file), join(outDir, file));
  }
}

/**
 * Bundle the renderer TypeScript and copy static HTML/CSS assets to dist/renderer.
 * In watch mode, uses esbuild's incremental context and fs.watch for static files.
 */
async function main() {
  mkdirSync(outDir, { recursive: true });

  const buildOptions = {
    entryPoints: [join(srcDir, 'client.ts')],
    bundle: true,
    outfile: join(outDir, 'client.js'),
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
  };

  if (isWatch) {
    // Copy static files immediately so they are available before esbuild finishes
    copyStaticFiles();

    // Use esbuild's incremental context for TypeScript changes
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();

    // Watch for changes to HTML and CSS static assets
    watch(srcDir, (_event, filename) => {
      if (filename && staticFiles.includes(filename)) {
        try {
          cpSync(join(srcDir, filename), join(outDir, filename));
          console.log(`📋 Copied ${filename}`);
        } catch (_err) {
          // File may be temporarily unavailable during an editor save
        }
      }
    });

    console.log('👀 Watching renderer for changes...');
  } else {
    console.log('Building renderer bundle...');
    await esbuild.build(buildOptions);
    console.log('Copying static assets...');
    copyStaticFiles();
    console.log('✅ Renderer built and static assets copied');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
