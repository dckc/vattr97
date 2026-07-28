const { freeze } = Object;

export type Sealed<T> = { readonly __sealed?: T };

export type Sealer<T = object> = { seal: (obj: T) => Sealed<T> };
export type Unsealer<T = object> = { unseal: (sealedObj: unknown) => T };

export const makeSealerUnsealerPair = <T extends object = object>(): {
  sealer: Sealer<T>;
  unsealer: Unsealer<T>;
} => {
  const sealedToReal = new WeakMap<object, T>();
  const realToSealed = new WeakMap<T, Sealed<T>>();

  const sealer: Sealer<T> = freeze({
    seal: (obj: T): Sealed<T> => {
      if (realToSealed.has(obj)) return realToSealed.get(obj)!;
      const sealedObj = freeze({}) as Sealed<T>;
      sealedToReal.set(sealedObj, obj);
      realToSealed.set(obj, sealedObj);
      return sealedObj;
    },
  });

  const unsealer: Unsealer<T> = freeze({
    unseal: (sealedObj: unknown): T => {
      if (!sealedToReal.has(sealedObj as object)) {
        throw new Error("That's not my sealed object!");
      }
      return sealedToReal.get(sealedObj as object)!;
    },
  });

  return { sealer, unsealer };
};
