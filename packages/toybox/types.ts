/**
 * @file Types shared by toybox's modules and vats. The modules are
 * JavaScript, run as they are by workerd; they import these with JSDoc
 * `@import`, and `tsc --checkJs` checks them.
 */
import type { E as EType, Far as FarType } from '@endo/far';
import type { M as MType } from '@endo/patterns';
import type { ORM, Row } from './orm.js';

/** The kernel's name for an object, the same for every party. */
export type Kref = `ko${number}`;

/** A vat, as the kernel knows it. */
export type VatId = `v${number}`;

/** An object a party exports: its root, an ephemeral, or a durable object or kit facet (see liveslots.js). */
export type ExportVref = `o+${string}`;

/** An object a party holds from elsewhere, numbered by the kernel. */
export type ImportVref = `o-${number}`;

/** A party's own name for an object. Only that party's c-list gives it meaning. */
export type Vref = ExportVref | ImportVref;

/** A kernel object's key: its kind's prefix, then whatever tells it from others of its kind. */
export type KernelKey = `${string}:${string}`;

/** An ingress's key: `<kernel id>:<number or socket name>` after its prefix. */
export type IngressKey = `kernel:${string}`;

/** A message's arguments or answer: marshalled data, and the references in it, by slot. */
export type CapData<Slot extends string = Vref> = {
  body: string;
  slots: Slot[];
};

/** How a party sends a message to an object it holds, by vref. */
export type Send = (
  vref: Vref,
  method: string,
  capdata: CapData,
) => Promise<CapData>;

/** Where a vat's durable objects and stores live: strings by string key. */
export type Vatstore = {
  get: (k: string) => string | undefined;
  put: (k: string, v: string) => void;
  delete: (k: string) => void;
  /** the keys with `prefix`, sorted */
  keys: (prefix: string) => string[];
};

/**
 * A kind's methods, as a vat defines them. Their parameters and answers
 * are the vat's to choose, so they're `any` here; an interface guard is
 * what checks them.
 */
export type Methods = Record<string, (...args: any[]) => any>;

/** A durable object's state: the record its kind's `init` answers. */
export type State = Record<string, unknown>;

/**
 * A durable kind, this incarnation: `make(state)` answers an object (or,
 * for a kit, a record of facets) whose methods see `state` as `this.state`,
 * after @endo/exo, which checks any interface guards.
 */
export type Kind = {
  kit: boolean;
  facets: string[];
  make: (state: State) => any;
};

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
};

/** A kernel vat's module: it builds its root anew each incarnation. */
export type BuildRootObject<P = any> = (powers: VatPowers, params: P) => object;

/** One party's vrefs, translated to and from krefs. */
export type Clist = {
  toKernel: (vref: Vref) => Kref;
  toVat: (kref: Kref) => Vref;
};

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

/** What a fetch device sends. */
export type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/** What a fetch device answers: the body as text. */
export type FetchAnswer = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/**
 * A kind of kernel object (a device, after SwingSet's): messages to an
 * object whose key is `<prefix>:<rest>` come here, their arguments
 * unmarshalled, references as the kernel's stand-ins for krefs.
 */
export type KernelObjects = {
  deliver: (rest: string, method: string, args: unknown[]) => unknown;
};

/** What every kind of kernel object may use of the kernel. */
export type KernelPowers = {
  /** the next number in the counter `name` */
  next: (name: string) => number;
  /** the kref of the kernel object `key`, made the first time it's asked for */
  kernelObject: (key: KernelKey) => Kref;
  /** the object that stands for `kref` in a message */
  standIn: (kref: Kref) => object;
  /** the kref a stand-in stands for, if it is one */
  krefOf: (obj: unknown) => Kref | undefined;
  /** the key of the kernel's own object `kref`, if it is one */
  keyOf: (kref: Kref) => KernelKey | undefined;
};

/** What a kind of kernel object with tables of its own gets: statements on those, and no others. */
export type TablePowers<DB extends Record<string, Row>> = KernelPowers & {
  db: ORM<DB>;
};

/**
 * Create `tables` (DDL by table name), and answer powers limited to them.
 * The rows' types are the module's that declares the tables.
 */
export type WithTables = (tables: Record<string, string>) => TablePowers<any>;

/**
 * A reference to an object in another vat, or a kernel object: E() reaches
 * its methods, whose types this vat can't name. (Its interface guard, where
 * it lives, is what checks the calls.)
 */
export type Remote = any;
