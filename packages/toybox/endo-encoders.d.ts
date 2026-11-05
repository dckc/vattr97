/**
 * @file Types for the Endo encoders, which ship JSDoc but no declarations
 * that tsc reads from node_modules.
 */
declare module '@endo/hex' {
  /** Lowercase hex of `bytes`. */
  export function encodeHex(bytes: Uint8Array): string;
  /** The bytes `string`, in hex, encodes; throws if it isn't hex. */
  export function decodeHex(string: string, name?: string): Uint8Array;
}

declare module '@endo/base64' {
  /** The base64 encoding of `data`. */
  export function encodeBase64(data: Uint8Array): string;
}
