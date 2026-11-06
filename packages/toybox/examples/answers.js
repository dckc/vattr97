/** Answers each request with the status its `status` label asks for, or throws if its path is `/throw`. */
/** @import { BuildRootObject, HttpRequest, Remote } from '../src/types.js' */

/** @type {BuildRootObject<{ ingress: Remote }>} */
export const buildRootObject = ({ E, Far, zone }, { ingress }) => {
  const handler = zone.exo('Answers', undefined, {
    /** @param {HttpRequest} request */
    handle({ path, labels }) {
      if (path === '/throw') throw Error('asked to throw');
      return { status: Number(labels.status), body: 'body' };
    },
  });
  zone.makeOnce('served', () => {
    E(ingress).serve(handler);
    return handler;
  });
  return Far('answersRoot', {});
};
