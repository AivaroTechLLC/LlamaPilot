'use strict';
const fs = require('fs').promises;
const path = require('path');

module.exports = async function readFile(relPath, workspace) {
  const full = path.resolve(workspace, relPath);
  const wsBase = path.resolve(workspace);
  const fullNorm = path.normalize(full).toLowerCase();
  const baseNorm = path.normalize(wsBase).toLowerCase();
  if (!fullNorm.startsWith(baseNorm + path.sep) && fullNorm !== baseNorm)
    throw new Error('Path outside workspace');
  const content = await fs.readFile(full, 'utf8').catch((e) => {
    throw new Error(`Cannot read "${relPath}": ${e.code}`);
  });
  return `${relPath} (${content.split('\n').length} lines):\n\`\`\`\n${content}\n\`\`\``;
};
