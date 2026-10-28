// @ts-check

import { Far } from '@endo/far';

/**
 * Unconfined wall-clock capability for confined ledger workers.
 *
 * @param {unknown} [_powers]
 * @param {unknown} [_context]
 */
export const make = (_powers = undefined, _context = undefined) => {
  void _powers;
  void _context;
  return Far('clock', {
    now: () => Date.now(),
  });
};
