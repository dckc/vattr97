/** @file Directory trees, as workerd's disk services serve them, and the bundles they make: files and a manifest. */
import { COMPATIBILITY_DATE, decode } from './bundles.js';

/** @import { Manifest, TreeNode } from './types.js' */

/**
 * The files of a tree, by path; a file alone is `main.js`.
 *
 * @param {TreeNode} node
 * @param {string} [prefix]
 * @returns {[string, Uint8Array][]}
 */
const fileEntries = (node, prefix = '') =>
  node.type === 'regular'
    ? [[prefix || 'main.js', node.contents]]
    : Object.entries(node.entries).flatMap(([name, child]) =>
        fileEntries(child, prefix ? `${prefix}/${name}` : name),
      );

/**
 * A bundle's manifest, from its worker.json (or, for a file alone, the
 * defaults), checked against its files.
 *
 * @param {string} path
 * @param {TreeNode} node
 * @param {Record<string, Uint8Array>} files
 * @returns {Manifest}
 */
const manifestOf = (path, node, files) => {
  const json = files['worker.json'];
  if (node.type !== 'regular' && !json)
    throw Error(`${path} has no worker.json`);
  /** @type {Record<string, unknown>} what worker.json says, checked below */
  let declared = {};
  if (json) {
    try {
      declared = JSON.parse(decode(json));
    } catch (e) {
      throw Error(`${path}/worker.json: ${/** @type {Error} */ (e).message}`, {
        cause: e,
      });
    }
    if (typeof declared !== 'object' || declared === null)
      throw Error(`${path}/worker.json is not a JSON object`);
  }
  const {
    mainModule = 'main.js',
    compatibilityDate = COMPATIBILITY_DATE,
    compatibilityFlags = [],
  } = declared;
  if (
    typeof mainModule !== 'string' ||
    !files[mainModule] ||
    !/\.m?js$/.test(mainModule)
  )
    throw Error(`${path}: mainModule must name a .js file in it`);
  if (
    typeof compatibilityDate !== 'string' ||
    !Array.isArray(compatibilityFlags) ||
    !compatibilityFlags.every(f => typeof f === 'string')
  )
    throw Error(
      `${path}: compatibilityDate is a string; compatibilityFlags, an array of them`,
    );
  return { mainModule, compatibilityDate, compatibilityFlags };
};

/**
 * The tree `node`, read from `path`, as a bundle: a file is a bundle of one
 * module; a directory's files are its modules, its `worker.json` naming the
 * main one and perhaps a compatibility date and flags.
 *
 * @param {string} path
 * @param {TreeNode} node
 * @returns {{ manifest: Manifest, files: Record<string, Uint8Array> }}
 */
export const bundleFiles = (path, node) => {
  // fromEntries, not assignment: a file may be named __proto__
  const files = Object.fromEntries(fileEntries(node));
  const manifest = manifestOf(path, node, files);
  delete files['worker.json'];
  return { manifest, files };
};

/**
 * A reader of a directory tree served as config.capnp's disk services
 * serve one: a file's contents, or a directory's listing (`[{ name, type }]`,
 * where a symlink's type is `symlink`). It refuses anything but files and
 * directories, so a symlink can't lead it in a cycle.
 *
 * @param {(segments: string[]) => Promise<Response>} fetchPath
 * @param {(segments: string[]) => string} describe a path, for messages
 * @param {string} where the tree as a whole, for messages
 */
export const makeTreeReader = (fetchPath, describe, where) => {
  /**
   * @param {string[]} segments
   * @returns {Promise<TreeNode>}
   */
  const read = async segments => {
    const resp = await fetchPath(segments);
    if (!resp.ok) throw Error(`${describe(segments)} is not in ${where}`);
    if (resp.headers.get('content-type') === 'application/octet-stream')
      return {
        type: 'regular',
        contents: new Uint8Array(await resp.arrayBuffer()),
      };
    /** @type {[string, TreeNode][]} */
    const entries = [];
    /** @type {{ name: string, type: string }[]} */
    const listing = await resp.json();
    for (const { name, type } of listing) {
      if (type !== 'file' && type !== 'directory')
        throw Error(
          `${describe([...segments, name])} is a ${type}; a bundle has only files and directories`,
        );
      entries.push([name, await read([...segments, name])]);
    }
    // fromEntries, not assignment: a file may be named __proto__
    return { type: 'directory', entries: Object.fromEntries(entries) };
  };
  return read;
};
