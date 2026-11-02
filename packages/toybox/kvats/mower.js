/** Mowers on an 8×8 yard: each starts at (4, 4) facing north and cuts the cells it enters. */
/** @import { BuildRootObject } from '../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, zone }) => {
  const makeMower = zone.exoClass(
    'Mower',
    undefined,
    () => ({ x: 4, y: 4, cut: /** @type {string[]} */ ([]) }),
    {
      start() {
        return this.self.cutHere();
      },
      push() {
        if (this.state.y === 0) throw Error('the yard ends here');
        this.state.y -= 1;
        return this.self.cutHere();
      },
      cutHere() {
        const cell = `(${this.state.x}, ${this.state.y})`;
        this.state.cut = [...this.state.cut, cell];
        return `cut ${cell}`;
      },
      getCut() {
        return this.state.cut;
      },
    },
  );
  return Far('mowerRoot', { makeMower: () => makeMower() });
};
