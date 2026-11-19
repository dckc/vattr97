#!/usr/bin/env node
/** @file Run a toybox from a boot directory, keeping its state, and print the boot vat's link; see src/serve.js. */
import { spawn } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import '../src/node-lockdown.js';

// after lockdown: its top-level await doesn't hold back this module's other imports
const { main } = await import('../src/serve.js');
await main({
  args: process.argv.slice(2),
  print: text => void process.stdout.write(text),
  stopped: new Promise(done => {
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  }),
  cwd: process.cwd(),
  pkgDir: fileURLToPath(new URL('..', import.meta.url)),
  fs: { chmod, cp, mkdir, readFile, rm, symlink, writeFile },
  workerdIO: {
    workerd: workerdPackage.default,
    spawn,
    rm,
    connect,
    createServer,
    sleep,
    log: chunk => void process.stderr.write(chunk),
  },
  fetch,
  WebSocket,
});
