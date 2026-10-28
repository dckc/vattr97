import 'ses';
import '@endo/eventual-send/shim.js';
import { E, Far } from '@endo/far';
import harden from '@endo/harden';

harden({});
globalThis.harden = harden;
globalThis.E = E;
globalThis.Far = Far;
