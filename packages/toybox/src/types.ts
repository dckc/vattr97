/**
 * @file Types for writing code that runs in toybox: like a Cloudflare
 * Durable Object, its state outlives restarts, but that state can hold
 * objects, and references to objects elsewhere, not only rows of data.
 * @see {@link ExoClass} to start
 * @see {@link BuildRootObject} for what a module exports
 * @see ../CONTRIBUTING.md#conventions for how toybox's JavaScript is typed and checked
 */
import type { E as EType, Far as FarType } from '@endo/far';
import type { InterfaceGuard, M as MType } from '@endo/patterns';

/**
 * Define a kind of durable object, by `tag`, and answer its maker. The
 * maker passes its arguments to `init`, whose answer is the new object's
 * state; each of `methods` sees that state as `this.state`, and the object
 * as `this.self`. An assignment to `this.state.count` is stored at once,
 * as a write to a Durable Object's storage would be. But the state may
 * hold other objects too, or references to objects elsewhere, and the
 * object itself can be passed to code elsewhere, which can call it later,
 * after a restart.
 *
 * A message reaches only `methods`, and only as `interfaceGuard` allows,
 * if there is one.
 *
 * @example
 * const makeCounter = zone.exoClass(
 *   'Counter',
 *   undefined,
 *   (count = 0) => ({ count }),
 *   {
 *     incr() {
 *       this.state.count += 1;
 *       return this.state.count;
 *     },
 *   },
 * );
 * const counter = zone.makeOnce('counter', () => makeCounter());
 * @see https://github.com/endojs/endo/tree/master/packages/exo `@endo/exo`, which makes the objects
 */
export type ExoClass = <
  A extends unknown[],
  S extends State,
  T extends Methods,
>(
  tag: string,
  interfaceGuard: InterfaceGuard | undefined,
  init: (...args: A) => S,
  methods: T & ThisType<ClassContext<S, Guarded<T>>>,
) => (...args: A) => Guarded<T>;

/**
 * A kind's methods. Their parameters and answers are yours to choose, so
 * they're `any` here; an interface guard is what checks them.
 */
export type Methods = Record<string, (...args: any[]) => any>;

/**
 * A durable object's state: the record its kind's `init` answers. Its
 * values are data, durable objects, or references to objects elsewhere.
 */
export type State = Record<string, unknown>;

/** What a method of a kind of one facet sees as `this`. */
export type ClassContext<S extends State, T> = { state: S; self: T };

/** What a kind's maker answers: the methods, with `this` bound for them. */
export type Guarded<T extends Methods> = {
  [K in keyof T]: OmitThisParameter<T[K]>;
};

/**
 * One durable object, made the first time it's asked for by `tag`: an
 * {@link ExoClass} with no state, made once.
 */
export type Exo = <T extends Methods>(
  tag: string,
  interfaceGuard: InterfaceGuard | undefined,
  methods: T & ThisType<ClassContext<{}, Guarded<T>>>,
) => Guarded<T>;

/**
 * Define a kind of durable object with several facets that share one state,
 * and answer its maker, which answers the facets. Each facet is a reference
 * of its own, so one can be handed out without the others: a read facet to
 * someone who may look but not change, as a store's {@link
 * MapStore.readOnly} facet is. A method sees the state as `this.state`, and
 * the instance's facets as `this.facets`.
 *
 * @example
 * const makeCounterKit = zone.exoClassKit(
 *   'CounterKit',
 *   undefined,
 *   () => ({ n: 0 }),
 *   {
 *     incr: { incr() { this.state.n += 1; } },
 *     read: { read() { return this.state.n; } },
 *   },
 * );
 * const { incr, read } = makeCounterKit();
 */
export type ExoClassKit = <
  A extends unknown[],
  S extends State,
  F extends Record<string, Methods>,
>(
  tag: string,
  interfaceGuards: Record<keyof F, InterfaceGuard> | undefined,
  init: (...args: A) => S,
  facets: F & ThisType<KitContext<S, KitOf<F>>>,
) => (...args: A) => KitOf<F>;

/** What a method of a kit's facet sees as `this`. */
export type KitContext<S extends State, F> = { state: S; facets: F };

/** A kit's facets, as its maker answers them. */
export type KitOf<F extends Record<string, Methods>> = {
  [K in keyof F]: Guarded<F[K]>;
};

/**
 * A durable map. A store is itself a durable object: it can be passed,
 * kept in another store or an object's state, or used as a key.
 */
export interface MapStore<K extends Key, V> extends ReadonlyMapStore<K, V> {
  /** Add `key`; throws if it's there already. */
  init(key: K, value: V): void;
  /** Replace `key`'s value; throws if it isn't there. */
  set(key: K, value: V): void;
  /** Remove `key`; throws if it isn't there. */
  delete(key: K): void;
  /** the facet with the queries alone */
  readOnly(): ReadonlyMapStore<K, V>;
}

/** A store's queries. */
export interface ReadonlyMapStore<K extends Key, V> {
  has(key: K): boolean;
  /** `key`'s value; throws if it isn't there. */
  get(key: K): V;
  keys(): K[];
  values(): V[];
  entries(): [K, V][];
  getSize(): number;
}

/** A store's key: a string, a number, or a durable object. */
export type Key = string | number | object;

/**
 * Where a module defines its kinds of durable objects, and keeps them.
 * When the module restarts, or is upgraded to new code, its objects are
 * still there, and references to them held elsewhere still work; so each
 * time it starts it must define every kind again, by the same tag, to give
 * its objects their methods.
 *
 * @see https://github.com/Agoric/agoric-sdk/tree/master/packages/zone `@agoric/zone`, whose API this follows
 */
export interface Zone {
  exoClass: ExoClass;
  exo: Exo;
  exoClassKit: ExoClassKit;
  /** `make()`'s result, made only the first time it's asked for by `key`, ever. */
  makeOnce<T>(key: string, make: () => T): T;
  /** A durable map store, by name: the same name after a restart is the same store. */
  mapStore<K extends Key, V>(name: string): MapStore<K, V>;
  /** Stores without names, to keep or hand out as you like. */
  detached(): { mapStore<K extends Key, V>(label: string): MapStore<K, V> };
  /**
   * A zone within this one, for code that should keep to its own names:
   * its keys, store names, and kind tags can't reach this zone's, or
   * another sub-zone's. The same label after a restart is the same zone.
   */
  subZone(label: string): Zone;
}

/**
 * A module exports `buildRootObject`, which builds its root object each
 * time the module starts, from its powers and the params it was made with.
 * Whoever made it holds its root; everything else it offers is reached
 * from there.
 *
 * @example
 * export const buildRootObject = ({ Far, zone }) => {
 *   const makeCounter = zone.exoClass(...);
 *   return Far('root', { makeCounter: () => makeCounter() });
 * };
 */
export type BuildRootObject<P = any> = (powers: Powers, params: P) => object;

/**
 * What `buildRootObject` gets, beside its params. A module has no other
 * way to reach the world: no clock, no randomness, no network, but what
 * its params and endowments give it.
 */
export type Powers = {
  /**
   * `E(remote).method(...args)` sends a message to a {@link Remote} and
   * answers a promise for its result.
   *
   * @see https://github.com/endojs/endo/tree/master/packages/eventual-send
   */
  E: typeof EType;
  /**
   * `Far(name, methods)` makes an object that can be passed elsewhere, as a
   * reference. Unlike a zone's objects, it's gone when the module restarts.
   *
   * @see https://github.com/endojs/endo/tree/master/packages/far
   */
  Far: typeof FarType;
  /**
   * Patterns, and `M.interface(name, methods)`: an interface guard, which
   * says what each method takes and answers, so a message that doesn't fit
   * is refused before the method runs.
   *
   * @see https://github.com/endojs/endo/tree/master/packages/patterns
   */
  M: typeof MType;
  zone: Zone;
  /** the module's own SQLite, for what suits tables better than objects */
  db: SqlDatabase;
  /**
   * The service binding granted to this module as `name`. A function, not
   * a record of bindings, since workerd's stubs can't be frozen, so can't
   * be hardened.
   */
  endowment: (name: string) => Fetcher;
};

/**
 * A reference to an object elsewhere: another module's, or one of toybox's
 * own, such as a network device. E() reaches its methods, whose types this
 * module can't name. (Its interface guard, where it lives, is what checks
 * the calls.)
 */
export type Remote = any;

/** A module's own SQLite database, its statements run synchronously. */
export type SqlDatabase = {
  exec: (sql: string) => void;
  prepare: <P extends SqlValue[] = SqlValue[], R = SqlRow>(
    sql: string,
  ) => SqlStatement<P, R>;
  /** Run `fn` in one transaction, rolled back if it throws; `fn` can't await. */
  transaction: <T>(fn: () => T) => T;
};

/** A prepared statement. */
export type SqlStatement<P extends SqlValue[] = SqlValue[], R = SqlRow> = {
  run: (...params: P) => { changes: number };
  get: (...params: P) => R | undefined;
  all: (...params: P) => R[];
};

/** A row a query answers, by column. */
export type SqlRow = Record<string, SqlValue>;

/** A SQLite value as a statement takes or answers it. */
export type SqlValue = string | number | null | ArrayBuffer;

/**
 * An HTTP request, as data: what a handler gets in `handle(request)`
 * when it's served at an ingress, a route on toybox's HTTP socket.
 */
export type HttpRequest = {
  method: string;
  path: string;
  /** the mount's labels and the request's query parameters, together */
  labels: Record<string, string>;
  body: string;
};

/** A handler's answer to an {@link HttpRequest}, as data. */
export type HttpResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};
