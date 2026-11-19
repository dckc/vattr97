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
  /** `bytes` in base64, the standard alphabet, padded. */
  export function encodeBase64(bytes: Uint8Array): string;
}
