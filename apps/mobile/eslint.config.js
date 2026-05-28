import config from '@split-wise/config-eslint/react';

export default [
  ...config,
  {
    ignores: ['babel.config.js', 'metro.config.js', 'tailwind.config.js', 'app.json'],
  },
];
