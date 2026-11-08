/** @file One party's side of a kernel: vrefs, presences, and a durable zone, after SwingSet's liveslots. */
import { HandledPromise } from '@endo/eventual-send';
import { makeMarshal } from '@endo/marshal';
import { defineExoClass, defineExoClassKit } from '@endo/exo';
import { Remotable, passStyleOf } from '@endo/pass-style';
import { withSubZones } from './sub-zones.js';

/**
 * @import { MakeMarshalOptions } from '@endo/marshal';
 * @import { Passable } from '@endo/pass-style';
 * @import { Methods, State, Zone } from '../types.js';
 * @import { CapData, ExportVref, Kind, Send, Vatstore, VatstoreKey, Vref } from './types.js';
 */

const { entries, fromEntries, keys } = Object;
const { apply } = Reflect;

/** What every object inherits, by name. */
const inherited = /** @type {Record<string, unknown>} */ (Object.prototype);

/** A durable vref: its kind, its number, and, for a kit, its facet. */
const DURABLE = /^o\+d(\d+|s|r)\/(\d+)(?::([A-Za-z_$][\w$]*))?$/;

/** @param {Vatstore} kv @param {VatstoreKey} name */
const nextIn = (kv, name) => {
  const n = Number(kv.get(name) ?? 0) + 1;
  kv.put(name, String(n));
  return n;
};

/**
 * A party names objects only by vrefs, and only in its own namespace:
 *
 * - `o+0`: its root.
 * - `o+d<kind>/<n>`: a durable object, from the `zone`; its state is in the
 *   vatstore, so it outlives the incarnation that made it. Its kind is a
 *   number, or `s` for a map store and `r` for that store's read-only facet.
 * - `o+d<kind>/<n>:<facet>`: one facet of a durable kit, from `exoClassKit`;
 *   a kit's facets share the state stored for `o+d<kind>/<n>`.
 * - `o+e<n>`: any other object it exports; gone when the vat restarts.
 * - `o-<n>`: an import: an object the kernel handed it.
 *
 * The kernel translates vrefs through the party's c-list, which it keeps;
 * a party can name only what it exports or was given.
 *
 * @param {object} io
 * @param {Send} io.send deliver a message to an object this party holds, by vref
 * @param {Vatstore} [io.kv] where durable objects and stores live; a party
 *   without one has no zone
 */
export const makeLiveslots = ({ send, kv }) => {
  /** @type {Map<Vref, object>} vref -> presence, this incarnation */
  const presences = new Map();
  /** @type {Map<Vref, object>} vref -> exported object, this incarnation */
  const exported = new Map();
  /** @type {WeakMap<object, Vref>} object -> vref, for every object above */
  const vrefOf = new WeakMap();
  /**
   * kind id -> its kind; a kind made by `exoClass` (or a store) has one
   * facet, `self`, whose vref has no facet suffix
   *
   * @type {Map<string, Kind>}
   */
  const kinds = new Map();
  /** @type {Set<Promise<unknown>>} sends not yet answered */
  const inflight = new Set();
  let nextEphemeral = 0;

  /** @template {object} T @param {Vref} vref @param {T} obj */
  const register = (vref, obj) => {
    exported.set(vref, obj);
    vrefOf.set(obj, vref);
    return obj;
  };

  /** @param {Vref} vref */
  const makePresence = vref => {
    /** @param {string} method @param {Passable[]} args */
    const call = (method, args) => {
      const p = (async () =>
        unserialize(await send(vref, method, serialize(harden(args)))))();
      inflight.add(p);
      const done = () => void inflight.delete(p);
      p.then(done, done);
      return p;
    };
    const handler = {
      /** @param {unknown} _p @param {string} method @param {Passable[]} args */
      applyMethod: (_p, method, args) => call(method, args),
      applyFunction: () =>
        Promise.reject(Error('a presence is not a function')),
      /** @param {unknown} _p @param {PropertyKey} prop */
      get: (_p, prop) =>
        Promise.reject(Error(`no property gets on presences: ${String(prop)}`)),
    };
    /** @type {(handler: object) => object} */
    let resolveWithPresence = () => {
      throw Error('HandledPromise gave no resolveWithPresence');
    };
    // eslint-disable-next-line no-new
    new HandledPromise(
      (_resolve, _reject, rwp) => (resolveWithPresence = rwp),
      /** @type {any} HandledPromise's handler type wants all three traps typed its way */ (
        handler
      ),
    );
    const presence = Remotable(
      'Alleged: remote',
      undefined,
      resolveWithPresence(handler),
    );
    presences.set(vref, presence);
    vrefOf.set(presence, vref);
    return presence;
  };

  /**
   * The durable object `vref`, made again from its stored state if this
   * incarnation hasn't yet. A kit's facets are made again together, since
   * each method sees all of them as `this.facets`.
   *
   * @param {Vref} vref
   * @returns {object}
   */
  const revive = vref => {
    const [, kindId, n, facet] = DURABLE.exec(vref) ?? [];
    const kind = kinds.get(kindId);
    if (!kind)
      throw Error(`${vref}: its kind is not defined in this incarnation`);
    /** @type {ExportVref} */
    const base = `o+d${kindId}/${n}`;
    if (kv?.get(`vom.${base}`) === undefined)
      throw Error(`${vref}: no such object`);
    const vatstore = kv;
    if (kind.kit ? !kind.facets.includes(facet ?? '') : facet)
      throw Error(`${vref}: no such facet`);
    if (!kind.kit) return register(base, kind.make(stateOf(vatstore, base)));
    const made = kind.make(stateOf(vatstore, base));
    for (const [name, obj] of entries(made)) register(`${base}:${name}`, obj);
    return made[/** @type {string} */ (facet)];
  };

  /**
   * The state stored at `vom.<base>`, as accessors: each read and write
   * goes to the vatstore.
   *
   * @param {Vatstore} vatstore
   * @param {ExportVref} base
   */
  const stateOf = (vatstore, base) => {
    /** @returns {State} */
    const read = () =>
      storeUnserialize(/** @type {string} */ (vatstore.get(`vom.${base}`)));
    /** @type {State} */
    const state = {};
    for (const field of keys(read())) {
      Object.defineProperty(state, field, {
        get: () => read()[field],
        set: v =>
          vatstore.put(
            `vom.${base}`,
            storeSerialize(harden({ ...read(), [field]: v })),
          ),
        enumerable: true,
      });
    }
    return harden(state);
  };

  /** @param {Vref} vref @returns {any} a presence or an export, whatever the vat made it */
  const slotToVal = vref => {
    if (vref.startsWith('o-')) return presences.get(vref) ?? makePresence(vref);
    const obj = exported.get(vref);
    if (obj) return obj;
    if (vref.startsWith('o+d')) return revive(vref);
    throw Error(`${vref}: gone with an earlier incarnation`);
  };

  /** @param {any} val a remotable, as marshal's slot hooks take it @returns {Vref} */
  const valToSlot = val => {
    const known = vrefOf.get(val);
    if (known) return known;
    if (passStyleOf(val) !== 'remotable')
      throw Error('only remotables cross the kernel by reference');
    nextEphemeral += 1;
    /** @type {Vref} */
    const vref = `o+e${nextEphemeral}`;
    register(vref, val);
    return vref;
  };

  /** @type {MakeMarshalOptions} */
  const marshalOpts = { serializeBodyFormat: 'smallcaps', errorTagging: 'off' };
  const { toCapData, fromCapData } = makeMarshal(
    valToSlot,
    slotToVal,
    marshalOpts,
  );
  /** @param {any} val what the vat sends: marshal checks it's passable @returns {CapData} */
  const serialize = val => toCapData(harden(val));
  /** @param {CapData} capdata @returns {any} whatever the sender sent */
  const unserialize = capdata => fromCapData(capdata);

  /**
   * Stored state may refer only to what survives a restart: durable
   * objects, imports, the root.
   *
   * @param {any} val a remotable, as marshal's slot hooks take it
   */
  const storeSlot = val => {
    const vref = valToSlot(val);
    if (vref.startsWith('o+e'))
      throw Error('only durable objects and imports can be stored');
    return vref;
  };
  const store = makeMarshal(storeSlot, slotToVal, marshalOpts);
  /** @param {any} val what's stored: marshal checks it's passable */
  const storeSerialize = val => JSON.stringify(store.toCapData(harden(val)));
  /** @param {string} json @returns {any} whatever was stored */
  const storeUnserialize = json => store.fromCapData(JSON.parse(json));

  const zone =
    kv &&
    makeZone({
      kv,
      kinds,
      revive,
      storeSlot,
      slotToVal,
      storeSerialize,
      storeUnserialize,
    });

  return harden({
    serialize,
    unserialize,
    slotToVal,
    zone,
    /** @param {object} root what `o+0` designates in this incarnation */
    setRoot: root => void register('o+0', root),
    /** Resolves once every send made so far, and every send those made, is answered. */
    quiescent: async () => {
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
    /**
     * A message from the kernel to one of this party's exports.
     *
     * @param {Vref} vref
     * @param {string} method
     * @param {CapData} capdata
     */
    deliver: async (vref, method, capdata) => {
      /** @type {Record<string, unknown>} */
      const target = slotToVal(vref);
      const args = unserialize(capdata);
      const fn = target[method];
      // what every object inherits (toString, constructor, ...) is no method of the vat's
      if (typeof fn !== 'function' || fn === inherited[method])
        throw Error(`no method ${method}`);
      if (!Array.isArray(args)) throw Error('arguments are an array');
      return serialize(await apply(fn, target, args));
    },
  });
};

/**
 * The durable zone: kinds whose instances live in the vatstore, and stores.
 *
 * @param {object} p
 * @param {Vatstore} p.kv
 * @param {Map<string, Kind>} p.kinds
 * @param {(vref: Vref) => object} p.revive
 * @param {(val: any) => string} p.storeSlot
 * @param {(vref: Vref) => any} p.slotToVal
 * @param {(val: any) => string} p.storeSerialize
 * @param {(json: string) => any} p.storeUnserialize
 * @returns {Zone}
 */
const makeZone = ({
  kv,
  kinds,
  revive,
  storeSlot,
  slotToVal,
  storeSerialize,
  storeUnserialize,
}) => {
  /** A key as a string: strings and numbers by value, remotables by vref. @param {unknown} key */
  const encodeKey = key => {
    if (typeof key === 'string') return `s${key}`;
    if (typeof key === 'number') return `n${key}`;
    if (passStyleOf(key) === 'remotable') return `r${storeSlot(key)}`;
    throw Error('keys are strings, numbers, or durable remotables');
  };
  /** @param {string} enc @returns {unknown} */
  const decodeKey = enc =>
    enc[0] === 's'
      ? enc.slice(1)
      : enc[0] === 'n'
        ? Number(enc.slice(1))
        : slotToVal(/** @type {Vref} as encoded here */ (enc.slice(1)));

  // FIXME: a store named `a` also finds the entries of one named `a.b`, whose
  // keys start with `store.a.` too, so its size is wrong and keys() throws
  /** A store's entries are under `store.<id>.`; a named store's id is its name. @param {string} id @param {unknown} key @returns {VatstoreKey} */
  const at = (id, key) => `store.${id}.${encodeKey(key)}`;
  /** @param {string} id @returns {[unknown, unknown][]} */
  const entriesOf = id =>
    kv
      .keys(`store.${id}.`)
      .map(k => [
        decodeKey(k.slice(`store.${id}.`.length)),
        storeUnserialize(/** @type {string} */ (kv.get(k))),
      ]);
  /** @param {string} id @param {string} label @param {unknown} key @returns {unknown} */
  const getIn = (id, label, key) => {
    const v = kv.get(at(id, key));
    if (v === undefined) throw Error(`no such key in ${label}`);
    return storeUnserialize(v);
  };
  /**
   * A store's state: its id, its label, and (for the read-write facet) its
   * read-only facet.
   *
   * @typedef {{ id: string, label: string, readOnly?: object }} StoreState
   */
  /** @type {Methods & ThisType<{ state: StoreState }>} */
  const queries = {
    /** @param {unknown} key */
    has(key) {
      return kv.get(at(this.state.id, key)) !== undefined;
    },
    /** @param {unknown} key */
    get(key) {
      return getIn(this.state.id, this.state.label, key);
    },
    keys() {
      return entriesOf(this.state.id).map(([k]) => k);
    },
    values() {
      return entriesOf(this.state.id).map(([, v]) => v);
    },
    entries() {
      return entriesOf(this.state.id);
    },
    getSize() {
      return kv.keys(`store.${this.state.id}.`).length;
    },
  };
  /**
   * A kind of one facet, its state given whole.
   *
   * @param {string} tag
   * @param {unknown} guard
   * @param {Methods} methods
   * @returns {Kind}
   */
  const single = (tag, guard, methods) => ({
    kit: false,
    facets: ['self'],
    make: defineExoClass(
      tag,
      /** @type {any} a guard is any of M.interface's, which tsc can't check from here */ (
        guard
      ),
      /** @param {State} s */ s => s,
      methods,
    ),
  });
  kinds.set('r', single('ReadonlyMapStore', undefined, queries));
  kinds.set(
    's',
    single(
      'MapStore',
      undefined,
      /** @type {Methods & ThisType<{ state: StoreState }>} */ ({
        ...queries,
        /** @param {unknown} key @param {unknown} value */
        init(key, value) {
          const { id, label } = this.state;
          if (kv.get(at(id, key)) !== undefined)
            throw Error(`key already in ${label}`);
          kv.put(at(id, key), storeSerialize(value));
        },
        /** @param {unknown} key @param {unknown} value */
        set(key, value) {
          const { id, label } = this.state;
          getIn(id, label, key);
          kv.put(at(id, key), storeSerialize(value));
        },
        /** @param {unknown} key */
        delete(key) {
          const { id, label } = this.state;
          getIn(id, label, key);
          kv.delete(at(id, key));
        },
        /** The facet with the queries alone. */
        readOnly() {
          return this.state.readOnly;
        },
      }),
    ),
  );
  /** A new store with entries under `store.<id>.`, and its read-only facet. @param {string} id @param {string} label @returns {any} a MapStore, of whatever keys and values its user says */
  const makeStore = (id, label) => {
    const n = nextIn(kv, 'vom.next.s');
    kv.put(`vom.o+dr/${n}`, storeSerialize(harden({ id, label })));
    kv.put(
      `vom.o+ds/${n}`,
      storeSerialize(harden({ id, label, readOnly: revive(`o+dr/${n}`) })),
    );
    return revive(`o+ds/${n}`);
  };

  /**
   * The kind `tag`, defined for this incarnation: the same id it had in
   * earlier ones, with the same facets. A kind can't change between one
   * facet (`exoClass`) and a kit, or change a kit's facets: references to
   * its objects are already stored by facet.
   *
   * @param {string} tag
   * @param {string[] | undefined} facets a kit's facet names, or none for one facet
   * @param {() => Kind} makeKind called only once the facets check out
   */
  const defineKind = (tag, facets, makeKind) => {
    const shape = facets ? JSON.stringify([...facets].sort()) : 'self';
    // FIXME: `kind.next` is also the counter of kinds, so a kind tagged `next`
    // reads that as its id, and loses its objects on the next incarnation
    let kindId = kv.get(`kind.${tag}`);
    if (kindId === undefined) {
      kindId = String(nextIn(kv, 'kind.next'));
      kv.put(`kind.${tag}`, kindId);
      kv.put(`kindFacets.${kindId}`, shape);
    }
    // kinds from before kits have no shape stored; they had one facet
    const was = kv.get(`kindFacets.${kindId}`) ?? 'self';
    if (was !== shape)
      throw Error(
        `kind ${tag} had facets ${was}; it can't have ${shape} now: its objects are referred to by facet`,
      );
    kinds.set(kindId, makeKind());
    return kindId;
  };

  /** @param {string} kindId @param {State} state */
  const makeInstance = (kindId, state) => {
    /** @type {ExportVref} */
    const base = `o+d${kindId}/${nextIn(kv, `vom.next.${kindId}`)}`;
    kv.put(`vom.${base}`, storeSerialize(harden(state)));
    return base;
  };

  /**
   * A durable kit kind, after `@agoric/zone`: `init(...args)` makes the
   * state, shared by every facet; each method sees it as `this.state`, and
   * the instance's facets as `this.facets`. The maker answers the facets.
   *
   * The zone's types (types.ts) say what each maker answers, in terms of
   * the kind's own methods; here they're as general as any kind's.
   *
   * @param {string} key what the kind is stored by
   * @param {string} tag what its objects are alleged to be
   * @param {Record<string, unknown> | undefined} interfaceGuards one per facet, checked by @endo/exo
   * @param {(...args: any[]) => State} init its arguments are the kind's own, which Zone (types.ts) types
   * @param {Record<string, Methods>} facets
   */
  const exoClassKit = (key, tag, interfaceGuards, init, facets) => {
    if (!keys(facets).length) throw Error(`kit ${key} has no facets`);
    const kindId = defineKind(key, keys(facets), () => ({
      kit: true,
      facets: keys(facets),
      make: defineExoClassKit(
        tag,
        /** @type {any} guards, as above */ (interfaceGuards),
        /** @param {State} s */ s => s,
        /** @type {any} @endo/exo types a kit's methods by its context, which these can't name */ (
          facets
        ),
      ),
    }));
    return (/** @type {unknown[]} */ ...args) => {
      const base = makeInstance(kindId, init(...args));
      // reviving one facet makes them all
      return harden(
        fromEntries(
          keys(facets).map(name => [name, slotToVal(`${base}:${name}`)]),
        ),
      );
    };
  };

  /**
   * A durable kind of one facet: `init(...args)` makes the state; each
   * method sees it as `this.state`, and its object as `this.self`.
   *
   * @param {string} key what the kind is stored by
   * @param {string} tag what its objects are alleged to be
   * @param {unknown} interfaceGuard checked by @endo/exo
   * @param {(...args: any[]) => State} init its arguments are the kind's own, which Zone (types.ts) types
   * @param {Methods} methods
   */
  const exoClass = (key, tag, interfaceGuard, init, methods) => {
    const kindId = defineKind(key, undefined, () =>
      single(tag, interfaceGuard, methods),
    );
    return (/** @type {unknown[]} */ ...args) =>
      revive(makeInstance(kindId, init(...args)));
  };

  /**
   * `make()`'s result, made only the first time any incarnation asks for `key`.
   *
   * @template T
   * @param {string} key
   * @param {() => T} make
   * @returns {T}
   */
  const makeOnce = (key, make) => {
    const stored = kv.get(`once.${key}`);
    if (stored !== undefined) return storeUnserialize(stored);
    const value = make();
    kv.put(`once.${key}`, storeSerialize(value));
    return value;
  };

  return withSubZones(
    harden({
      exoClassKit,
      exoClass,
      /**
       * One durable object, as `@agoric/zone`'s `exo`: the same one in every
       * incarnation.
       *
       * @param {string} key
       * @param {string} tag
       * @param {unknown} interfaceGuard
       * @param {Methods} methods
       */
      exo: (key, tag, interfaceGuard, methods) => {
        const make = exoClass(key, tag, interfaceGuard, () => ({}), methods);
        return makeOnce(`exo.${key}`, make);
      },
      makeOnce,
      /**
       * A durable map store, by name: the same name in a later incarnation is
       * the same store. A store is a remotable, so it can be passed, kept in
       * durable state, or used as a key; its `readOnly()` facet has the
       * queries alone.
       *
       * @param {string} key what it's stored by
       * @param {string} name what errors call it
       */
      mapStore: (key, name) => {
        if (key.startsWith('#'))
          throw TypeError("a store name must not start with '#'");
        const known = kv.get(`storeName.${key}`);
        if (known !== undefined)
          return slotToVal(/** @type {Vref} as storeSlot answered */ (known));
        const store = makeStore(key, name);
        kv.put(`storeName.${key}`, storeSlot(store));
        return store;
      },
      /** Stores that no name finds again, as `@agoric/zone`'s `detached()`: each `mapStore(label)` is a new one. */
      /** @type {Zone['detached']} */
      detached: () =>
        harden({
          /** @param {string} label */
          mapStore: label => makeStore(`#${nextIn(kv, 'store.next')}`, label),
        }),
    }),
  );
};
