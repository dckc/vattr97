/**
 * @file CapTP with Cap'n Web as its netlayer.
 *
 * Cap'n Web carries one thing in each direction: an {@link Inbox} that
 * accepts serialized CapTP messages. Every application reference crosses
 * as CapTP data, so CapTP's import/export tables, not Cap'n Web's, decide
 * identity: a brand sent out and back arrives as the same object.
 *
 * @see https://github.com/cloudflare/capnweb
 * @see https://github.com/endojs/endo/tree/master/packages/captp
 */
import { makeCapTP } from '@endo/captp';
import { RpcTarget } from 'capnweb';
import type { RpcStub } from 'capnweb';

type CapTPMessage = Record<string, unknown>;

/** Receives one direction of a CapTP connection, one message per call. */
export class Inbox extends RpcTarget {
  readonly #dispatch: (message: CapTPMessage) => boolean;

  constructor(dispatch: (message: CapTPMessage) => boolean) {
    super();
    this.#dispatch = dispatch;
  }

  deliver(json: string): void {
    this.#dispatch(JSON.parse(json));
  }
}

type RemoteInbox = { deliver: (json: string) => unknown };

/**
 * Make a CapTP `send` that delivers to a remote inbox. Results are
 * discarded at once so that Cap'n Web does not retain one per message.
 */
const makeSend =
  (inbox: RpcStub<RemoteInbox> | Promise<RpcStub<RemoteInbox>>) =>
  (message: CapTPMessage) => {
    const result = (inbox as RpcStub<RemoteInbox>).deliver(
      JSON.stringify(message),
    ) as Disposable;
    result[Symbol.dispose]();
  };

/** The Cap'n Web main object a CapTP host exposes. */
export class Gateway extends RpcTarget {
  readonly #name: string;
  readonly #bootstrap: object;
  readonly #log: (...args: unknown[]) => void;

  constructor(name: string, bootstrap: object, log: typeof console.log) {
    super();
    this.#name = name;
    this.#bootstrap = bootstrap;
    this.#log = log;
  }

  /** Open a CapTP connection; `peerInbox` receives our messages. */
  connect(peerInbox: RpcStub<RemoteInbox>): Inbox {
    const peer = peerInbox.dup();
    const { dispatch, abort } = makeCapTP(
      this.#name,
      makeSend(peer),
      this.#bootstrap,
    );
    peer.onRpcBroken(reason => {
      this.#log(this.#name, 'peer connection broken', reason);
      abort(reason);
    });
    return new Inbox(dispatch);
  }
}

/**
 * Open a CapTP connection through a remote {@link Gateway}.
 *
 * @returns CapTP's bootstrap promise for the host's bootstrap object, and
 *   `abort` to tear the connection down.
 */
export const connectCapTP = (
  gateway: RpcStub<{ connect: (inbox: Inbox) => RemoteInbox }>,
  name: string,
) => {
  let dispatch: (message: CapTPMessage) => boolean = () => {
    throw Error('CapTP not ready');
  };
  // Pipelined: messages sent before the gateway answers queue in order.
  const hostInbox = gateway.connect(new Inbox(message => dispatch(message)));
  const captp = makeCapTP(name, makeSend(hostInbox));
  dispatch = captp.dispatch;
  hostInbox.onRpcBroken(reason => captp.abort(reason));
  return { getBootstrap: captp.getBootstrap, abort: captp.abort };
};
