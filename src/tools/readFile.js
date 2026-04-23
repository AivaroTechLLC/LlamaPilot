'use strict';
const fs = require('fs').promises;
const path = require('path');

module.exports = async function readFile(relPath, workspace) {
  const full = path.resolve(workspace, relPath);
  if (!full.startsWith(path.resolve(workspace)))
    throw new Error('Path outside workspace');
  const content = await fs.readFile(full, 'utf8').catch((e) => {
    throw new Error(`Cannot read "${relPath}": ${e.code}`);
  });
  return `${relPath} (${content.split('\n').length} lines):\n\`\`\`\n${content}\n\`\`\``;
};
