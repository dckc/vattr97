/** @file Directory trees read as bundles: their files and manifest. */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleFiles, makeTreeReader } from '../kernel/tree.js';

/** @import { TreeNode } from '../types.js' */

/**
 * A tree reader over a local directory, served as workerd's disk services
 * serve one.
 *
 * @param {string} root
 */
const readDir = root =>
  makeTreeReader(
    async segments => {
      const path = join(root, ...segments);
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
    },
    segments => segments.join('/'),
    root,
  );

test('a bundle directory may have a file named __proto__', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tree-proto-'));
  try {
    await writeFile(join(dir, '__proto__'), 'export default 1;');
    await writeFile(join(dir, 'main.js'), 'export const x = 1;');
    await writeFile(join(dir, 'worker.json'), '{}');
    const { files } = bundleFiles('dir', await readDir(dir)([]));
    assert.deepEqual(Object.keys(files).sort(), ['__proto__', 'main.js']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a bundle's bad worker.json is named in the error", () => {
  /** @param {string} text @returns {TreeNode} */
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
  assert.throws(
    () => bundleFiles(path, withManifest('{ not json')),
    /^Error: \/nix\/store\/x-bundle\/worker.json: /,
  );
  assert.throws(
    () => bundleFiles(path, withManifest('null')),
    /worker.json is not a JSON object/,
  );
});
