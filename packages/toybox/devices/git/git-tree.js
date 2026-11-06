/**
 * @file Git object ids, as git computes them: a blob's from its bytes, a
 * tree's from the mode, path, and blob id of each file in it, as
 * `git ls-tree -r` lists them. @see {@link treeId}
 */

import { decodeHex, encodeHex } from '@endo/hex';
import { compareUtf8 } from '../byte-order.js';

/** @import { TreeFile } from '../types.js' */

const encoder = new TextEncoder();

/** A tree entry, as git hashes it; `key` is what git sorts by. @typedef {{ name: string, key: string, mode: string, id: Uint8Array }} Entry */

/** @param {Uint8Array[]} parts */
const concat = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};

/** The id of a git object: SHA-1 of `<type> <length>\0<body>`. @param {string} type @param {Uint8Array} body */
const objectId = async (type, body) =>
  new Uint8Array(
    await crypto.subtle.digest(
      'SHA-1',
      concat([encoder.encode(`${type} ${body.length}\0`), body]),
    ),
  );

/** The id of the blob whose contents are `bytes`, in hex. @param {Uint8Array} bytes */
export const blobId = async bytes => encodeHex(await objectId('blob', bytes));

/** @typedef {Map<string, TreeFile | Dir>} Dir */

/** @param {Dir} dir @returns {Promise<Uint8Array>} */
const dirId = async dir => {
  /** @type {Entry[]} */
  const entries = await Promise.all(
    [...dir].map(async ([name, node]) =>
      node instanceof Map
        ? { name, key: `${name}/`, mode: '40000', id: await dirId(node) }
        : { name, key: name, mode: node.mode, id: decodeHex(node.oid) },
    ),
  );
  // git orders a tree's entries by name, a subtree's name as if it ended in
  // "/", comparing bytes (base_name_compare in git's source)
  entries.sort((a, b) => compareUtf8(a.key, b.key));
  return objectId(
    'tree',
    concat(
      entries.flatMap(({ mode, name, id }) => [
        encoder.encode(`${mode} ${name}\0`),
        id,
      ]),
    ),
  );
};

/**
 * The id of the tree of `files`, in hex, as `git write-tree` reports it.
 * Throws if two files have one path, or a file's path is another's
 * directory: no tree lists those, and its id would leave one of them out.
 *
 * @param {TreeFile[]} files
 * @see https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
 */
export const treeId = async files => {
  /** @type {Dir} */
  const root = new Map();
  for (const file of files) {
    const names = file.path.split('/');
    const leaf = /** @type {string} */ (names.pop());
    const dir = names.reduce((d, name) => {
      const sub = d.get(name) ?? new Map();
      if (!(sub instanceof Map))
        throw Error(`${JSON.stringify(file.path)} is under a file`);
      d.set(name, sub);
      return sub;
    }, root);
    if (dir.has(leaf))
      throw Error(
        `${JSON.stringify(file.path)} is listed twice, or is a directory`,
      );
    dir.set(leaf, file);
  }
  return encodeHex(await dirId(root));
};

const LS_TREE_ENTRY = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/s;

/**
 * The files `git ls-tree -r <tree>` lists, with or without `-z`. Only
 * regular files: a symlink or submodule is refused, as is a path with an
 * empty, `.`, or `..` segment. Without `-z`, git quotes a path with a tab,
 * newline, or other unusual character in it; such a path is refused too.
 *
 * @param {string} listing
 * @returns {TreeFile[]}
 */
export const parseLsTree = listing => {
  const nul = listing.includes('\0');
  return listing
    .split(nul ? '\0' : '\n')
    .filter(entry => entry)
    .map(entry => {
      const [, mode, oid, path] = entry.match(LS_TREE_ENTRY) ?? [];
      if (!path)
        throw Error(
          `not a regular file in git ls-tree -r output: ${JSON.stringify(entry.slice(0, 80))}`,
        );
      if (!nul && path.startsWith('"'))
        throw Error(
          `git quoted this path; use git ls-tree -r -z: ${JSON.stringify(path)}`,
        );
      if (path.split('/').some(s => s === '' || s === '.' || s === '..'))
        throw Error(`bad path in git ls-tree output: ${JSON.stringify(path)}`);
      return { mode: /** @type {TreeFile["mode"]} */ (mode), oid, path };
    });
};
