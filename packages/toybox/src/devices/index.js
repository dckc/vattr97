/** @file The kernel's I/O devices: which there are, and which of workerd's bindings each reaches. */
import { makeEntropy } from './entropy.js';
import { makeFetchDevices } from './fetch.js';
import { TABLES as GIT_TABLES, makeGitTrees } from './git/trees.js';
import { makeNixStores } from './nix/store.js';

/** @import { MakeDevices } from '../kernel/types.js' */

/**
 * toybox's own I/O devices: networks (`fetch`, `lan`), the nix store, git
 * trees, and entropy.
 *
 * @type {MakeDevices}
 */
export const makeDevices = (powers, { env, bundles, random, withTables }) =>
  harden({
    entropy: makeEntropy(powers, { random }),
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
