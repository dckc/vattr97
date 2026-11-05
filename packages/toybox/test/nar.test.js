/** @file NAR hashes of store paths agree with nix's. */
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { narHash } from '../nar.js';
import { installTree, makeTreeReader } from '../devices/nix-store.js';
import { makeNix } from './nix.js';
import { here } from '../workerd-process.js';

const { addToStore, narHashOf } = makeNix({ run: promisify(execFile) });

/** @import { NarNode } from '../nar.js' */
/** @import { Kref } from '../types.js' */

/** @param {string} path a regular file or a directory of them @returns {Promise<NarNode>} */
const narNode = async path => {
  const entries = await readdir(path, { withFileTypes: true }).catch(
    () => null,
  );
  if (!entries) return { type: 'regular', contents: await readFile(path) };
  /** @type {[string, NarNode][]} */
  const nodes = await Promise.all(
    entries.map(async e => [e.name, await narNode(join(path, e.name))]),
  );
  return { type: 'directory', entries: Object.fromEntries(nodes) };
};

test('NAR hashes of a file and a directory are the ones nix path-info reports', async () => {
  // nix sorts by bytes: U+FF5E before U+1F600, though not in UTF-16 order
  const odd = await mkdtemp(join(tmpdir(), 'nar-odd-'));
  await Promise.all(
    ['\uFF5E', '\u{1F600}'].map(f =>
      cp(join(here, 'kvats', 'counter.js'), join(odd, f)),
    ),
  );
  try {
    for (const path of [
      join(here, 'kvats', 'counter.js'),
      join(here, 'test', 'greeter'),
      odd,
    ]) {
      assert.equal(
        await narHash(await narNode(path)),
        await narHashOf(await addToStore(path)),
      );
    }
  } finally {
    await rm(odd, { recursive: true, force: true });
  }
});

test('a NAR hash refuses a name no store path has', async () => {
  const file = {
    type: /** @type {const} */ ('regular'),
    contents: new Uint8Array(),
  };
  for (const name of ['', '.', '..', 'a/b', 'a\0b'])
    await assert.rejects(
      narHash({ type: 'directory', entries: { [name]: file } }),
      /not a name nix allows/,
    );
});

test('a store directory may have a file named __proto__', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nar-proto-'));
  await cp(join(here, 'kvats', 'counter.js'), join(dir, '__proto__'));
  await cp(join(here, 'kvats', 'counter.js'), join(dir, 'main.js'));
  try {
    const storePath = await addToStore(dir);
    const name = storePath.slice('/nix/store/'.length);
    /** @param {string[]} segments */
    const fetchPath = async segments => {
      const path = join('/nix/store', ...segments);
      const listing = await readdir(path, { withFileTypes: true }).catch(
        () => null,
      );
      return listing
        ? Response.json(
            listing.map(e => ({
              name: e.name,
              type: e.isDirectory() ? 'directory' : 'file',
            })),
          )
        : new Response(await readFile(path), {
            headers: { 'content-type': 'application/octet-stream' },
          });
    };
    const node = await makeTreeReader(fetchPath, String, 'the store')([name]);
    assert.equal(await narHash(node), await narHashOf(storePath));
    /** @type {Record<string, Uint8Array>} */
    let installed = {};
    const bundles = {
      /** @param {string} _nar @param {unknown} _m @param {Record<string, Uint8Array>} files @returns {Kref} */
      installNar: (_nar, _m, files) => {
        installed = files;
        return 'ko1';
      },
    };
    await installTree(bundles, storePath, {
      type: 'directory',
      entries: {
        ...(node.type === 'directory' ? node.entries : {}),
        'worker.json': {
          type: 'regular',
          contents: new TextEncoder().encode('{}'),
        },
      },
    });
    assert.deepEqual(Object.keys(installed).sort(), ['__proto__', 'main.js']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a store bundle's bad worker.json is named in the error", async () => {
  const bundles = {
    /** @returns {Kref} */
    installNar: () => 'ko1',
  };
  /** @param {string} text @returns {NarNode} */
  const withManifest = text => ({
    type: 'directory',
    entries: {
      'main.js': { type: 'regular', contents: new Uint8Array() },
      'worker.json': {
        type: 'regular',
        contents: new TextEncoder().encode(text),
      },
    },
  });
  const path = '/nix/store/x-bundle';
  await assert.rejects(
    installTree(bundles, path, withManifest('{ not json')),
    /^Error: \/nix\/store\/x-bundle\/worker.json: /,
  );
  await assert.rejects(
    installTree(bundles, path, withManifest('null')),
    /worker.json is not a JSON object/,
  );
});
