/**
 * @file Kernel objects as exos: a kind of kernel object defines its methods
 * and their interface guard once, and each message is a call on the
 * instance its key names, checked by the guard before the method runs.
 */
import { defineExoClass } from '@endo/exo';

/** @import { KernelObjects, Methods } from '../types.js' */

/**
 * The kernel objects of one kind: `deliver(rest, method, args)` calls
 * `method` on the instance `rest` names (the part of its key after the
 * kind's prefix), which its methods see as `this.state.rest`.
 *
 * @param {string} tag
 * @param {any} interfaceGuard what M.interface makes; tsc can't name its methods from here
 * @param {Methods & ThisType<{ state: { rest: string } }>} methods
 * @returns {KernelObjects}
 */
export const kernelObjects = (tag, interfaceGuard, methods) => {
  const make = defineExoClass(
    tag,
    interfaceGuard,
    /** @param {string} rest */ rest => ({ rest }),
    methods,
  );
  return harden({
    deliver: (rest, method, args) => {
      // only the kind's own methods: not what every object inherits (toString, constructor, …), which no guard covers
      if (!Object.hasOwn(methods, method))
        throw Error(`a ${tag} has no ${method}`);
      /** @type {Record<string, (...args: unknown[]) => unknown>} */
      const obj = make(rest);
      return obj[method](...args);
    },
  });
};
