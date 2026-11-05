/** @file NAR hashes of store paths agree with nix's. */
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { narHash } from '../nar.js';
import { makeNix } from './nix.js';
import { here } from '../workerd-process.js';

const { addToStore, narHashOf } = makeNix({ run: promisify(execFile) });

/** @import { NarNode } from '../nar.js' */

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
