/**
 * @file The ledger as an OCapN peer on the Cap'n Web netlayer, and a
 * client that reaches it by sturdyref.
 */
import { makeClient, swissnumFromBytes } from '@endo/ocapn';
import type { RpcStub } from 'capnweb';
import { makeCapnwebNetLayer, TRANSPORT } from './ocapn-capnweb-netlayer.js';
import type { ByteGateway, OcapnLocation } from './ocapn-capnweb-netlayer.js';
import { BOOTSTRAP_SWISSNUM } from './ledger.js';

/** Peers dial the ledger by URL, so its location carries no hints. */
export const LEDGER_LOCATION: OcapnLocation = {
  type: 'ocapn-peer',
  transport: TRANSPORT,
  designator: 'ledger',
  hints: false,
};

/**
 * @param swissnumTable - from `makeLedger`
 * @returns the Cap'n Web main object for incoming connections
 */
export const makeLedgerHost = async (swissnumTable: Map<string, unknown>) => {
  const ocapn = makeClient({ debugLabel: 'ledger', swissnumTable });
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

/**
 * Reach the ledger through `openGateway`.
 *
 * @returns the bootstrap object, and `enliven` for other sturdyrefs
 *   (swissnums from the bootstrap's `makeSturdyRef`)
 */
export const connectLedger = async (
  openGateway: () => RpcStub<ByteGateway>,
  designator = 'client',
) => {
  const ocapn = makeClient({ debugLabel: designator });
  await ocapn.registerNetlayer(
    makeCapnwebNetLayer({ designator, hints: false, openGateway }),
  );
  const enliven = (swissnum: string) =>
    ocapn.enlivenSturdyRef(
      ocapn.makeSturdyRef(
        LEDGER_LOCATION,
        swissnumFromBytes(new TextEncoder().encode(swissnum)),
      ),
    );
  const ledger = await enliven(BOOTSTRAP_SWISSNUM);
  return { ledger, enliven, shutdown: () => ocapn.shutdown() };
};
