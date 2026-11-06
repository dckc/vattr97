/** @file The ingress's mounts, in SQL: which ingress serves which label set. */

/**
 * Labels sit one per row, so a lookup can use an index; `mount.labels`
 * keeps the whole set as JSON. Request and mount labels arrive as JSON
 * objects, split into rows by `json_each`.
 */
export const MOUNT_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS mount (vat TEXT PRIMARY KEY, labels TEXT)',
  'CREATE TABLE IF NOT EXISTS mount_label (vat TEXT, key TEXT, value TEXT, PRIMARY KEY (vat, key))',
  'CREATE INDEX IF NOT EXISTS mount_label_kv ON mount_label (key, value)',
  // mounts made before mount_label existed
  `INSERT OR IGNORE INTO mount_label
	 SELECT m.vat, j.key, j.value FROM mount m, json_each(m.labels) j
	 WHERE NOT EXISTS (SELECT 1 FROM mount_label l WHERE l.vat = m.vat)`,
];

/**
 * Another mount (than ?2's) whose labels conflict with none of ?1's.
 * Flower's registration rule: every mount must conflict with every other.
 */
export const OVERLAP = `
	SELECT 1 FROM mount m WHERE m.vat != ?2 AND NOT EXISTS (
		SELECT 1 FROM mount_label l JOIN json_each(?1) r ON r.key = l.key
		WHERE l.vat = m.vat AND l.value != r.value)
	LIMIT 1`;

export const MOUNT = 'INSERT OR REPLACE INTO mount VALUES (?1, ?2)';
export const MOUNT_LABELS =
  'INSERT INTO mount_label SELECT ?1, key, value FROM json_each(?2)';
export const UNMOUNT = 'DELETE FROM mount WHERE vat = ?1';
export const UNMOUNT_LABELS = 'DELETE FROM mount_label WHERE vat = ?1';

/**
 * The mount whose every label ?1 (the request's labels) carries, with the
 * same value: the labels that match, counted per vat, against how many
 * the vat has. A mount with no labels matches any request.
 *
 * Stricter than Flower's match (no conflict): an ingress client holds no
 * constrained handle that supplies labels for it, so a request reaches a
 * vat only by naming every label of its mount.
 */
export const LOOKUP = `
	SELECT m.vat, m.labels FROM mount m JOIN (
		SELECT l.vat, count(*) AS hits
		FROM json_each(?1) r JOIN mount_label l ON l.key = r.key AND l.value = r.value
		GROUP BY l.vat
	) h ON h.vat = m.vat
	WHERE h.hits = (SELECT count(*) FROM mount_label WHERE vat = m.vat)
	UNION ALL
	SELECT m.vat, m.labels FROM mount m
	WHERE NOT EXISTS (SELECT 1 FROM mount_label l WHERE l.vat = m.vat)
	LIMIT 1`;
