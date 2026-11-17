/**
 * @file The devices and toybox vats diigo-cache's vats hold, as they use
 * them. toybox types a plain `Remote` as `any`, and has no types of its
 * own for its devices yet, so these say what each call takes and answers.
 * The vats this package defines export their own types; see each one.
 */
import type {
  HttpRequest,
  HttpResponse,
  MapStore,
  Remote,
} from '../../toybox/src/types.js';
import type { FetchAnswer, FetchInit } from '../../toybox/src/devices/types.js';

/** An entropy device: unguessable numbers, for a vat, which has no randomness. */
export type Entropy = { swiss(): string };

/** What an ingress hands each request. */
export type Handler = {
  handle(request: HttpRequest): HttpResponse | Promise<HttpResponse>;
};

/** Where a vat serves web requests. */
export type Ingress = { serve(handler: Remote<Handler>): void };

/** The public internet, for the webApp vat alone. */
export type FetchDevice = {
  fetch(url: string, init?: FetchInit): Promise<FetchAnswer>;
};

/** A bundle's capability: opaque, to hand to `createVat` or `upgrade`. */
export type BundleCap = object;

/** The boot directory's bundles. */
export type Bundles = { getBundleCap(name: string): Promise<BundleCap> };

/** A vat's admin node, as its maker holds it. */
export type AdminNode = { upgrade(bundle: BundleCap): Promise<void> };

/**
 * Makes vats. The kernel says only that `root` is some vat's root; whoever
 * made it knows which.
 */
export type VatAdmin = {
  createVat(
    bundle: BundleCap,
    params: object,
  ): Promise<{ root: Remote<object>; adminNode: Remote<AdminNode> }>;
};

/** A WebApp (toybox examples/webapp.js), the calls diigo-cache makes. */
export type WebApp = {
  query(params: Record<string, string | number>): Remote<WebApp>;
  withHeaderMap(map: Remote<object>): Remote<WebApp>;
  get(): Promise<string>;
};

/** The webApp vat's root. */
export type WebAppMaker = {
  makeWebApp(url: string, headers?: Record<string, string>): Remote<WebApp>;
};

/** The storeMaker vat's root. */
export type StoreMaker = {
  makeMapStore(label: string): MapStore<string, string>;
};
