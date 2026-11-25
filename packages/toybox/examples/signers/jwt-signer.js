/**
 * @file JWT signers, for a definition: built from an Ed25519 or P-256
 * signer, a clock, and entropy, as the kernel's `jwtSigners` device's are.
 * Its params: `key`, from `E(crypto).makeSigner(keys.readOnly(), 'Ed25519')`
 * (or `'P-256'`); `timer`, whose `now()` stamps each JWT; and `entropy`,
 * whose `swiss()` is each JWT's nonce. Its root makes signers with a `kid`,
 * fixed claims, and a lifetime.
 */
import { base64urlOfHex, fail, utf8Hex } from './bytes.js';

/** Claims the signer stamps itself, which no one else may set. */
const STAMPED = harden(['nbf', 'exp', 'iat']);

/** The longest a JWT may live, in seconds. */
const MAX_TTL = 300;

/** Each signer algorithm's name in a JWS header. @type {Record<string, string>} */
const JWS_ALG = harden({ Ed25519: 'EdDSA', 'P-256': 'ES256' });

/** @param {unknown} value */
const jsonB64url = value => base64urlOfHex(utf8Hex(JSON.stringify(value)));

/**
 * @typedef {object} Key an Ed25519 or P-256 signer
 * @property {() => string | Promise<string>} getAlgorithm
 * @property {(message: string) => Promise<string>} sign of hex, in hex
 */

/**
 * @param {{ E: (x: any) => any, Far: typeof import('@endo/far').Far }} powers
 * @param {{ key: Key, timer: { now(): number }, entropy: { swiss(): string } }} params
 */
export const buildRootObject = ({ E, Far }, { key, timer, entropy }) =>
  Far('JwtSigners', {
    /**
     * A signer whose JWTs carry `kid`, `claims`, and live `ttl` seconds.
     *
     * @param {string} kid the key's name, in each JWT's header
     * @param {Record<string, string | string[]>} claims in every JWT it signs
     * @param {number} [ttl]
     */
    make(kid, claims, ttl = 120) {
      typeof kid === 'string' || fail('kid: not a string');
      (Number.isSafeInteger(ttl) && ttl > 0 && ttl <= MAX_TTL) ||
        fail(`ttl: ${ttl} is not whole seconds, 1 to ${MAX_TTL}`);
      const stamped = Object.keys(claims).filter(c => STAMPED.includes(c));
      if (stamped.length)
        throw Error(`the signer stamps ${stamped.join(', ')} itself`);
      const fixed = harden({ ...claims });
      return Far('JwtSigner', {
        /**
         * A JWT of the fixed claims and these, which may not contradict
         * them, stamped now.
         *
         * @param {Record<string, string | string[]>} more
         */
        async sign(more) {
          const clash = Object.keys(more).filter(
            c => STAMPED.includes(c) || Object.hasOwn(fixed, c),
          );
          if (clash.length)
            throw Error(`sign: ${clash.join(', ')} is not yours to set`);
          const [algorithm, now, nonce] = await Promise.all([
            E(key).getAlgorithm(),
            E(timer).now(),
            E(entropy).swiss(),
          ]);
          const alg = JWS_ALG[algorithm] ?? fail(`no JWS alg for ${algorithm}`);
          const nbf = Math.floor(now / 1000);
          const input = `${jsonB64url({ alg, kid, nonce, typ: 'JWT' })}.${jsonB64url({ ...fixed, ...more, nbf, exp: nbf + ttl })}`;
          const signature = await E(key).sign(utf8Hex(input));
          return `${input}.${base64urlOfHex(signature)}`;
        },
      });
    },
  });
