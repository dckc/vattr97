/** Hello, world, served through the `ingress` it was created with, by a durable handler. */
/** @import { BuildRootObject, HttpRequest, Remote } from '../src/types.js' */

/** @type {BuildRootObject<{ ingress: Remote }>} */
export const buildRootObject = ({ E, Far, zone }, { ingress }) => {
  const makeHandler = zone.exoClass('Handler', undefined, () => ({ hits: 0 }), {
    /** @param {HttpRequest} request */
    handle({ path }) {
      this.state.hits += 1;
      return {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: `<!doctype html><title>hello</title><h1>Hello, world</h1><p>from a kernel vat, at ${path}, hit ${this.state.hits}</p>\n`,
      };
    },
  });
  zone.makeOnce('served', () => {
    const handler = makeHandler();
    E(ingress).serve(handler);
    return handler;
  });
  return Far('helloRoot', {});
};
