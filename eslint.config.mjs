export default [
  {
    ignores: ['node_modules/', 'coverage/', 'dist/'],
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
];
