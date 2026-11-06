/** A vat of several modules: a durable count, and a greeting kept as text. */
import greeting from './greeting.txt';
import { prepareCount } from './lib/count.js';

/** @import { BuildRootObject } from '../../src/types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, zone }) => {
  const count = prepareCount(zone);
  return Far('greeter', {
    /** @param {string} name */
    greet: name => `${greeting.trim()}, ${name} (#${count.incr()})`,
  });
};
