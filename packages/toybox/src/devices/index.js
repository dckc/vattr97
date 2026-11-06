/** @file The kernel's I/O devices: which there are, and which of workerd's bindings each reaches. */

/** @import { MakeDevices } from '../kernel/types.js' */

/**
 * toybox's own I/O devices, by name.
 *
 * @type {MakeDevices}
 */
export const makeDevices = () => harden({});
