/** @file Types of the kernel's side: krefs, vats, c-lists, kernel objects and devices, the powers they get, and bundles. */
import type { ORM, Row } from '../orm.js';
import type { Vref } from '../vat/types.js';

/** The kernel's name for an object, the same for every party. */
export type Kref = `ko${number}`;

/** A vat, as the kernel knows it. */
export type VatId = `v${number}`;

/** A kernel object's key: its kind's prefix, then whatever tells it from others of its kind. */
export type KernelKey = `${string}:${string}`;

/** An ingress's key: `<kernel id>:<number>` after its prefix. */
export type IngressKey = `kernel:${string}`;

/** One party's vrefs, translated to and from krefs. */
export type Clist = {
  toKernel: (vref: Vref) => Kref;
  toVat: (kref: Kref) => Vref;
};

/**
 * A kind of kernel object (a device, after SwingSet's): messages to an
 * object whose key is `<prefix>:<rest>` come here, their arguments
 * unmarshalled, references as the kernel's stand-ins for krefs.
 */
export type KernelObjects = {
  deliver: (rest: string, method: string, args: unknown[]) => unknown;
};

/**
 * An I/O device, as the kernel knows it: all it does with one is route
 * messages to its kinds, and make one of its objects for whoever may hold it.
 */
export type Device = {
  /** the kinds of object it defines, by key prefix */
  kinds: Record<string, KernelObjects>;
  /** a new object of this device, as a kref */
  make: () => Kref;
};

/**
 * The kernel's I/O devices, by name: an admin session's `makeDevice(name)`
 * makes one.
 */
export type MakeDevices = (
  powers: KernelPowers,
  io: {
    env: Env;
    bundles: ReturnType<typeof import('./bundles.js').makeBundles>;
    withTables: WithTables;
  },
) => Record<string, Device>;

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

/** What a bundle says of itself, in its worker.json. */
export type Manifest = {
  mainModule: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
};

/**
 * What the Worker Loader runs a bundle as, beside the vat runtime: its
 * modules, and the compatibility it asks for.
 */
export type BundleCode = {
  compatibilityDate: string;
  compatibilityFlags?: string[];
  modules: Record<string, unknown>;
};
