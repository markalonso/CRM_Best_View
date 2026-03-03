#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const nextDir = path.join(root, '.next');
const srcStatic = path.join(nextDir, 'static');
const targetRoot = path.join(nextDir, '_next');
const targetStatic = path.join(targetRoot, 'static');

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(srcPath);
      try { fs.unlinkSync(destPath); } catch {}
      fs.symlinkSync(link, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(nextDir)) {
  console.log('[netlify-fix-next-assets] .next directory not found; skipping.');
  process.exit(0);
}

if (!fs.existsSync(srcStatic)) {
  console.log('[netlify-fix-next-assets] .next/static not found; skipping.');
  process.exit(0);
}

fs.mkdirSync(targetRoot, { recursive: true });
copyRecursive(srcStatic, targetStatic);

console.log('[netlify-fix-next-assets] Copied static assets:');
console.log(`  from: ${path.relative(root, srcStatic)}`);
console.log(`  to:   ${path.relative(root, targetStatic)}`);
