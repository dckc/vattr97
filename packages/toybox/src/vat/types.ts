/** @file Types of a vat's side of the kernel: vrefs, messages, kinds, and the vatstore. */
import type { State } from '../types.js';

/** An object a party exports: its root, an ephemeral, or a durable object or kit facet (see liveslots.js). */
export type ExportVref = `o+${string}`;

/** An object a party holds from elsewhere, numbered by the kernel. */
export type ImportVref = `o-${number}`;

/** A party's own name for an object. Only that party's c-list gives it meaning. */
export type Vref = ExportVref | ImportVref;

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

/** The prefix of a store's entries in the vatstore, its id between the dots. */
export type StorePrefix = `store.${string}.`;

/** A key in the vatstore (see liveslots.js). */
export type VatstoreKey =
  /** a durable object's state, by vref */
  | `vom.${ExportVref}`
  /** how many durable objects a kind has made */
  | `vom.next.${string}`
  /** a kind's id, by tag; `kind.next` counts kinds */
  | `kind.${string}`
  /** a kind's facets, by kind id */
  | `kindFacets.${string}`
  /** what `makeOnce` made */
  | `once.${string}`
  /** a named store's reference */
  | `storeName.${string}`
  /** a store's entry */
  | `${StorePrefix}${string}`
  /** counts detached stores */
  | 'store.next';

/** Where a vat's durable objects and stores live: strings by key. */
export type Vatstore = {
  get: (k: VatstoreKey) => string | undefined;
  put: (k: VatstoreKey, v: string) => void;
  delete: (k: VatstoreKey) => void;
  /** the keys with `prefix`, sorted */
  keys: (prefix: StorePrefix) => VatstoreKey[];
};

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
