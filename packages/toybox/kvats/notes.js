/** Notes, kept in the vat's own SQLite (`db`), not its zone. */
/** @import { BuildRootObject } from '../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, db }) => {
  db.exec(
    'CREATE TABLE IF NOT EXISTS note (n INTEGER PRIMARY KEY, text TEXT NOT NULL)',
  );
  db.exec('CREATE INDEX IF NOT EXISTS note_text ON note (text)');
  const add = db.prepare('INSERT INTO note (text) VALUES (?)');
  /** @type {import('../types.js').SqlStatement<[], { text: string }>} */
  const all = db.prepare('SELECT text FROM note ORDER BY n');
  return Far('notes', {
    /** Add a note; answers how many rows that changed. @param {string} text */
    add: text => add.run(text).changes,
    list: () => harden(all.all().map(r => r.text)),
  });
};
