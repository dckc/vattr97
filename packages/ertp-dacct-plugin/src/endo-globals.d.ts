import type { EProxy } from '@endo/eventual-send';

declare global {
  var E: EProxy;

  var Far: <T extends object>(name: string, iface: T) => T;
}
