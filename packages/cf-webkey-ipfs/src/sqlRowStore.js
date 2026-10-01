// @ts-check
import harden from '@endo/harden';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS caps (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    parent TEXT,
    sealed BLOB NOT NULL,
    note BLOB,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS caps_parent ON caps (parent);
`;

/**
 * @param {Uint8Array<ArrayBuffer> | null} bytes
 * @returns {ArrayBuffer | null} exactly the bytes viewed
 */
const toBlob = bytes =>
  bytes === null
    ? null
    : /** @type {ArrayBuffer} */ (
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        )
      );

/**
 * @param {Record<string, any>} record
 * @returns {import('./refTable.js').Row}
 */
const toRow = record =>
  harden({
    id: record.id,
    kind: record.kind,
    parent: record.parent,
    sealed: new Uint8Array(record.sealed),
    note: record.note === null ? null : new Uint8Array(record.note),
    createdAt: record.created_at,
    expiresAt: record.expires_at,
    revokedAt: record.revoked_at,
  });

/**
 * Capability rows in a Durable Object's SQLite database.
 *
 * @param {SqlStorage} sql
 * @returns {import('./refTable.js').RowStore}
 */
export const makeSqlRowStore = sql => {
  sql.exec(SCHEMA);

  return harden({
    get: id => {
      const [record] = sql
        .exec('SELECT * FROM caps WHERE id = ?', id)
        .toArray();
      return record ? toRow(record) : undefined;
    },
    insert: row => {
      sql.exec(
        `INSERT INTO caps
          (id, kind, parent, sealed, note, created_at, expires_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.kind,
        row.parent,
        toBlob(row.sealed),
        toBlob(row.note),
        row.createdAt,
        row.expiresAt,
        row.revokedAt,
      );
    },
    setSealed: (id, sealed) => {
      sql.exec('UPDATE caps SET sealed = ? WHERE id = ?', toBlob(sealed), id);
    },
    setRevoked: (id, revokedAt) => {
      sql.exec('UPDATE caps SET revoked_at = ? WHERE id = ?', revokedAt, id);
    },
    childrenOf: parent =>
      sql
        .exec('SELECT * FROM caps WHERE parent = ? ORDER BY created_at', parent)
        .toArray()
        .map(toRow),
  });
};
harden(makeSqlRowStore);
