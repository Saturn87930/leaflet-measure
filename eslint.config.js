module.export = [
  {
    languageOptions: {
      globals: {
        L: true,
        __: true,
      },
    },
    rules: {
      'comma-dangle': ['error', 'always-multiline'],
    },
    ignores: ['dist'],
  },
];
