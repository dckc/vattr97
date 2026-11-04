/** @file Entropy: unguessable numbers, for vats, which have no randomness of their own. */
import { M } from '@endo/patterns';
import { hex } from './bundles.js';
import { kzone } from './objects.js';

/** @import { KernelPowers } from '../types.js' */

/**
 * Entropy devices: `swiss()` answers 128 random bits in hex, as a swiss
 * number for a vat to hand out.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {(n: number) => Uint8Array} io.random `n` random bytes
 */
export const makeEntropy = ({ next, kernelObject }, { random }) =>
  harden({
    ...kzone.exoClass(
      'Entropy',
      M.interface('Entropy', { swiss: M.call().returns(M.string()) }),
      {
        swiss() {
          return hex(random(16));
        },
      },
    ),
    /** An entropy device. */
    make: () => kernelObject(`entropy:${next('entropy')}`),
  });
