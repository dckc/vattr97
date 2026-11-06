/** @file The kernel's I/O devices: which there are, and which of workerd's bindings each reaches. */
import { makeFetchDevices } from './fetch.js';
import { TABLES as GIT_TABLES, makeGitTrees } from './git/trees.js';
import { makeNixStores } from './nix/store.js';

/** @import { MakeDevices } from '../kernel/types.js' */

/**
 * toybox's own I/O devices: networks (`fetch`, `lan`), the nix store, and
 * git trees.
 *
 * @type {MakeDevices}
 */
export const makeDevices = (powers, { env, bundles, withTables }) =>
  harden({
    fetch: makeFetchDevices(powers, {
      tag: 'FetchDevice',
      prefix: 'fetch',
      net: env.INTERNET,
    }),
    gitTrees: makeGitTrees(withTables(GIT_TABLES), {
      checkout: env.GIT_CHECKOUT,
    }),
    lan: makeFetchDevices(powers, {
      tag: 'LanDevice',
      prefix: 'lan',
      net: env.LAN,
    }),
    nixStore: makeNixStores(powers, { store: env.NIX_STORE, bundles }),
  });
