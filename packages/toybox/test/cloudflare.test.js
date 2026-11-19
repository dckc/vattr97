/** @file toybox as a Cloudflare Worker, under `wrangler dev`: the neighbor's boot vat lends the mower, the fence holds, and the yard outlasts a restart. */
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
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { makeTree } from '../src/dir-tree.js';

/** @import { Tree } from '../src/dir-tree.js' */

/**
 * Node's I/O, as this test uses it: the test is the edge, and takes what
 * it uses from here.
 */
const worldP = (async () => {
  /** @returns {Promise<number>} */
  const freePort = () =>
    new Promise(resolve => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const { port } = /** @type {import('node:net').AddressInfo} */ (
          s.address()
        );
        s.close(() => resolve(port));
      });
    });
  const fs = { chmod, cp, mkdir, readFile, rm, symlink, writeFile };
  const workspace = makeTree(
    fs,
    fileURLToPath(new URL('../../..', import.meta.url)),
  );

  /**
   * Run `wrangler dev` on wrangler.jsonc (built by build-cloudflare.js) with
   * its state in `persist`, until `stop()`; resolves once the app answers.
   *
   * @param {Tree} persist
   */
  const startDev = async persist => {
    const [port, inspector] = [await freePort(), await freePort()];
    const child = spawn(
      workspace.path('node_modules/.bin/wrangler'),
      [
        'dev',
        ...['--ip', '127.0.0.1', '--port', String(port)],
        ...['--inspector-port', String(inspector)],
        ...['--persist-to', persist.path()],
        '--show-interactive-dev-session=false',
        ...['--log-level', 'warn'],
      ],
      {
        cwd: workspace.path('packages/toybox'),
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
        // its own process group, so stop() reaches the workerd it starts
        detached: true,
      },
    );
    let log = '';
    child.stdout.on('data', c => (log += c));
    child.stderr.on('data', c => (log += c));
    const exited = new Promise(resolve => child.on('exit', resolve));
    /** @param {string} path @param {RequestInit} [init] */
    const app = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
    const stop = async () => {
      process.kill(-(/** @type {number} */ (child.pid)), 'SIGTERM');
      await exited;
    };
    for (let i = 0; i < 200; i += 1) {
      try {
        await app('/', { method: 'HEAD' });
        return { app, stop };
      } catch {
        await sleep(100);
      }
    }
    await stop();
    throw Error(`wrangler dev did not start:\n${log}`);
  };

  return {
    startDev,
    /** A new directory of its own, for a test. @param {string} prefix */
    makeDir: async prefix =>
      makeTree(fs, await mkdtemp(join(tmpdir(), prefix))),
  };
})();

/** @typedef {Awaited<ReturnType<Awaited<typeof worldP>['startDev']>>} Dev */

/** @param {Dev} dev */
const yard = async ({ app }) => {
  const resp = await app('/');
  assert.equal(resp.status, 200);
  return resp.text();
};

/** @param {Dev} dev @param {number} pushes */
const lend = async ({ app }, pushes) => {
  const resp = await app('/run', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `pushes=${pushes}`,
    redirect: 'manual',
  });
  assert.equal(resp.status, 303);
};

test('lend the mower on wrangler dev: the governed mower stops at the fence, and the yard outlasts a restart', async t => {
  const { startDev, makeDir } = await worldP;
  const persist = await makeDir('toybox-cf-');
  t.after(persist.remove);

  await t.test('lend the mower', async t => {
    const dev = await startDev(persist);
    t.after(dev.stop);
    assert.match(await yard(dev), /0 of 64 cells cut/);
    await lend(dev, 5);
    const page = await yard(dev);
    assert.match(page, /4 of 64 cells cut/);
    assert.match(
      page,
      /<li>cut \(4, 4\)<\/li><li>cut \(4, 3\)<\/li><li>cut \(4, 2\)<\/li><li>cut \(4, 1\)<\/li><li>fence: 3 cells from start<\/li>/,
    );
  });

  await t.test('after a restart', async t => {
    const dev = await startDev(persist);
    t.after(dev.stop);
    assert.match(await yard(dev), /4 of 64 cells cut/);
    await lend(dev, 1);
    assert.match(
      await yard(dev),
      /<li>cut \(4, 1\)<\/li><li>fence: 3 cells from start<\/li>/,
    );
  });
});
