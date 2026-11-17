/** @file The public page's filters, ported with capsite diigo-cache's tests (tests/query.test.ts). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matches, parseQuery, toQuery } from '../src/cache/query.js';

// goal 1d (capsite checklist)

/** vitest's expect, the matchers these tests use, over node:assert */
const expect = (/** @type {any} */ actual) => ({
  toBe: (/** @type {unknown} */ want) => assert.equal(actual, want),
  toEqual: (/** @type {unknown} */ want) => assert.deepEqual(actual, want),
  toMatch: (/** @type {RegExp | string} */ want) =>
    assert.match(
      actual,
      typeof want === 'string'
        ? new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        : want,
    ),
  toHaveProperty: (/** @type {string} */ name) => assert.ok(name in actual),
});

const NOW = new Date('2026-10-07T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const fromUrl = (/** @type {string} */ qs) =>
  parseQuery(Object.fromEntries(new URLSearchParams(qs)), NOW);
/** @typedef {import('../src/cache/query.js').Query} Query @typedef {import('../src/cache/query.js').QueryError} QueryError */
const ok = (/** @type {Query | QueryError} */ q) => {
  if ('error' in q) throw new Error(`expected a query: ${q.error}`);
  return q;
};
const url = (/** @type {string} */ qs) => ok(fromUrl(qs));
const spec = (/** @type {import('../src/cache/query.js').FilterSpec} */ s) =>
  ok(toQuery(s, NOW));
const refused = (/** @type {Query | QueryError} */ q) => {
  expect(q).toHaveProperty('error');
  return /** @type {QueryError} */ (q).error;
};
const day = (/** @type {string} */ iso) => new Date(`${iso}T00:00:00.000Z`);
const range = (/** @type {Query} */ q) => [
  q.after?.toISOString().slice(0, 10),
  q.before?.toISOString().slice(0, 10),
];

describe('filters: one spec, two spellings (goal 1d)', () => {
  it('devs write { days: 7 }; URLs write ?days=7; same query', () => {
    expect(spec({ days: 7 })).toEqual(url('days=7'));
    expect(spec({ days: 7 }).after).toEqual(new Date(NOW.getTime() - 7 * DAY));
  });

  it('an empty spec or URL filters nothing', () => {
    expect(spec({})).toEqual({ by: 'updated', words: [], tags: [] });
    expect(url('')).toEqual({ by: 'updated', words: [], tags: [] });
  });

  it('empty URL fields mean absent (a GET form submits them all)', () => {
    expect(url('days=7&after=&before=&in=&by=&q=')).toEqual(url('days=7'));
  });

  it("refuses a days value that isn't a whole number from 1 to 3650", () => {
    for (const bad of ['0', '-7', '7x', '1.5', '3651'])
      expect(refused(fromUrl(`days=${bad}`))).toMatch(/days/);
    expect(refused(toQuery({ days: 0 }, NOW))).toMatch(/days/);
  });
});

describe('windows: UTC, half-open (goal 1d)', () => {
  it('after/before are UTC days: after inclusive from 00:00Z, before exclusive', () => {
    expect(range(url('after=2026-01-01&before=2026-02-01'))).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(url('after=2026/01/01').after).toEqual(day('2026-01-01'));
  });

  it('in= names a year, month, quarter, or ISO week', () => {
    expect(range(url('in=2025'))).toEqual(['2025-01-01', '2026-01-01']);
    expect(range(url('in=2025-03'))).toEqual(['2025-03-01', '2025-04-01']);
    expect(range(url('in=2025-12'))).toEqual(['2025-12-01', '2026-01-01']);
    expect(range(url('in=2025-Q1'))).toEqual(['2025-01-01', '2025-04-01']);
    expect(range(url('in=2025-Q4'))).toEqual(['2025-10-01', '2026-01-01']);
    // ISO 8601: weeks start Monday; week 1 holds the year's first Thursday
    expect(range(url('in=2025-W01'))).toEqual(['2024-12-30', '2025-01-06']);
    expect(range(url('in=2026-W53'))).toEqual(['2026-12-28', '2027-01-04']);
  });

  it('refuses malformed dates and periods', () => {
    expect(refused(fromUrl('after=2026-13-01'))).toMatch(/after/);
    expect(refused(fromUrl('before=yesterday'))).toMatch(/before/);
    // 2025 has 52 ISO weeks (it starts on a Wednesday, not a leap year)
    for (const bad of [
      '2025-13',
      '2025-Q5',
      '2025-W53',
      '2025-W00',
      '25',
      '2025-1',
    ]) {
      expect(refused(fromUrl(`in=${bad}`))).toMatch(/in/);
    }
  });

  it('refuses a bound given twice, and an empty window', () => {
    expect(refused(fromUrl('days=7&after=2026-01-01'))).toMatch(
      /days.*after|after.*days/,
    );
    expect(refused(fromUrl('in=2025&days=7'))).toMatch(/in/);
    expect(refused(fromUrl('in=2025&before=2025-02-01'))).toMatch(/in/);
    expect(refused(fromUrl('after=2026-02-01&before=2026-02-01'))).toMatch(
      /after.*before|before.*after/,
    );
  });

  it('days combines with before', () => {
    const q = url('days=30&before=2026-10-01');
    expect(q.after).toEqual(new Date(NOW.getTime() - 30 * DAY));
    expect(q.before).toEqual(day('2026-10-01'));
  });

  it('by=created or by=updated picks the date (default updated); anything else is refused', () => {
    expect(url('days=7').by).toBe('updated');
    expect(url('days=7&by=created').by).toBe('created');
    expect(refused(fromUrl('days=7&by=modified'))).toMatch(/by/);
  });
});

describe('q: terms and operators (goal 1d)', () => {
  const q = (/** @type {string} */ text) =>
    url(`q=${encodeURIComponent(text)}`);

  it('words, phrases, #tags, tag:, and - negation; case-insensitive', () => {
    const parsed = q(
      'Foo bar -baz "exact phrase" #Weekly tag:ocap -#draft -tag:old',
    );
    expect(parsed.words).toEqual([
      { text: 'foo', negated: false },
      { text: 'bar', negated: false },
      { text: 'baz', negated: true },
      { text: 'exact phrase', negated: false },
    ]);
    expect(parsed.tags).toEqual([
      { text: 'weekly', negated: false },
      { text: 'ocap', negated: false },
      { text: 'draft', negated: true },
      { text: 'old', negated: true },
    ]);
  });

  it("gmail's after:/before:/newer_than: set the window", () => {
    expect(range(q('after:2026-01-01 before:2026/02/01'))).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(q('newer_than:7d').after).toEqual(new Date(NOW.getTime() - 7 * DAY));
    expect(q('newer_than:2w').after).toEqual(
      new Date(NOW.getTime() - 14 * DAY),
    );
    // months and years are calendar steps back, in UTC
    expect(q('newer_than:1m').after).toEqual(
      new Date('2026-09-07T12:00:00.000Z'),
    );
    expect(q('newer_than:1y').after).toEqual(
      new Date('2025-10-07T12:00:00.000Z'),
    );
  });

  it("Slack's during: (alias in:) names a period", () => {
    expect(range(q('during:2025-Q1'))).toEqual(['2025-01-01', '2025-04-01']);
    expect(range(q('in:2025-W01'))).toEqual(['2024-12-30', '2025-01-06']);
  });

  it('GitHub-style created:/updated: name the date and the period at once', () => {
    const c = q('created:2025');
    expect(c.by).toBe('created');
    expect(range(c)).toEqual(['2025-01-01', '2026-01-01']);
    expect(q('updated:2025-W03').by).toBe('updated');
  });

  it('operators and fields combine, but a bound given twice is refused', () => {
    const both = url(
      `by=created&q=${encodeURIComponent('during:2025 #weekly')}`,
    );
    expect(both.by).toBe('created');
    expect(both.tags).toEqual([{ text: 'weekly', negated: false }]);
    expect(
      refused(fromUrl(`days=7&q=${encodeURIComponent('newer_than:30d')}`)),
    ).toMatch(/newer_than|days/);
    expect(
      refused(fromUrl(`by=updated&q=${encodeURIComponent('created:2025')}`)),
    ).toMatch(/by|created/);
  });

  it('an unknown word:stuff is plain text (so urls work as words)', () => {
    expect(q('https://erights.org foo:bar').words).toEqual([
      { text: 'https://erights.org', negated: false },
      { text: 'foo:bar', negated: false },
    ]);
  });

  it('a malformed known operator is refused, not searched as text', () => {
    expect(
      refused(fromUrl(`q=${encodeURIComponent('newer_than:7x')}`)),
    ).toMatch(/newer_than/);
    expect(
      refused(fromUrl(`q=${encodeURIComponent('during:2025-Q5')}`)),
    ).toMatch(/during/);
  });
});

/** an item updated at `iso`, diigo-shaped */
const item = (
  /** @type {string} */ iso,
  /** @type {Record<string, unknown>} */ extra = {},
) => ({
  updated_at: new Date(iso).getTime() / 1000,
  title: '',
  description: '',
  url: 'https://example.com/',
  tags: '',
  ...extra,
});
/** @returns {Query} */
const query = (/** @type {Partial<Query>} */ q) => ({
  by: 'updated',
  words: [],
  tags: [],
  ...q,
});

describe('matches (goal 1d)', () => {
  it('the window is half-open: after inclusive, before exclusive', () => {
    const q = query({ after: day('2026-01-01'), before: day('2026-02-01') });
    expect(matches(item('2026-01-01T00:00:00.000Z'), q)).toBe(true);
    expect(matches(item('2025-12-31T23:59:59.000Z'), q)).toBe(false);
    expect(matches(item('2026-01-31T23:59:59.000Z'), q)).toBe(true);
    expect(matches(item('2026-02-01T00:00:00.000Z'), q)).toBe(false);
  });

  it('by=created windows on created_at instead of updated_at', () => {
    const jan = { after: day('2026-01-01') };
    // an old bookmark, edited recently
    const edited = item('2026-01-05T00:00:00Z', {
      created_at: new Date('2025-06-01T00:00:00Z').getTime() / 1000,
    });
    expect(matches(edited, query({ ...jan, by: 'updated' }))).toBe(true);
    expect(matches(edited, query({ ...jan, by: 'created' }))).toBe(false);
  });

  it('every word must appear in the title, description, or url (case-insensitive)', () => {
    const it1 = item('2026-01-05T00:00:00Z', {
      title: 'Capability Patterns',
      url: 'https://erights.org/x',
    });
    expect(
      matches(it1, query({ words: [{ text: 'capability', negated: false }] })),
    ).toBe(true);
    expect(
      matches(it1, query({ words: [{ text: 'erights', negated: false }] })),
    ).toBe(true);
    expect(
      matches(
        it1,
        query({
          words: [
            { text: 'capability', negated: false },
            { text: 'missing', negated: false },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('a negated word excludes', () => {
    const it1 = item('2026-01-05T00:00:00Z', { title: 'Capability Patterns' });
    expect(
      matches(it1, query({ words: [{ text: 'patterns', negated: true }] })),
    ).toBe(false);
  });

  it('a phrase matches only contiguously', () => {
    const it1 = item('2026-01-05T00:00:00Z', {
      description: 'object capability patterns',
    });
    expect(
      matches(
        it1,
        query({ words: [{ text: 'capability patterns', negated: false }] }),
      ),
    ).toBe(true);
    expect(
      matches(
        it1,
        query({ words: [{ text: 'patterns object', negated: false }] }),
      ),
    ).toBe(false);
  });

  it('a tag matches a whole comma-separated tag, case-insensitive; not a substring', () => {
    const it1 = item('2026-01-05T00:00:00Z', { tags: 'ocap,Weekly-Notes,js' });
    expect(
      matches(it1, query({ tags: [{ text: 'weekly-notes', negated: false }] })),
    ).toBe(true);
    expect(
      matches(it1, query({ tags: [{ text: 'weekly', negated: false }] })),
    ).toBe(false);
    expect(matches(it1, query({ tags: [{ text: 'js', negated: true }] }))).toBe(
      false,
    );
  });
});
