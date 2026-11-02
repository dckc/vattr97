/** @file nixStores: bundleCaps for nix store paths, keyed by their NAR hashes. */
import { M } from '@endo/patterns';
import { narHash } from '../nar.js';
import { COMPATIBILITY_DATE, decode } from './bundles.js';
import { kernelObjects } from './objects.js';

/**
 * @import { KernelPowers } from '../types.js';
 * @import { NarNode } from '../nar.js';
 * @import { Manifest, makeBundles } from './bundles.js';
 */

/** A store path: a nix base-32 hash, then a name. */
const STORE_PATH =
  /^\/nix\/store\/([0-9a-df-np-sv-z]{32}-[A-Za-z0-9+\-._?=]+)$/;

/**
 * The files of a store path's contents, by path; a file alone is `main.js`.
 *
 * @param {NarNode} node
 * @param {string} [prefix]
 * @returns {Record<string, Uint8Array>}
 */
const filesOf = (node, prefix = '') =>
  node.type === 'regular'
    ? { [prefix || 'main.js']: node.contents }
    : Object.assign(
        {},
        ...Object.entries(node.entries).map(([name, child]) =>
          filesOf(child, prefix ? `${prefix}/${name}` : name),
        ),
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
  const {
    mainModule = 'main.js',
    compatibilityDate = COMPATIBILITY_DATE,
    compatibilityFlags = [],
  } = json ? JSON.parse(decode(json)) : {};
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
  /**
   * A store path, through the store service: a file's contents, or a
   * directory's listing (`[{ name, type }]`, symlinks followed).
   *
   * @param {string[]} segments the store path's name, then names within it
   */
  const storeFetch = async segments => {
    const resp = await store.fetch(
      `http://nix-store/${segments.map(encodeURIComponent).join('/')}`,
    );
    if (!resp.ok)
      throw Error(`/nix/store/${segments.join('/')} is not in the nix store`);
    return resp;
  };

  /**
   * The contents of a store path, as {@link narHash} takes them.
   *
   * @param {string[]} segments
   * @returns {Promise<NarNode>}
   */
  const readStore = async segments => {
    const path = `/nix/store/${segments.join('/')}`;
    const resp = await storeFetch(segments);
    if (resp.headers.get('content-type') === 'application/octet-stream')
      return {
        type: 'regular',
        contents: new Uint8Array(await resp.arrayBuffer()),
      };
    /** @type {Record<string, NarNode>} */
    const entries = {};
    /** @type {{ name: string, type: string }[]} */
    const listing = await resp.json();
    for (const { name, type } of listing) {
      if (type !== 'file' && type !== 'directory')
        throw Error(
          `${path}/${name} is a ${type}; a bundle has only files and directories`,
        );
      entries[name] = await readStore([...segments, name]);
    }
    return { type: 'directory', entries };
  };

  return harden({
    ...kernelObjects(
      'NixStore',
      M.interface('NixStore', {
        getBundleCap: M.call(M.string()).returns(M.promise()),
      }),
      {
        /** @param {string} path */
        async getBundleCap(path) {
          const [, name] = path.match(STORE_PATH) ?? [];
          if (!name) throw Error('not a store path');
          const node = await readStore([name]);
          const files = filesOf(node);
          const manifest = manifestOf(path, node, files);
          delete files['worker.json'];
          return standIn(
            bundles.installNar(await narHash(node), manifest, files),
          );
        },
      },
    ),
    /** A nixStore: whoever holds it can make a bundleCap for any file in the nix store. */
    make: () => kernelObject(`nixStore:${next('nixStore')}`),
  });
};
