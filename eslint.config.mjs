import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import typedRefs from './eslint-typed-refs.mjs';

/**
 * Where authority starts in toybox: the tests themselves, and any script
 * (a file with a shebang), whose main takes its I/O as default arguments.
 * The other modules take what they use as parameters.
 */
const edge = [
  'packages/toybox/test/**/*.test.js',
  ...readdirSync('packages/toybox', { recursive: true })
    .map(String)
    .filter(
      f =>
        f.endsWith('.js') &&
        !f.startsWith('node_modules') &&
        !f.startsWith('dist') &&
        readFileSync(join('packages/toybox', f), 'utf8').startsWith('#!'),
    )
    .map(f => `packages/toybox/${f}`),
];

export default [
  {
    ignores: ['**/node_modules/', '**/coverage/', '**/dist/'],
  },
  {
    languageOptions: {
      globals: {
        harden: 'readonly',
      },
    },
    rules: {
      semi: 'error',
      'no-unused-vars': 'warn',
    },
  },
  {
    // toybox's kernel, vats, and test helpers take clocks, randomness, and
    // I/O only as powers they're given; see edge for where they start
    files: ['packages/toybox/**/*.js'],
    ignores: edge,
    rules: {
      'no-restricted-properties': [
        'error',
        ...[
          ['Math', 'random'],
          ['Date', 'now'],
          ['crypto', 'getRandomValues'],
          ['crypto', 'randomUUID'],
          ['performance', 'now'],
        ].map(([object, property]) => ({
          object,
          property,
          message: 'ambient authority: take it as a power',
        })),
      ],
      'no-restricted-globals': [
        'error',
        ...['fetch', 'setTimeout', 'setInterval', 'process', 'WebSocket'].map(
          name => ({ name, message: 'ambient authority: take it as a power' }),
        ),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'ambient authority (the clock): take it as a power',
        },
      ],
    },
  },
  {
    // I/O modules are imported only where authority starts (see edge).
    // Every other module, test helpers included, takes what it uses as a
    // parameter.
    files: ['packages/toybox/**/*.js'],
    ignores: edge,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'node:child_process',
            'node:fs',
            'node:fs/promises',
            'node:http',
            'node:net',
            'node:os',
            'node:sqlite',
            'node:timers/promises',
            'ws',
            'workerd',
          ].map(name => ({
            name,
            message: 'I/O is authority: take what you use as a parameter',
          })),
        },
      ],
    },
  },
  {
    // JSDoc types say what a reference is: no bare Remote, no any
    // (eslint-typed-refs.mjs). On where it holds today; widen as more
    // code is typed.
    files: [
      'packages/diigo-cache/**/*.js',
      'packages/session-ext/**/*.js',
      'packages/toybox/examples/session-keeper.js',
      'packages/toybox/examples/webapp.js',
      'packages/toybox/examples/store-maker.js',
      'packages/toybox/test/session-keeper.test.js',
      'eslint-typed-refs.mjs',
    ],
    plugins: { local: typedRefs },
    rules: { 'local/typed-refs': 'error' },
  },
];
