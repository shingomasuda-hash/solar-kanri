import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'generated/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'Math.random() is banned in deterministic engines. Inject a seeded RNG if randomness is required.',
        },
      ],
    },
  },
  {
    // Engine code must stay pure and deterministic: no I/O, no env, no clock.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'src/core must be pure: no env/process access.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'src/core must be deterministic: inject time.',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', '**/*.test.ts', 'prisma/seed.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-globals': 'off',
      // Test data needs to be unique per run; the determinism ban exists to
      // protect the engines, not the fixtures that exercise them.
      'no-restricted-syntax': 'off',
    },
  },
];

export default config;
