'use strict';
const fs = require('fs').promises;
const path = require('path');

module.exports = async function writeFile(relPath, content, workspace) {
  if (content === undefined) throw new Error('writeFile: content is required');
  const full = path.resolve(workspace, relPath);
  if (!full.startsWith(path.resolve(workspace)))
    throw new Error('Path outside workspace');
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  return `Wrote ${relPath} — ${content.length} chars, ${content.split('\n').length} lines`;
};
