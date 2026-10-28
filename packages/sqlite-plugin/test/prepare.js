import 'ses';
import '@endo/eventual-send/shim.js';
import harden from '@endo/harden';

harden({});
globalThis.harden = harden;
