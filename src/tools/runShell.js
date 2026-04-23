'use strict';
const { exec } = require('child_process');
const path = require('path');

module.exports = async function runShell(command, workspace, cwd, sendEvent) {
  const approved = await sendEvent({
    type: 'request_approval',
    kind: 'shell',
    detail: command,
  });
  if (!approved) return 'Command cancelled by user.';

  const workdir = cwd ? path.resolve(workspace, cwd) : workspace;

  return new Promise((resolve) => {
    exec(
      command,
      { cwd: workdir, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = [stdout, stderr].filter(Boolean).join('\n').trim();
        resolve(
          out || (err ? `Exit ${err.code}: ${err.message}` : '(no output)'),
        );
      },
    );
  });
};
