/** @file toybox as a Cloudflare Worker, under `wrangler dev`: the neighbor's boot vat lends the mower, the fence holds, and the yard outlasts a restart; and the wallet's owner, with the owner key, endows a guest's definition. */
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
import { runStatement } from '../examples/wallet/gateway/blocks.js';

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
   * @param {object} [opts]
   * @param {string} [opts.config] a wrangler config other than wrangler.jsonc
   * @param {Record<string, string>} [opts.vars] vars, such as secrets, for the Worker
   */
  const startDev = async (persist, { config, vars = {} } = {}) => {
    const [port, inspector] = [await freePort(), await freePort()];
    const child = spawn(
      workspace.path('node_modules/.bin/wrangler'),
      [
        'dev',
        ...(config ? ['--config', config] : []),
        ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
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

  /**
   * Build toybox with `boot` and `source` (paths in the package) into
   * `out`, beside a copy of wrangler.jsonc that deploys it; answers the
   * copy's path.
   *
   * @param {Tree} out
   * @param {string} boot
   * @param {string} source
   */
  const buildInto = async (out, boot, source) => {
    const pkg = workspace.sub('packages/toybox');
    const child = spawn(
      process.execPath,
      ['build-cloudflare.js', '--out', out.path('dist'), boot, source],
      { cwd: pkg.path(), stdio: ['ignore', 'inherit', 'inherit'] },
    );
    const code = await new Promise(resolve => child.on('exit', resolve));
    if (code !== 0) throw Error(`build-cloudflare.js exited ${code}`);
    const config = (await pkg.readText('wrangler.jsonc'))
      .replace(/"\$schema": "[^"]*",/, '')
      .replace(
        '"main": "dist/cloudflare/worker.js"',
        '"main": "dist/worker.js"',
      )
      .replace('"base_dir": "dist/cloudflare"', '"base_dir": "dist"');
    await out.writeText('wrangler.jsonc', config);
    return out.path('wrangler.jsonc');
  };

  return {
    startDev,
    buildInto,
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

/**
 * The wallet page's API on `dev`, as `agent`: POST a request, get its JSON
 * answer.
 *
 * @param {Dev} dev
 * @param {string} agent a swiss number, as a link's fragment holds it
 * @param {Record<string, unknown>} req
 * @returns {Promise<Record<string, unknown>>}
 */
const onPage = async ({ app }, agent, req) => {
  const resp = await app('/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent, ...req }),
  });
  /** @type {Record<string, unknown>} the page API answers a JSON object */
  const data = await resp.json();
  assert.ok(resp.ok, JSON.stringify(data));
  return data;
};

/** @param {string} link such as `#agent=…` */
const agentOf = link => {
  const m = /^#agent=([^\s]+)$/.exec(link.trim());
  if (!m) throw Error(`not an agent link: ${JSON.stringify(link)}`);
  return m[1];
};

/** What hal proposes: something that counts twice, with a counter it's endowed with. */
const TWICE = {
  'main.js': `export const buildRootObject = ({ E, Far }, { counter }) =>
  Far('twice', {
    async twice() {
      await E(counter).incr();
      return E(counter).incr();
    },
  });
`,
};

test("the wallet on wrangler dev: with the owner key, owen gets his link, endows hal's definition with a counter, and the count outlasts a restart", async t => {
  const { startDev, buildInto, makeDir } = await worldP;
  const out = await makeDir('toybox-cf-wallet-');
  t.after(out.remove);
  const config = await buildInto(out, 'examples/wallet', 'examples');
  const persist = out.sub('state');
  await persist.ensureDir();
  const vars = { OWNER_KEY: 'sekrit-owner-key' };

  /** @type {string} */
  let owen = '';
  await t.test('owen endows what hal defines', async t => {
    const dev = await startDev(persist, { config, vars });
    t.after(dev.stop);
    /** @param {RequestInit} [init] */
    const owner = init => dev.app('/.toybox/owner', init);

    assert.equal((await owner()).status, 405);
    assert.equal((await owner({ method: 'POST', body: 'guess' })).status, 403);
    const resp = await owner({ method: 'POST', body: vars.OWNER_KEY });
    assert.equal(resp.status, 200);
    owen = agentOf(await resp.text());

    await onPage(dev, owen, {
      op: 'call',
      target: 'counters',
      method: 'makeCounter',
      saveAs: 'c',
    });
    const { guest } = await onPage(dev, owen, {
      op: 'provideGuest',
      name: 'hal',
    });
    assert.equal(typeof guest, 'string');
    await onPage(dev, String(guest), {
      op: 'define',
      modules: TWICE,
      slots: { counter: { label: 'a counter to count on' } },
    });

    const { messages } = await onPage(dev, owen, { op: 'view' });
    assert.ok(Array.isArray(messages));
    const proposal = messages.find(m => m.from === 'hal');
    assert.equal(proposal?.type, 'definition');
    await onPage(dev, owen, {
      op: 'endow',
      number: proposal.number,
      bindings: { counter: 'c' },
      saveAs: 'twice',
    });
    const { answer } = await onPage(dev, owen, {
      op: 'call',
      target: 'twice',
      method: 'twice',
    });
    assert.equal(answer, 2);
  });

  await t.test('the blocks page runs a nested call through /api', async t => {
    const dev = await startDev(persist, { config, vars });
    t.after(dev.stop);
    const page = await dev.app('/blocks');
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get('content-security-policy') ?? '',
      /script-src 'self' https:\/\/cdnjs\.cloudflare\.com/,
    );
    assert.match(await page.text(), /integrity="sha384-/);
    assert.equal((await dev.app('/blocks.js')).status, 200);

    let n = 0;
    const answer = await runStatement(
      req => onPage(dev, owen, req),
      {
        save: 'n',
        expr: {
          call: {
            target: {
              call: {
                target: { pet: 'counters' },
                method: 'makeCounter',
                args: [],
              },
            },
            method: 'incr',
            args: [],
          },
        },
      },
      () => `_t${(n += 1)}`,
    );
    assert.equal(answer, 1);
    const { names } = await onPage(dev, owen, { op: 'view' });
    assert.ok(Array.isArray(names));
    assert.ok(!names.some(({ name }) => name.startsWith('_t')));
  });

  await t.test('after a restart', async t => {
    const dev = await startDev(persist, { config, vars });
    t.after(dev.stop);
    const { answer } = await onPage(dev, owen, {
      op: 'call',
      target: 'c',
      method: 'read',
    });
    assert.equal(answer, 2);
  });
});
