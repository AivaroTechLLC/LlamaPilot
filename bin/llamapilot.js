#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron');

const appRoot = path.join(__dirname, '..');
const workspace = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : process.cwd();

const proc = spawn(
  String(electronPath),
  [appRoot, `--workspace=${workspace}`],
  {
    stdio: 'inherit',
    windowsHide: false,
    env: { ...process.env },
  },
);

proc.on('close', (code) => process.exit(code ?? 0));
proc.on('error', (err) => {
  console.error('Failed to start LlamaPilot:', err.message);
  process.exit(1);
});
