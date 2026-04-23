'use strict';
const fs = require('fs').promises;
const path = require('path');

module.exports = async function writeFile(relPath, content, workspace) {
  if (content === undefined) throw new Error('writeFile: content is required');
  const full = path.resolve(workspace, relPath);
  const wsBase = path.resolve(workspace);
  const fullNorm = path.normalize(full).toLowerCase();
  const baseNorm = path.normalize(wsBase).toLowerCase();
  if (!fullNorm.startsWith(baseNorm + path.sep) && fullNorm !== baseNorm)
    throw new Error('Path outside workspace');
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  return `Wrote ${relPath} — ${content.length} chars, ${content.split('\n').length} lines`;
};
