/** @file toybox as a Cloudflare Worker, under `wrangler dev`: the neighbor's boot vat lends the mower, the fence holds, and the yard outlasts a restart. */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { here } from '../src/workerd-process.js';

const wrangler = join(here, '..', '..', 'node_modules', '.bin', 'wrangler');

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

/**
 * Run `wrangler dev` on wrangler.jsonc (built by build-cloudflare.js) with
 * its state in `persist`, until `stop()`; resolves once the app answers.
 *
 * @param {string} persist
 */
const startDev = async persist => {
  const [port, inspector] = [await freePort(), await freePort()];
  const child = spawn(
    wrangler,
    [
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
      '--persist-to',
      persist,
      '--show-interactive-dev-session=false',
      '--log-level',
      'warn',
    ],
    {
      cwd: here,
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
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    process.kill(-(/** @type {number} */ (child.pid)), 'SIGTERM');
    await exited;
  };
  for (let i = 0; i < 200; i += 1) {
    try {
      await fetch(`${base}/`, { method: 'HEAD' });
      return { base, stop };
    } catch {
      await sleep(100);
    }
  }
  await stop();
  throw Error(`wrangler dev did not start:\n${log}`);
};

const persist = await mkdtemp(join(tmpdir(), 'toybox-cf-'));
after(() => rm(persist, { recursive: true, force: true }));

/** @param {string} base */
const yard = async base => {
  const resp = await fetch(`${base}/`);
  assert.equal(resp.status, 200);
  return resp.text();
};

/** @param {string} base @param {number} pushes */
const lend = async (base, pushes) => {
  const resp = await fetch(`${base}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `pushes=${pushes}`,
    redirect: 'manual',
  });
  assert.equal(resp.status, 303);
};

test('lend the mower on wrangler dev: the governed mower stops at the fence, and the yard outlasts a restart', async () => {
  const first = await startDev(persist);
  try {
    assert.match(await yard(first.base), /0 of 64 cells cut/);
    await lend(first.base, 5);
    const page = await yard(first.base);
    assert.match(page, /4 of 64 cells cut/);
    assert.match(
      page,
      /<li>cut \(4, 4\)<\/li><li>cut \(4, 3\)<\/li><li>cut \(4, 2\)<\/li><li>cut \(4, 1\)<\/li><li>fence: 3 cells from start<\/li>/,
    );
  } finally {
    await first.stop();
  }

  const second = await startDev(persist);
  try {
    assert.match(await yard(second.base), /4 of 64 cells cut/);
    await lend(second.base, 1);
    assert.match(
      await yard(second.base),
      /<li>cut \(4, 1\)<\/li><li>fence: 3 cells from start<\/li>/,
    );
  } finally {
    await second.stop();
  }
});
