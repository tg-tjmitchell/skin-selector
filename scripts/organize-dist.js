#!/usr/bin/env node
/**
 * Organize dist/renderer directory structure after TypeScript compilation
 * Moves files from dist/renderer/renderer to dist/renderer
 */

const fs = require('fs');
const path = require('path');

const rendererDirSrc = path.join(__dirname, '../dist/renderer/renderer');
const rendererDirDst = path.join(__dirname, '../dist/renderer');
const sharedDirSrc = path.join(__dirname, '../dist/shared');
const sharedDirDst = path.join(__dirname, '../dist/renderer/shared');

// Move renderer files
if (fs.existsSync(rendererDirSrc)) {
  const files = fs.readdirSync(rendererDirSrc);
  files.forEach(file => {
    const src = path.join(rendererDirSrc, file);
    const dst = path.join(rendererDirDst, file);
    fs.cpSync(src, dst);
  });
  fs.rmSync(rendererDirSrc, { recursive: true });
}

// Move shared directory
if (fs.existsSync(sharedDirSrc) && !fs.existsSync(sharedDirDst)) {
  fs.cpSync(sharedDirSrc, sharedDirDst, { recursive: true });
  fs.rmSync(sharedDirSrc, { recursive: true });
}

console.log('✅ Directory structure organized');
