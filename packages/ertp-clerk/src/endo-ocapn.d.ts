/** The subset of `@endo/ocapn` used here; the package ships JSDoc only. */
declare module '@endo/ocapn' {
  import type {
    NetLayer,
    NetlayerHandlers,
    OcapnLocation,
  } from './ocapn-capnweb-netlayer.js';

  type SwissNum = ArrayBufferLike & { _brand: 'SwissNum' };
  type SturdyRef = { _brand: 'SturdyRef' };

  export const swissnumFromBytes: (bytes: Uint8Array) => SwissNum;
  export const makeClient: (options?: { debugLabel?: string }) => {
    registerNetlayer: <T extends NetLayer>(
      makeNetlayer: (
        handlers: NetlayerHandlers,
        logger: { log: (...args: unknown[]) => void },
      ) => T | Promise<T>,
    ) => Promise<T>;
    registerSturdyRef: (swissStr: string, object: unknown) => void;
    makeSturdyRef: (location: OcapnLocation, swissNum: SwissNum) => SturdyRef;
    enlivenSturdyRef: (sturdyRef: SturdyRef) => Promise<any>;
    shutdown: () => void;
  };
}
