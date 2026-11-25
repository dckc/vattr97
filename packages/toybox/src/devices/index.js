/** @file The kernel's I/O devices: which there are, and which of workerd's bindings each reaches. */
import { TABLES as CRYPTO_TABLES, makeCryptoDevices } from './crypto.js';
import { makeEntropy } from './entropy.js';
import { makeFetchDevices } from './fetch.js';
import { TABLES as GIT_TABLES, makeGitTrees } from './git/trees.js';
import { makeInstallers } from './installer.js';
import { TABLES as JWT_TABLES, makeJwtSigners } from './jwt.js';
import { makeNixStores } from './nix/store.js';
import { TABLES as RHOLO_TABLES, makeRholoSigners } from './rholo.js';
import { makeSourceTrees } from './source.js';
import { TABLES as TIMER_TABLES, makeTimers } from './timer.js';

/** @import { MakeDevices } from '../kernel/types.js' */

/**
 * toybox's own I/O devices: networks (`fetch`, `lan`), the nix store, git
 * trees, the source directory, entropy, timers, hashes and signers, JWT signers, rholo deploy signers, and the installer, for
 * module source a vat has in hand.
 *
 * @type {MakeDevices}
 */
export const makeDevices = (
  powers,
  { env, bundles, random, now, subtle, send, rearm, log, withTables },
) =>
  harden({
    crypto: makeCryptoDevices(withTables(CRYPTO_TABLES), { subtle, send }),
    entropy: makeEntropy(powers, { random }),
    fetch: makeFetchDevices(powers, {
      tag: 'FetchDevice',
      prefix: 'fetch',
      net: env.INTERNET,
    }),
    gitTrees: makeGitTrees(withTables(GIT_TABLES), {
      checkout: env.GIT_CHECKOUT,
    }),
    installer: makeInstallers(powers, { bundles }),
    jwtSigners: makeJwtSigners(withTables(JWT_TABLES), {
      now,
      random,
      subtle,
      send,
    }),
    rholoSigners: makeRholoSigners(withTables(RHOLO_TABLES), { send }),
    lan: makeFetchDevices(powers, {
      tag: 'LanDevice',
      prefix: 'lan',
      net: env.LAN,
    }),
    nixStore: makeNixStores(powers, { store: env.NIX_STORE, bundles }),
    source: makeSourceTrees(powers, { source: env.SOURCE, bundles }),
    timer: makeTimers(withTables(TIMER_TABLES), { now, send, rearm, log }),
  });
