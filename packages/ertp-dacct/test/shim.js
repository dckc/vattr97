import { E } from '@endo/eventual-send';
import { makeExo } from '@endo/exo';
import { Far } from '@endo/far';
import { M } from '@endo/patterns';

const freeze = Object.freeze;
const ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

const makeHardener = ({ traversePrototypes }) => {
  const hardened = new WeakSet();
  const harden = root => {
    if (typeof root !== 'object' && typeof root !== 'function') return root;
    if (root === null) return root;
    if (hardened.has(root)) return root;
    const toFreeze = [];
    hardened.add(root);
    toFreeze.push(root);
    while (toFreeze.length > 0) {
      const val = toFreeze.pop();
      const keys = ownKeys(val);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const desc = getOwnPropertyDescriptor(val, key);
        if (desc && typeof desc.value === 'object' && desc.value !== null) {
          if (!hardened.has(desc.value)) {
            hardened.add(desc.value);
            toFreeze.push(desc.value);
          }
        }
      }
      if (!traversePrototypes) {
        // skip prototypes
      }
      freeze(val);
    }
    return root;
  };
  return harden;
};

globalThis.harden = makeHardener({ traversePrototypes: false });
globalThis.E = E;
globalThis.Far = Far;
globalThis.M = M;
globalThis.makeExo = makeExo;
