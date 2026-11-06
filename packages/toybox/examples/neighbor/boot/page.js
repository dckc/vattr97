/** @file The yard page, as HTML. */

/** The yard's width and height, as mower.js lays it out. */
export const SIZE = 8;

/** @param {string} s */
const esc = s =>
  s.replace(
    /[&<>"]/g,
    c =>
      /** @type {Record<string, string>} */ ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
      })[c],
  );

/**
 * The yard page: cut cells green, the mower where it last cut, what the
 * last run said, and a form to lend the mower again.
 *
 * @param {string[]} cut cells as mower.js names them, `(x, y)`
 * @param {string[]} log
 * @param {{ fence: number, maxPushes: number }} limits
 */
export const page = (cut, log, { fence, maxPushes }) => {
  const cells = new Set(cut);
  const at = cut.at(-1);
  const rows = [];
  for (let y = 0; y < SIZE; y += 1) {
    let row = '';
    for (let x = 0; x < SIZE; x += 1) {
      const cell = `(${x}, ${y})`;
      row += cell === at ? '🚜' : cells.has(cell) ? '🟩' : '⬜';
    }
    rows.push(row);
  }
  const said = log.length
    ? `<h2>The tenant's last run</h2><ol>${log.map(l => `<li>${esc(l)}</li>`).join('')}</ol>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lend the mower</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem; }
pre { font-size: 28px; line-height: 1.1; }
</style></head><body>
<h1>Lend the mower</h1>
<p>The tenant holds only a governed mower: the fence is ${fence} pushes from where it starts.</p>
<pre>${rows.join('\n')}</pre>
<p>${cells.size} of ${SIZE * SIZE} cells cut.</p>
<form method="post" action="/run">
<label>Pushes: <input name="pushes" type="number" min="1" max="${maxPushes}" value="5"></label>
<button>Lend it to the tenant</button>
</form>
${said}
</body></html>
`;
};
