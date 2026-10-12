/**
 * @file Ledgers as OCapN peers on the Cap'n Web netlayer, and a client
 * that reaches them by sturdyref.
 */
import { makeClient, swissnumFromBytes } from '@endo/ocapn';
import type { RpcStub } from 'capnweb';
import { makeCapnwebNetLayer, TRANSPORT } from './ocapn-capnweb-netlayer.js';
import type { ByteGateway, OcapnLocation } from './ocapn-capnweb-netlayer.js';
import { BOOTSTRAP_SWISSNUM } from './ledger.js';

/** The ledger at `/api`. */
export const DEFAULT_LEDGER = 'default';

/**
 * A ledger's designator is its name. Clients find it by name, so its
 * location carries no hints.
 */
export const ledgerLocation = (name: string): OcapnLocation => ({
  type: 'ocapn-peer',
  transport: TRANSPORT,
  designator: name,
  hints: false,
});

/**
 * @param swissnumTable - from `makeLedger`
 * @returns the Cap'n Web main object for incoming connections
 */
export const makeLedgerHost = async (
  swissnumTable: Map<string, unknown>,
  name = DEFAULT_LEDGER,
) => {
  const ocapn = makeClient({ debugLabel: name, swissnumTable });
  const netlayer = await ocapn.registerNetlayer(
    makeCapnwebNetLayer({
      designator: name,
      hints: false,
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
 * One party's OCapN client, for any number of ledgers.
 *
 * @param openGateway - dial the ledger with this name
 * @returns `ledger(name)` for a ledger's bootstrap object, and
 *   `enliven(name, swissnum)` for its other sturdyrefs (swissnums from
 *   the bootstrap's `makeSturdyRef`)
 */
export const makeLedgerClient = async (
  openGateway: (ledgerName: string) => RpcStub<ByteGateway>,
  designator = 'client',
) => {
  const ocapn = makeClient({ debugLabel: designator });
  await ocapn.registerNetlayer(
    makeCapnwebNetLayer({
      designator,
      hints: false,
      openGateway: location => openGateway(location.designator),
    }),
  );
  const enliven = (ledgerName: string, swissnum: string) =>
    ocapn.enlivenSturdyRef(
      ocapn.makeSturdyRef(
        ledgerLocation(ledgerName),
        swissnumFromBytes(new TextEncoder().encode(swissnum)),
      ),
    );
  return {
    ledger: (ledgerName: string) => enliven(ledgerName, BOOTSTRAP_SWISSNUM),
    enliven,
    shutdown: () => ocapn.shutdown(),
  };
};

/**
 * Reach one ledger through `openGateway`.
 *
 * @returns the bootstrap object, and `enliven` for other sturdyrefs
 */
export const connectLedger = async (
  openGateway: () => RpcStub<ByteGateway>,
  name = DEFAULT_LEDGER,
) => {
  const client = await makeLedgerClient(openGateway);
  return {
    ledger: await client.ledger(name),
    enliven: (swissnum: string) => client.enliven(name, swissnum),
    shutdown: client.shutdown,
  };
};
