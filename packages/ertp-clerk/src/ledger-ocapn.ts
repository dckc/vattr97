/**
 * @file The ledger as an OCapN peer on the Cap'n Web netlayer, and a
 * client that reaches it by sturdyref.
 */
import { makeClient, swissnumFromBytes } from '@endo/ocapn';
import type { RpcStub } from 'capnweb';
import { makeCapnwebNetLayer, TRANSPORT } from './ocapn-capnweb-netlayer.js';
import type { ByteGateway, OcapnLocation } from './ocapn-capnweb-netlayer.js';

/** Peers dial the ledger by URL, so its location carries no hints. */
export const LEDGER_LOCATION: OcapnLocation = {
  type: 'ocapn-peer',
  transport: TRANSPORT,
  designator: 'ledger',
  hints: false,
};
const LEDGER_SWISSNUM = 'ledger';

/** @returns the Cap'n Web main object for incoming connections */
export const makeLedgerHost = async (bootstrap: object) => {
  const ocapn = makeClient({ debugLabel: 'ledger' });
  ocapn.registerSturdyRef(LEDGER_SWISSNUM, bootstrap);
  const netlayer = await ocapn.registerNetlayer(
    makeCapnwebNetLayer({
      designator: LEDGER_LOCATION.designator,
      hints: LEDGER_LOCATION.hints,
      openGateway: () => {
        throw Error('ledger does not dial out');
      },
    }),
  );
  return {
    gateway: netlayer.gateway,
    shutdown: () => ocapn.shutdown(),
  };
};

/** Reach the ledger's bootstrap object through `openGateway`. */
export const connectLedger = async (
  openGateway: () => RpcStub<ByteGateway>,
  designator = 'client',
) => {
  const ocapn = makeClient({ debugLabel: designator });
  await ocapn.registerNetlayer(
    makeCapnwebNetLayer({ designator, hints: false, openGateway }),
  );
  const swissnum = swissnumFromBytes(new TextEncoder().encode(LEDGER_SWISSNUM));
  const ledger = await ocapn.enlivenSturdyRef(
    ocapn.makeSturdyRef(LEDGER_LOCATION, swissnum),
  );
  return { ledger, shutdown: () => ocapn.shutdown() };
};
