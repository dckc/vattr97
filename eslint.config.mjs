// Jessie: objects are hardened records of closures, not class instances.
const noClasses = [
  {
    selector: 'ClassDeclaration',
    message: 'Jessie: use a maker function that returns a hardened record.',
  },
  {
    selector: 'ClassExpression',
    message: 'Jessie: use a maker function that returns a hardened record.',
  },
  {
    selector: 'ThisExpression',
    message: 'Jessie: no `this`; close over state instead.',
  },
];

export default [
  {
    ignores: [
      'node_modules/',
      'coverage/',
      'dist/',
      '**/.wrangler/',
      '**/public/vendor/',
    ],
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
    files: ['packages/cf-webkey-ipfs/**/*.js'],
    rules: {
      'prefer-const': 'error',
      'no-var': 'error',
      'no-restricted-syntax': ['error', ...noClasses],
    },
  },
];
