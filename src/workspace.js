'use strict';
const fs = require('fs').promises;
const path = require('path');

const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '__pycache__',
  '.cache',
  'coverage',
  '.venv',
  'venv',
]);

async function getWorkspaceContext(root, limit = 80) {
  const lines = [];
  await walk(root, root, '', lines, limit);
  return lines.length ? lines.join('\n') : '(empty workspace)';
}

async function walk(root, dir, indent, lines, limit) {
  if (lines.length >= limit) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const e of entries) {
    if (lines.length >= limit) break;
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    lines.push(e.isDirectory() ? `${indent}${e.name}/` : `${indent}${e.name}`);
    if (e.isDirectory())
      await walk(root, path.join(dir, e.name), indent + '  ', lines, limit);
  }
}

async function listDir(relPath, workspace) {
  const abs = path.resolve(workspace, relPath);
  const wsBase = path.resolve(workspace);
  const absNorm = path.normalize(abs).toLowerCase();
  const baseNorm = path.normalize(wsBase).toLowerCase();
  if (!absNorm.startsWith(baseNorm + path.sep) && absNorm !== baseNorm)
    throw new Error('Path outside workspace');
  const entries = await fs.readdir(abs, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.posix.join(relPath, e.name),
    }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

module.exports = { getWorkspaceContext, listDir };
