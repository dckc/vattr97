/** @file The yard: the page that shows the lawn, and lends the mower again. */
import { page } from './page.js';

/** @import { HttpRequest, HttpResponse, MapStore, Powers, Remote, Zone } from '../../../src/types.js' */

/** The most pushes one run may ask for. */
export const MAX_PUSHES = 20;

/**
 * The yard, made the first time it's asked for: GET / shows it, and POST
 * /run lends the tenant the governed mower for some pushes. It finds the
 * mower, its governed facet, and the tenant in `lease`.
 *
 * @param {Zone} zone
 * @param {object} powers
 * @param {Powers['E']} powers.E
 * @param {MapStore<string, Remote>} powers.lease `mower`, `governed`, and `tenant`
 * @param {number} powers.fence how many pushes the governor allows, for the page to say
 */
export const provideYard = (zone, { E, lease, fence }) => {
  const makeYard = zone.exoClass(
    'Yard',
    undefined,
    () => ({ log: /** @type {string[]} */ ([]) }),
    {
      /** @param {HttpRequest} request @returns {Promise<HttpResponse>} */
      async handle({ method, path, body }) {
        if (method === 'GET' && path === '/') {
          const cut = await E(lease.get('mower')).getCut();
          return {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: page(cut, this.state.log, { fence, maxPushes: MAX_PUSHES }),
          };
        }
        if (method === 'POST' && path === '/run') {
          const pushes = Number(new URLSearchParams(body).get('pushes'));
          if (!Number.isInteger(pushes) || pushes < 1 || pushes > MAX_PUSHES)
            return {
              status: 400,
              body: `pushes: a whole number, 1 to ${MAX_PUSHES}\n`,
            };
          this.state.log = await E(lease.get('tenant')).run(
            lease.get('governed'),
            pushes,
          );
          return { status: 303, headers: { location: '/' } };
        }
        return { status: 404, body: 'not here\n' };
      },
    },
  );
  return zone.makeOnce('yard', () => makeYard());
};
