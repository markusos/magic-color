import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Flat ESLint config for the Vite + React + TypeScript app. Type-aware linting is enabled
 * (parserOptions.projectService) so rules can reason about types, mirroring the strict
 * `tsconfig.json`. Build output and config files that don't belong to the TS project are
 * ignored.
 */
export default tseslint.config(
  // `scripts/` holds standalone dev tools run via tsx; they're outside the app's tsconfig, so the
  // type-aware linter can't resolve them. They aren't part of the build, so skip them.
  // `src/game/levels.data.ts` and `src/game/levels.provenance.ts` are generated
  // (`npm run build:levels`); tsc still typechecks them, but there's nothing to lint in a committed
  // data blob.
  {
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
      'scripts',
      // Playwright E2E + its config run under Playwright's own runner (its esbuild transpiles them),
      // so — like `scripts/` — they live outside the app's tsconfig and the type-aware linter.
      'e2e',
      'playwright.config.ts',
      'playwright-report',
      'test-results',
      'src/game/levels.data.ts',
      'src/game/levels.provenance.ts',
      // wasm-pack build output (Track F core); generated JS/dts, nothing to lint.
      'core/pkg',
      'src/game/core-pkg',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Test and Node-side config files run under Vitest/Node globals.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
