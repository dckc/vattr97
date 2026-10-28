import { defaultZone } from './jessie-tools.ts';
import type { Zone } from './jessie-tools.ts';

const { freeze } = Object;

export type Sealed<T> = { readonly __sealed?: T };

export type Sealer<T = object> = { seal: (obj: T) => Sealed<T> };
export type Unsealer<T = object> = { unseal: (sealedObj: unknown) => T };

export const makeSealerUnsealerPair = <T extends object = object>(
  zone: Zone = defaultZone,
): {
  sealer: Sealer<T>;
  unsealer: Unsealer<T>;
} => {
  const sealedToReal = new WeakMap<object, T>();
  const realToSealed = new WeakMap<T, Sealed<T>>();

  const sealer: Sealer<T> = zone.exo('Sealer', {
    seal: (obj: T): Sealed<T> => {
      if (realToSealed.has(obj)) return realToSealed.get(obj)!;
      const sealedObj = zone.exo('Sealed', {}) as Sealed<T>;
      sealedToReal.set(sealedObj, obj);
      realToSealed.set(obj, sealedObj);
      return sealedObj;
    },
  });

  const unsealer: Unsealer<T> = zone.exo('Unsealer', {
    unseal: (sealedObj: unknown): T => {
      if (!sealedToReal.has(sealedObj as object)) {
        throw new Error("That's not my sealed object!");
      }
      return sealedToReal.get(sealedObj as object)!;
    },
  });

  return freeze({ sealer, unsealer });
};
