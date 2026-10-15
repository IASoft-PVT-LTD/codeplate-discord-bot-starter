// ESLint: `npm run lint` (also the `lint` step of `npm run check`).
// Lean on purpose: JavaScript and TypeScript basics plus a few rules that catch
// real bot bugs (a forgotten `await` on a reply is the classic one).
// TypeScript (`npm run typecheck`) does the type checking.
import { registerHooks } from 'node:module';
import { defineConfig } from 'eslint/config';

// typescript-eslint parses with TypeScript's JavaScript API. TypeScript 7 (the
// native compiler `tsc` uses) doesn't ship that API yet, so in this process its
// `typescript` imports load TypeScript 6 (`typescript-for-lint` in
// package.json), which reads the same syntax. Remove this, and the package,
// once typescript-eslint supports TypeScript 7.
registerHooks({
  resolve: (specifier, context, next) =>
    next(specifier === 'typescript' || specifier.startsWith('typescript/') ? specifier.replace(/^typescript/, 'typescript-for-lint') : specifier, context),
});
const { default: js } = await import('@eslint/js');
const { default: tseslint } = await import('typescript-eslint');

export default defineConfig(
  { ignores: ['node_modules/', '.data/', 'shots/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // A reply, edit or database call that isn't awaited fails silently or races.
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'test', 'it', 'suite'] }] },
      ],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    rules: {
      // Undefined names are TypeScript's job, and the .mjs scripts run in Node.
      'no-undef': 'off',
      // `_name` marks an argument or variable that's unused on purpose.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
);
