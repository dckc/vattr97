/** Wiki pages, whose history anyone holding a page can read: damage is repairable. */
/** @import { BuildRootObject } from '../../src/types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, zone }) => {
  const makePage = zone.exoClass(
    'Page',
    undefined,
    (/** @type {string} */ text) => ({ history: [text] }),
    {
      read() {
        return this.state.history.at(-1);
      },
      /** @param {string} text */
      write(text) {
        this.state.history = [...this.state.history, text];
      },
      history() {
        return this.state.history;
      },
    },
  );
  return Far('wikiRoot', {
    /** @param {string} text */
    makePage: text => makePage(text),
  });
};
