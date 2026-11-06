/** @file Entropy: unguessable numbers, for vats, which have no randomness of their own. */
import { encodeHex } from '@endo/hex';
import { M } from '@endo/patterns';
import { kzone } from '../kernel/objects.js';

/** @import { Device, KernelPowers } from '../types.js' */

/**
 * Entropy devices: `swiss()` answers 128 random bits in hex, as a swiss
 * number for a vat to hand out.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {(n: number) => Uint8Array} io.random `n` random bytes
 * @returns {Device}
 */
export const makeEntropy = ({ next, kernelObject }, { random }) =>
  harden({
    kinds: {
      entropy: kzone.exoClass(
        'Entropy',
        M.interface('Entropy', { swiss: M.call().returns(M.string()) }),
        {
          swiss() {
            const bytes = random(16);
            if (bytes.length !== 16)
              throw Error('random gave other than 16 bytes');
            return encodeHex(bytes);
          },
        },
      ),
    },
    /** An entropy device: whoever holds it can draw swiss numbers. */
    make: () => kernelObject(`entropy:${next('entropy')}`),
  });
