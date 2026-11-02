/**
 * @file Ingress labels, after [Flower](https://github.com/NuxiNL/flower):
 * string key-value pairs that only accumulate. A mount's labels and a
 * request's (its query parameters) merge; a key both give must agree.
 */

/**
 * Union of two label sets; throws on a key they give different values,
 * naming the key but not the values (they may end up in logs).
 *
 * @param {Record<string, string>} held
 * @param {Record<string, string>} more
 */
export const mergeLabels = (held, more) => {
  const merged = { ...held };
  for (const [k, v] of Object.entries(more)) {
    if (typeof v !== 'string')
      throw new TypeError(`label ${k} is not a string`);
    if (k in merged && merged[k] !== v)
      throw new Error(`label ${k} is already set to a different value`);
    merged[k] = v;
  }
  return Object.freeze(merged);
};
