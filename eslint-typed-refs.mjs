/**
 * @file An ESLint rule: a JSDoc type says what a reference is. A plain
 * `Remote` is toybox's `Remote<any>`, and `any` turns the checker off, so
 * either one in a vat's params or a store's values silently drops the
 * types of everything reached through it. Write `Remote<X>`, where `X` is
 * the vat's exported root type (`ReturnType<typeof buildRootObject>`) or
 * an interface for a device; `unknown` where the type truly isn't known.
 */

/** JSDoc tags whose `{...}` is a type expression. */
const TYPE_TAG =
  /@(?:type|param|property|prop|returns?|typedef|satisfies|template|this|throws|yields)\s*\{/g;

/**
 * Each type expression in a JSDoc comment's text: the balanced `{...}`
 * after a type tag, with its offset into the text.
 *
 * @param {string} text
 * @returns {{ type: string, at: number }[]}
 */
export const typeExpressions = text => {
  const found = [];
  for (const m of text.matchAll(TYPE_TAG)) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === '{') depth += 1;
      if (text[i] === '}') depth -= 1;
    }
    found.push({ type: text.slice(start, i - 1), at: start });
  }
  return found;
};

/**
 * What's wrong with a type expression, if anything: each `any`, and each
 * `Remote` with no type argument.
 *
 * @param {string} type
 * @returns {{ word: string, at: number }[]}
 */
export const untyped = type => {
  // string literal types may say anything
  const code = type.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, s =>
    ' '.repeat(s.length),
  );
  return [...code.matchAll(/\bany\b|\bRemote\b(?!\s*<)/g)].map(m => ({
    word: m[0],
    at: m.index ?? 0,
  }));
};

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'JSDoc types say what a reference is: no bare Remote, no any',
    },
    messages: {
      any: '`any` in a JSDoc type turns the checker off: say what it is, or `unknown`',
      Remote:
        "a bare `Remote` is `Remote<any>`: write `Remote<X>`, X a vat's exported root type or a device's interface",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== 'Block' || !comment.value.startsWith('*'))
            continue;
          // the comment's text starts 2 characters into its source: after `/*`
          const base = (comment.range?.[0] ?? 0) + 2;
          for (const { type, at } of typeExpressions(comment.value))
            for (const bad of untyped(type)) {
              const offset = base + at + bad.at;
              context.report({
                loc: {
                  start: sourceCode.getLocFromIndex(offset),
                  end: sourceCode.getLocFromIndex(offset + bad.word.length),
                },
                messageId: /** @type {'any' | 'Remote'} */ (bad.word),
              });
            }
        }
      },
    };
  },
};

export default { rules: { 'typed-refs': rule } };
