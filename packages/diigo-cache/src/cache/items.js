/**
 * @file diigo interact_api items: what the cache keeps of each, and who
 * may see it. Pure, so tests can feed it rows shaped like diigo's.
 */

/** One diigo item as the interact_api answers it. @typedef {Record<string, unknown>} Item */

/** The fields the cache keeps of an item; the rest (comments, annotations, ...) it drops. */
export const KEPT = harden([
  'link_id',
  'url',
  'title',
  'description',
  'tags',
  'created_at',
  'updated_at',
  'u_name',
]);

/**
 * diigo's id for a bookmark (`link_id`), as text; "" when absent.
 *
 * @param {Item} it
 */
export const linkIdOf = it =>
  typeof it.link_id === 'number' ||
  (typeof it.link_id === 'string' && it.link_id !== '')
    ? String(it.link_id)
    : '';

/**
 * Is the item private? diigo says so with `private`, or older rows with
 * `shared` other than "yes".
 *
 * @param {Item} it
 */
export const isPrivate = it =>
  it.private !== undefined ? Boolean(it.private) : String(it.shared) !== 'yes';

/**
 * What the cache keeps of `it`: its id, whether it's private, and the
 * kept fields as JSON; or `undefined` for an item it can't keep (no
 * link_id or url), which is skipped, never kept under a made-up key.
 *
 * @param {Item} it
 * @returns {{ id: string, private: boolean, json: string } | undefined}
 */
export const rowOf = it => {
  const id = linkIdOf(it);
  if (!id || typeof it.url !== 'string' || !it.url) return undefined;
  /** @type {Item} */
  const kept = {};
  for (const k of KEPT) if (it[k] !== undefined) kept[k] = it[k];
  return { id, private: isPrivate(it), json: JSON.stringify(kept) };
};

/**
 * The diigo username an item belongs to (`u_name`; not `first_by`, who
 * may be whoever bookmarked the URL first), or "".
 *
 * @param {Item | undefined} item
 */
export const usernameOf = item => {
  const name = typeof item?.u_name === 'string' ? item.u_name : '';
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : '';
};

/**
 * When diigo last updated the item, in epoch seconds (diigo's unit), or 0.
 *
 * @param {Item} it
 */
export const updatedOf = it =>
  typeof it.updated_at === 'number' && Number.isFinite(it.updated_at)
    ? it.updated_at
    : 0;
