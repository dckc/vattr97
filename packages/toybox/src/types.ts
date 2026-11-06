/**
 * @file Types for writing a vat: what `buildRootObject` gets (its powers,
 * zone, stores, and SQLite) and what an ingress's handler takes and answers.
 * toybox's modules are JavaScript, run as they are by workerd; they import
 * types with JSDoc `@import`, and `tsc --checkJs` checks them.
 */
import type { E as EType, Far as FarType } from '@endo/far';
import type { M as MType } from '@endo/patterns';

/**
 * A kind's methods, as a vat defines them. Their parameters and answers
 * are the vat's to choose, so they're `any` here; an interface guard is
 * what checks them.
 */
export type Methods = Record<string, (...args: any[]) => any>;

/** A durable object's state: the record its kind's `init` answers. */
export type State = Record<string, unknown>;

/** What a method of a kind of one facet sees as `this`. */
export type ClassContext<S extends State, T> = { state: S; self: T };

/** What a method of a kit's facet sees as `this`. */
export type KitContext<S extends State, F> = { state: S; facets: F };

/** What the zone's makers answer: the methods, with `this` bound for them. */
export type Guarded<T extends Methods> = {
  [K in keyof T]: OmitThisParameter<T[K]>;
};

/** A store's key: a string, a number, or a durable remotable. */
export type Key = string | number | object;

export interface ReadonlyMapStore<K extends Key, V> {
  has(key: K): boolean;
  get(key: K): V;
  keys(): K[];
  values(): V[];
  entries(): [K, V][];
  getSize(): number;
}

export interface MapStore<K extends Key, V> extends ReadonlyMapStore<K, V> {
  init(key: K, value: V): void;
  set(key: K, value: V): void;
  delete(key: K): void;
  /** the facet with the queries alone */
  readOnly(): ReadonlyMapStore<K, V>;
}

/** A vat's durable zone, after `@agoric/zone`. */
export interface Zone {
  exoClass<A extends unknown[], S extends State, T extends Methods>(
    tag: string,
    interfaceGuard: unknown,
    init: (...args: A) => S,
    methods: T & ThisType<ClassContext<S, Guarded<T>>>,
  ): (...args: A) => Guarded<T>;
  exoClassKit<
    A extends unknown[],
    S extends State,
    F extends Record<string, Methods>,
  >(
    tag: string,
    interfaceGuards: Record<keyof F, unknown> | undefined,
    init: (...args: A) => S,
    facets: F & ThisType<KitContext<S, KitOf<F>>>,
  ): (...args: A) => KitOf<F>;
  exo<T extends Methods>(
    tag: string,
    interfaceGuard: unknown,
    methods: T & ThisType<ClassContext<{}, Guarded<T>>>,
  ): Guarded<T>;
  makeOnce<T>(key: string, make: () => T): T;
  mapStore<K extends Key, V>(name: string): MapStore<K, V>;
  detached(): { mapStore<K extends Key, V>(label: string): MapStore<K, V> };
}

/** A kit's facets, as its maker answers them. */
export type KitOf<F extends Record<string, Methods>> = {
  [K in keyof F]: Guarded<F[K]>;
};

/** A SQLite value as a statement takes or answers it. */
export type SqlValue = string | number | null | ArrayBuffer;

/** A row a query answers, by column. */
export type SqlRow = Record<string, SqlValue>;

/** A prepared statement, as ertp-books' `SqlDatabase` has it. */
export type SqlStatement<P extends SqlValue[] = SqlValue[], R = SqlRow> = {
  run: (...params: P) => { changes: number };
  get: (...params: P) => R | undefined;
  all: (...params: P) => R[];
};

/** A vat's own SQLite, in ertp-books' `SqlDatabase` shape. */
export type SqlDatabase = {
  exec: (sql: string) => void;
  prepare: <P extends SqlValue[] = SqlValue[], R = SqlRow>(
    sql: string,
  ) => SqlStatement<P, R>;
  /** Run `fn` in one transaction, rolled back if it throws; `fn` can't await. */
  transaction: <T>(fn: () => T) => T;
};

/** What a kernel vat's `buildRootObject` gets, beside its params. */
export type VatPowers = {
  E: typeof EType;
  Far: typeof FarType;
  M: typeof MType;
  zone: Zone;
  db: SqlDatabase;
  /**
   * The service binding granted to this vat as `name`. A function, not a
   * record of bindings, since workerd's stubs can't be frozen, so can't be
   * hardened.
   */
  endowment: (name: string) => Fetcher;
};

/** A kernel vat's module: it builds its root anew each incarnation. */
export type BuildRootObject<P = any> = (powers: VatPowers, params: P) => object;

/** An HTTP request to an ingress's mount, as data. */
export type HttpRequest = {
  method: string;
  path: string;
  labels: Record<string, string>;
  body: string;
};

/** A handler's answer to an {@link HttpRequest}, as data. */
export type HttpResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

/**
 * A reference to an object in another vat, or a kernel object: E() reaches
 * its methods, whose types this vat can't name. (Its interface guard, where
 * it lives, is what checks the calls.)
 */
export type Remote = any;
