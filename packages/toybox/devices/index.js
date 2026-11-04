/** @file The kernel's I/O devices: which there are, and which of workerd's bindings each reaches. */
import { makeEntropy } from './entropy.js';
import { makeFetchDevices } from './fetch.js';
import { TABLES as GIT_TABLES, makeGit } from './git.js';
import { makeNixStores } from './nix-store.js';

/**
 * @import { Device, KernelPowers, WithTables } from '../types.js';
 * @import { makeBundles } from './bundles.js';
 */

/**
 * The kernel's I/O devices, by name: the boot vat gets one of each under that
 * name, and an admin session's `makeDevice(name)` makes one.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {Env} io.env
 * @param {ReturnType<typeof makeBundles>} io.bundles
 * @param {(n: number) => Uint8Array} io.random `n` random bytes
 * @param {WithTables} io.withTables
 * @returns {Record<string, Device>}
 */
export const makeDevices = (powers, { env, bundles, random, withTables }) =>
  harden({
    entropy: makeEntropy(powers, { random }),
    fetch: makeFetchDevices(powers, {
      tag: 'FetchDevice',
      prefix: 'fetch',
      net: env.INTERNET,
    }),
    gitWorktree: makeGit(withTables(GIT_TABLES), {
      worktree: env.GIT_WORKTREE,
    }),
    lan: makeFetchDevices(powers, {
      tag: 'LanDevice',
      prefix: 'lan',
      net: env.LAN,
    }),
    nixStore: makeNixStores(powers, { store: env.NIX_STORE, bundles }),
  });
