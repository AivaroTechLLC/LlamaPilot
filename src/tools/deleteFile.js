'use strict';
const fs = require('fs').promises;
const path = require('path');

module.exports = async function deleteFile(relPath, workspace, sendEvent) {
  const full = path.resolve(workspace, relPath);
  const wsBase = path.resolve(workspace);
  const fullNorm = path.normalize(full).toLowerCase();
  const baseNorm = path.normalize(wsBase).toLowerCase();
  if (!fullNorm.startsWith(baseNorm + path.sep) && fullNorm !== baseNorm)
    throw new Error('Path outside workspace');
  const approved = await sendEvent({
    type: 'request_approval',
    kind: 'delete',
    detail: relPath,
  });
  if (!approved) return 'Delete cancelled by user.';
  await fs.unlink(full);
  return `Deleted ${relPath}`;
};
