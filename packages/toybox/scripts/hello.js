#!/usr/bin/env node
/** @file Start a toybox in a scratch directory and serve a hello-world vat; see src/hello.js. */
import { spawn } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import '../src/node-lockdown.js';

// after lockdown: its top-level await doesn't hold back this module's other imports
const { main } = await import('../src/hello.js');
await main({
  args: process.argv.slice(2),
  print: text => void process.stdout.write(text),
  interrupted: new Promise(resolve => process.once('SIGINT', resolve)),
  pkgDir: fileURLToPath(new URL('..', import.meta.url)),
  makeScratchDir: () => mkdtemp(join(tmpdir(), 'toybox-hello-')),
  fs: { chmod, cp, mkdir, readFile, rm, symlink, writeFile },
  workerdIO: {
    workerd: workerdPackage.default,
    spawn,
    rm,
    connect,
    createServer,
    sleep,
  },
  fetch,
  WebSocket,
});
