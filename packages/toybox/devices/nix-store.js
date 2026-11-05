/** @file nixStores: bundleCaps for nix store paths, keyed by their NAR hashes. */
import { M } from '@endo/patterns';
import { narHash } from '../nar.js';
import { COMPATIBILITY_DATE, decode } from './bundles.js';
import { kzone } from './objects.js';

/**
 * @import { KernelPowers, Manifest, NarNode } from '../types.js';
 * @import { makeBundles } from './bundles.js';
 */

/** A store path: a nix base-32 hash, then a name. */
const STORE_PATH =
  /^\/nix\/store\/([0-9a-df-np-sv-z]{32}-[A-Za-z0-9+\-._?=]+)$/;

/**
 * The files of a store path's contents, by path; a file alone is `main.js`.
 *
 * @param {NarNode} node
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
 * @param {NarNode} node
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
 * A reader of a directory tree served as config.capnp's disk services
 * serve one: a file's contents, or a directory's listing (`[{ name, type }]`,
 * symlinks followed). It answers the tree as {@link narHash} takes it,
 * refusing anything but files and directories.
 *
 * @param {(segments: string[]) => Promise<Response>} fetchPath
 * @param {(segments: string[]) => string} describe a path, for messages
 * @param {string} where the tree as a whole, for messages
 */
export const makeTreeReader = (fetchPath, describe, where) => {
  /**
   * @param {string[]} segments
   * @returns {Promise<NarNode>}
   */
  const read = async segments => {
    const resp = await fetchPath(segments);
    if (!resp.ok) throw Error(`${describe(segments)} is not in ${where}`);
    if (resp.headers.get('content-type') === 'application/octet-stream')
      return {
        type: 'regular',
        contents: new Uint8Array(await resp.arrayBuffer()),
      };
    /** @type {[string, NarNode][]} */
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

/**
 * Keep the tree `node`, read from `path`, as a bundle, by its NAR hash;
 * answers its bundleCap's kref. A file is a bundle of one module; a
 * directory's files are its modules, its `worker.json` naming the main one.
 *
 * @param {Pick<ReturnType<typeof makeBundles>, 'installNar'>} bundles
 * @param {string} path
 * @param {NarNode} node
 */
export const installTree = async (bundles, path, node) => {
  const files = Object.fromEntries(fileEntries(node));
  const manifest = manifestOf(path, node, files);
  delete files['worker.json'];
  return bundles.installNar(await narHash(node), manifest, files);
};

/**
 * nixStores: `getBundleCap(path)` answers the bundleCap for a store
 * path, read through config.capnp's read-only `nix-store` service and keyed
 * by its NAR hash (nar.js), so the same contents give the same bundleCap. A
 * file is a bundle of one module. A directory's files are its modules,
 * named by their paths in it; its `worker.json` names the main module, and
 * may give a compatibility date and flags. Symlinks, and anything not in
 * the store, are refused.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {{ fetch: (url: string) => Promise<Response> }} io.store config.capnp's `nix-store` service
 * @param {ReturnType<typeof makeBundles>} io.bundles
 */
export const makeNixStores = (
  { next, kernelObject, standIn },
  { store, bundles },
) => {
  const readStore = makeTreeReader(
    segments =>
      store.fetch(
        `http://nix-store/${segments.map(encodeURIComponent).join('/')}`,
      ),
    segments => `/nix/store/${segments.join('/')}`,
    'the nix store',
  );

  return harden({
    ...kzone.exoClass(
      'NixStore',
      M.interface('NixStore', {
        getBundleCap: M.call(M.string()).returns(M.promise()),
      }),
      {
        /** @param {string} path */
        async getBundleCap(path) {
          const [, name] = path.match(STORE_PATH) ?? [];
          if (!name) throw Error('not a store path');
          return standIn(
            await installTree(bundles, path, await readStore([name])),
          );
        },
      },
    ),
    /** A nixStore: whoever holds it can make a bundleCap for any file in the nix store. */
    make: () => kernelObject(`nixStore:${next('nixStore')}`),
  });
};
