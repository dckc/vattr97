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
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { blobId, parseLsTree, treeId } from '../devices/git/git-tree.js';
import { makeGit } from './git.js';
import { here } from '../workerd-process.js';

const { makeRepo } = makeGit({
  run: promisify(execFile),
  cp,
  makeScratchDir: () => mkdtemp(join(tmpdir(), 'git-tree-')),
});

test('tree ids from git ls-tree listings, and blob ids, are the ones git reports', async () => {
  const odd = await mkdtemp(join(tmpdir(), 'git-tree-odd-'));
  const main = join(here, 'test', 'greeter', 'main.js');
  // "a.js" < "a/" < "a0": a subtree sorts as if its name ended in "/";
  // git sorts by bytes: U+FF5E before U+1F600, though not in UTF-16 order
  await Promise.all(
    ['a.js', 'a/b.js', 'a0', 'run.sh', '\uFF5E', '\u{1F600}'].map(f =>
      cp(main, join(odd, f)),
    ),
  );
  await chmod(join(odd, 'run.sh'), 0o755);
  try {
    for (const dir of [
      join(here, 'test', 'greeter'),
      join(here, 'examples'),
      odd,
    ]) {
      const { repo, tree, listing } = await makeRepo(dir, 'sub');
      const files = parseLsTree(listing);
      assert.equal(await treeId(files), tree);
      assert.deepEqual(parseLsTree(listing.replaceAll('\0', '\n')), files);
      for (const { path, oid } of files)
        assert.equal(await blobId(await readFile(join(repo, path))), oid);
      await rm(repo, { recursive: true, force: true });
    }
    await symlink('a.js', join(odd, 'link.js'));
    const { repo, listing } = await makeRepo(odd);
    await rm(repo, { recursive: true, force: true });
    assert.throws(() => parseLsTree(listing), /not a regular file/);
    assert.throws(
      () => parseLsTree(`100644 blob ${'0'.repeat(40)}\t"tab\\there"\n`),
      /git quoted this path/,
    );
  } finally {
    await rm(odd, { recursive: true, force: true });
  }
});

test('a tree id covers every file listed: names like __proto__ are files, and a listing no tree has is refused', async () => {
  const odd = await mkdtemp(join(tmpdir(), 'git-tree-proto-'));
  const main = join(here, 'test', 'greeter', 'main.js');
  await mkdir(join(odd, '__proto__'));
  await mkdir(join(odd, 'constructor'));
  await Promise.all(
    ['__proto__/x', 'constructor/toString', 'hasOwnProperty'].map(f =>
      cp(main, join(odd, f)),
    ),
  );
  try {
    const { repo, tree, listing } = await makeRepo(odd);
    await rm(repo, { recursive: true, force: true });
    assert.equal(await treeId(parseLsTree(listing)), tree);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
  } finally {
    await rm(odd, { recursive: true, force: true });
  }

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
