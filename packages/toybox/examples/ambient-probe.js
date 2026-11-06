/**
 * A vat that looks for clocks and randomness in its globals, and reports
 * what it found when its module was evaluated and when it's asked.
 */
/* eslint-disable no-restricted-properties, no-restricted-syntax -- reaching for ambient authority is the point */

/** @import { BuildRootObject } from '../src/types.js' */

/** @param {() => unknown} thunk */
const attempt = thunk => {
  try {
    return thunk();
  } catch {
    return 'throws';
  }
};

const look = () =>
  harden({
    frozen: Object.isFrozen(Array.prototype),
    now: attempt(() => Date.now()),
    date: attempt(() => String(new Date())),
    random: attempt(() => Math.random()),
    crypto: Object.keys(crypto).sort(),
    subtle: Object.keys(crypto.subtle).sort(),
    performance: attempt(() => performance.now()),
  });

const atEvaluation = look();

/** @type {BuildRootObject<{}>} */
export const buildRootObject = ({ Far }) =>
  Far('Ambient', {
    atEvaluation: () => atEvaluation,
    now: look,
    digest: async () => {
      const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(''),
      );
      return new Uint8Array(bytes)[0];
    },
  });
