/** @file Git object ids agree with git's. */
import { execFile } from 'node:child_process';
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { blobId, parseLsTree, treeId } from '../src/devices/git/object-ids.js';
import { makeTree } from '../src/dir-tree.js';
import { makeGit } from './git.js';

/**
 * Node's I/O, as these tests use it: the test is the edge, and each test
 * takes what it uses from here.
 */
const worldP = (async () => {
  const fs = { chmod, cp, mkdir, readFile, rm, symlink, writeFile };
  /** A new directory of its own, for a test. @param {string} prefix */
  const makeDir = async prefix =>
    makeTree(fs, await mkdtemp(join(tmpdir(), prefix)));
  const { makeRepo } = makeGit({
    run: promisify(execFile),
    makeScratchDir: () => makeDir('git-tree-'),
  });
  return {
    /** this package's files */
    pkg: makeTree(fs, fileURLToPath(new URL('..', import.meta.url))),
    makeDir,
    makeRepo,
  };
})();

test('tree ids from git ls-tree listings, and blob ids, are the ones git reports', async t => {
  const { pkg, makeDir, makeRepo } = await worldP;
  const odd = await makeDir('git-tree-odd-');
  t.after(odd.remove);
  // "a.js" < "a/" < "a0": a subtree sorts as if its name ended in "/";
  // git sorts by bytes: U+FF5E before U+1F600, though not in UTF-16 order
  await Promise.all(
    ['a.js', 'a/b.js', 'a0', 'run.sh', '～', '\u{1F600}'].map(f =>
      pkg.copy('test/greeter/main.js', odd, f),
    ),
  );
  await odd.chmod('run.sh', 0o755);
  for (const dir of [pkg.sub('test/greeter'), pkg.sub('examples'), odd]) {
    const { repo, tree, listing } = await makeRepo(dir, 'sub');
    t.after(repo.remove);
    const files = parseLsTree(listing);
    assert.equal(await treeId(files), tree);
    assert.deepEqual(parseLsTree(listing.replaceAll('\0', '\n')), files);
    for (const { path, oid } of files)
      assert.equal(await blobId(await repo.read(path)), oid);
  }
  await odd.symlink('a.js', 'link.js');
  const { repo, listing } = await makeRepo(odd);
  t.after(repo.remove);
  assert.throws(() => parseLsTree(listing), /not a regular file/);
  assert.throws(
    () => parseLsTree(`100644 blob ${'0'.repeat(40)}\t"tab\\there"\n`),
    /git quoted this path/,
  );
});

test('a tree id covers every file listed: names like __proto__ are files, and a listing no tree has is refused', async t => {
  const { pkg, makeDir, makeRepo } = await worldP;
  const odd = await makeDir('git-tree-proto-');
  t.after(odd.remove);
  await Promise.all(
    ['__proto__/x', 'constructor/toString', 'hasOwnProperty'].map(f =>
      pkg.copy('test/greeter/main.js', odd, f),
    ),
  );
  const { repo, tree, listing } = await makeRepo(odd);
  t.after(repo.remove);
  assert.equal(await treeId(parseLsTree(listing)), tree);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);

  const oid = '0'.repeat(40);
  /** @param {string[]} paths */
  const listed = paths =>
    paths.map(path => ({ mode: /** @type {const} */ ('100644'), oid, path }));
  for (const paths of [
    ['a', 'a/b'],
    ['a/b', 'a'],
    ['a', 'a'],
    ['a/b', 'a/b'],
  ])
    await assert.rejects(treeId(listed(paths)), /under a file|listed twice/);
});

test('the empty tree, an empty blob, and the corners of ls-tree listings', async () => {
  assert.equal(await treeId([]), '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  assert.equal(
    await blobId(new Uint8Array()),
    'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
  );
  const oid = 'a'.repeat(40);
  assert.deepEqual(parseLsTree(''), []);
  assert.deepEqual(parseLsTree(`100644 blob ${oid}\tline\nbreak\0`), [
    { mode: '100644', oid, path: 'line\nbreak' },
  ]);
  assert.throws(
    () => parseLsTree(`160000 commit ${oid}\tsub\0`),
    /not a regular file/,
  );
  assert.throws(
    () => parseLsTree(`100644 blob ${oid.toUpperCase()}\tf\0`),
    /not a regular file/,
  );
});
