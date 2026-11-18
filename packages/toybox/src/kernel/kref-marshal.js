/** @file The kernel's marshal: krefs in a message's slots, stand-in objects in its data. */
import { Fail } from '@endo/errors';
import { makeMarshal } from '@endo/marshal';
import { Far } from '@endo/pass-style';

/**
 * @import { CapData } from '../vat/types.js';
 * @import { Kref } from './types.js';
 */

/** A stand-in's name as this marshal once gave it, the kref itself. */
export const LEGACY = /^kref ko\d+$/;

/**
 * A marshal whose slots are krefs: each becomes a stand-in object in the
 * data, and back, so kernel objects' methods see references as objects.
 *
 * A stand-in's interface name is the one its sender gave, or, for one the
 * kernel makes itself, `nameOf(kref)`; never the kref, which is the
 * kernel's name for it, and none of any vat's business: a stand-in passed
 * on to a vat keeps its interface name.
 *
 * @param {(kref: Kref) => string} nameOf an interface name for a reference whose sender gave none
 */
export const makeKrefMarshal = nameOf => {
  /** @type {WeakMap<object, Kref>} */
  const krefOf = new WeakMap();
  /** @param {Kref} kref @param {string} [iface] as its sender gave it */
  const standIn = (kref, iface) => {
    const given = iface?.replace(/^Alleged: /, '');
    // `kref ko<n>` is what this marshal named stand-ins before, kept in
    // stored params; it's no name at all
    const obj = Far(given && !LEGACY.test(given) ? given : nameOf(kref), {});
    krefOf.set(obj, kref);
    return obj;
  };
  /** @param {unknown} obj */
  const toKref = obj => {
    const kref = typeof obj === 'object' && obj && krefOf.get(obj);
    if (!kref) throw Fail`not a reference the kernel handed out`;
    return kref;
  };
  const marshal = makeMarshal(toKref, standIn, {
    serializeBodyFormat: 'smallcaps',
    errorTagging: 'off',
  });
  return harden({
    /** @param {unknown} val @returns {CapData<Kref>} */
    toCapData: val =>
      marshal.toCapData(
        harden(/** @type {any} marshal checks it's passable */ (val)),
      ),
    /** @param {CapData<Kref>} capdata @returns {any} whatever the sender sent */
    fromCapData: capdata => marshal.fromCapData(capdata),
    standIn,
    /** @param {unknown} obj */
    krefOf: obj =>
      typeof obj === 'object' && obj ? krefOf.get(obj) : undefined,
  });
};
