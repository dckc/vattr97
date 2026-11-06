/** @file Entropy: unguessable numbers, for vats, which have no randomness of their own. */
import { encodeBase64 } from '@endo/base64';
import { M } from '@endo/patterns';
import { kzone } from '../kernel/objects.js';

/** @import { Device, KernelPowers } from '../kernel/types.js' */
/** @import { SwissNum } from '../types.js' */

/**
 * `bytes` in base64url, unpadded.
 *
 * @param {Uint8Array} bytes
 */
const base64url = bytes =>
  encodeBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

/**
 * Entropy devices: `swiss()` answers a {@link SwissNum}, 128 random bits,
 * for a vat to hand out.
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
          /** @returns {SwissNum} */
          swiss() {
            const bytes = random(16);
            if (bytes.length !== 16)
              throw Error('random gave other than 16 bytes');
            return /** @type {SwissNum} fresh from 16 random bytes */ (
              base64url(bytes)
            );
          },
        },
      ),
    },
    /** An entropy device: whoever holds it can draw swiss numbers. */
    make: () => kernelObject(`entropy:${next('entropy')}`),
  });
