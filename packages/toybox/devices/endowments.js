/** @file Endowments: service bindings the operator made grantable, as kernel objects, granted to vats when they're made. */
import { M } from '@endo/patterns';
import { kzone } from './objects.js';

/** @import { TablePowers, VatId } from '../types.js'; */

/**
 * What a vat is granted: the binding each of its endowments stands for, by
 * the name the vat knows it by.
 *
 * @typedef {[name: string, binding: string][]} Grants
 */

const { entries, fromEntries } = Object;

export const TABLES = {
  // the vat's endowment `name` is the service binding `binding`
  kgrant:
    'CREATE TABLE IF NOT EXISTS kgrant (vat TEXT NOT NULL, name TEXT NOT NULL, binding TEXT NOT NULL, PRIMARY KEY (vat, name))',
};

/** @typedef {{ kgrant: { vat: VatId, name: string, binding: string } }} Tables */

const PREFIX = 'endowment:';

/**
 * Endowments: each binding config.capnp's `GRANTABLE` names is a kernel
 * object, with no methods of its own. Holding one, along with a vatAdmin, is
 * what lets a party make a vat whose facet env has that binding. The grant is
 * recorded with the vat, so it lasts as long as the vat does, unless the
 * binding stops being grantable: then the vat can't start.
 *
 * The directory holds every endowment, by binding name, and reads
 * `GRANTABLE` as this kernel's incarnation has it, so a binding added to the
 * config reaches a boot vat made before it.
 *
 * Only service bindings cross into a dynamic worker's env.
 *
 * @see https://developers.cloudflare.com/dynamic-workers/api-reference/#env
 *
 * @param {TablePowers<Tables>} powers
 * @param {object} io
 * @param {Map<string, Fetcher>} io.bindings the grantable bindings; a name the operator declared with no binding behind it has `undefined`
 */
export const makeEndowments = (
  { db, kernelObject, standIn, krefOf, keyOf },
  { bindings },
) => {
  /** @param {string} name */
  const bindingOf = name => {
    const binding = bindings.get(name);
    if (!binding) throw Error(`no grantable binding ${name}`);
    return binding;
  };

  /** @param {object} endowment */
  const nameOf = endowment => {
    const kref = krefOf(endowment);
    const key = kref && keyOf(kref);
    if (!key?.startsWith(PREFIX)) throw Error('that is not an endowment');
    return key.slice(PREFIX.length);
  };

  return harden({
    directories: kzone.exoClass(
      'Endowments',
      M.interface('Endowments', {
        get: M.call(M.string()).returns(M.remotable('Endowment')),
      }),
      {
        /** The endowment for the binding `name`. @param {string} name */
        get(name) {
          bindingOf(name);
          return standIn(kernelObject(`${PREFIX}${name}`));
        },
      },
    ),
    endowments: kzone.exoClass('Endowment', M.interface('Endowment', {}), {}),
    /** The directory: whoever holds it holds every endowment. */
    make: () => kernelObject('endowments:grantable'),
    /**
     * What a vat made with `endowments` is granted; throws unless each is an
     * endowment whose binding is still grantable.
     *
     * @param {Record<string, object>} endowments
     * @returns {Grants}
     */
    grantsOf: endowments =>
      entries(endowments).map(([name, endowment]) => {
        const binding = nameOf(endowment);
        bindingOf(binding);
        return [name, binding];
      }),
    /** @param {VatId} vat @param {Grants} grants */
    record: (vat, grants) => {
      for (const [name, binding] of grants)
        db.insert('kgrant', { vat, name, binding });
    },
    /**
     * What `vat`'s facet env holds, by the names it was granted them.
     *
     * @param {VatId} vat
     * @returns {Record<string, Fetcher>}
     */
    of: vat =>
      fromEntries(
        db
          .query('kgrant', { vat })
          .map(({ name, binding }) => [name, bindingOf(binding)]),
      ),
  });
};
