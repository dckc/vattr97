/**
 * @file An OCapN netlayer whose transport is a Cap'n Web session.
 *
 * Each OCapN connection is a pair of {@link ByteInbox}es, one per
 * direction, exchanged through a {@link ByteGateway}; each `deliver` call
 * carries exactly one OCapN message, so no framing is needed. Cap'n Web
 * provides ordering and only-the-peer-can-inject; OCapN does the rest.
 *
 * @see https://github.com/ocapn/ocapn/blob/main/draft-specifications/Netlayers.md
 */
import { RpcTarget } from 'capnweb';
import type { RpcStub } from 'capnweb';

export const TRANSPORT = 'capnweb';

/** @see `OcapnLocation` in `@endo/ocapn/src/codecs/components.js` */
export type OcapnLocation = {
  type: 'ocapn-peer';
  designator: string;
  transport: string;
  hints: false | Record<string, string>;
};

type Connection = {
  write: (bytes: Uint8Array) => void;
  end: () => void;
  isDestroyed: boolean;
};

/** @see `NetlayerHandlers` in `@endo/ocapn/src/client/types.js` */
export type NetlayerHandlers = {
  makeConnection: (
    netlayer: NetLayer,
    isOutgoing: boolean,
    socket: { write: (bytes: Uint8Array) => void; end: () => void },
  ) => Connection;
  handleMessageData: (connection: Connection, data: Uint8Array) => void;
  handleConnectionClose: (connection: Connection, reason?: Error) => void;
};

/** @see `NetLayer` in `@endo/ocapn/src/client/types.js` */
export type NetLayer = {
  location: OcapnLocation;
  locationId: string;
  connect: (location: OcapnLocation) => Connection;
  shutdown: () => void;
};

type Logger = { log: (...args: unknown[]) => void };

/**
 * Same as `locationToLocationId` in `@endo/ocapn/src/client/util.js`,
 * which the package's exports map doesn't expose.
 */
const locationToLocationId = ({
  designator,
  transport,
  hints,
}: OcapnLocation) => {
  const uri = `ocapn://${designator}.${transport}`;
  const keys = hints ? Object.keys(hints).sort() : [];
  if (!hints || keys.length === 0) return uri;
  const params = keys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(hints[k])}`)
    .join('&');
  return `${uri}?${params}`;
};

/** Receives one direction of an OCapN connection, one message per call. */
export class ByteInbox extends RpcTarget {
  readonly #onMessage: (bytes: Uint8Array) => void;

  constructor(onMessage: (bytes: Uint8Array) => void) {
    super();
    this.#onMessage = onMessage;
  }

  deliver(bytes: Uint8Array): void {
    // Over WebSocket in Node, Cap'n Web may hand us a pooled Buffer view
    // (whose slice() doesn't copy); OCapN's syrup reader needs offset 0.
    this.#onMessage(bytes.byteOffset === 0 ? bytes : new Uint8Array(bytes));
  }
}

type RemoteInbox = { deliver: (bytes: Uint8Array) => unknown };

/** The Cap'n Web main object of a peer that accepts OCapN connections. */
export interface ByteGateway {
  connect(peerInbox: ByteInbox): RemoteInbox;
}

/**
 * Write to a remote inbox. Results are discarded at once so that
 * Cap'n Web does not retain one per message.
 */
const makeSocket = (inbox: RpcStub<RemoteInbox>, close: () => void) => ({
  write: (bytes: Uint8Array) => {
    const result = inbox.deliver(bytes) as unknown as Disposable;
    result[Symbol.dispose]();
  },
  end: close,
});

/**
 * Make an OCapN netlayer over Cap'n Web, for `client.registerNetlayer`.
 *
 * @param designator - this peer's designator
 * @param hints - how others reach this peer, e.g. `{ url }`; `false`
 *   for a peer that only dials out
 * @param openGateway - dial a peer, given its location hints
 * @returns the netlayer and a Cap'n Web main object that accepts
 *   incoming connections
 */
export const makeCapnwebNetLayer = ({
  designator,
  hints,
  openGateway,
}: {
  designator: string;
  hints: OcapnLocation['hints'];
  openGateway: (location: OcapnLocation) => RpcStub<ByteGateway>;
}) => {
  const location: OcapnLocation = {
    type: 'ocapn-peer',
    transport: TRANSPORT,
    designator,
    hints,
  };
  const connections = new Set<Connection>();

  return (handlers: NetlayerHandlers, logger: Logger) => {
    const track = (connection: Connection, inbox: RpcStub<RemoteInbox>) => {
      connections.add(connection);
      inbox.onRpcBroken(reason => {
        connections.delete(connection);
        logger.log('capnweb netlayer: connection broken', reason);
        handlers.handleConnectionClose(connection, reason as Error);
      });
    };

    const netlayer: NetLayer = {
      location,
      locationId: locationToLocationId(location),
      connect: peer => {
        const gateway = openGateway(peer);
        let connection: Connection | undefined;
        const myInbox = new ByteInbox(bytes =>
          handlers.handleMessageData(connection!, bytes),
        );
        // Pipelined: writes before the peer answers queue in order.
        const peerInbox = gateway.connect(myInbox) as RpcStub<RemoteInbox>;
        connection = handlers.makeConnection(
          netlayer,
          true,
          makeSocket(peerInbox, () => gateway[Symbol.dispose]()),
        );
        track(connection, peerInbox);
        return connection;
      },
      shutdown: () => {
        for (const connection of connections) connection.end();
        connections.clear();
      },
    };

    class Gateway extends RpcTarget implements ByteGateway {
      connect(peerInbox: ByteInbox) {
        const peer = (
          peerInbox as unknown as RpcStub<RemoteInbox>
        ).dup() as RpcStub<RemoteInbox>;
        const connection = handlers.makeConnection(
          netlayer,
          false,
          makeSocket(peer, () => peer[Symbol.dispose]()),
        );
        track(connection, peer);
        return new ByteInbox(bytes =>
          handlers.handleMessageData(connection, bytes),
        );
      }
    }

    return Object.assign(netlayer, { gateway: new Gateway() });
  };
};
