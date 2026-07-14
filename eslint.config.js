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
  // `src/game/levels.data.ts` and `src/game/levels.provenance.ts` are generated
  // (`npm run build:levels`); tsc still typechecks them, but there's nothing to lint in a committed
  // data blob.
  {
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
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
      // Rust build output (workspace `target/`). Nothing to lint, and — critically — the gate runs
      // the app (eslint) and core (cargo) lanes concurrently, so cargo churns `target/debug/deps`
      // with transient `.rmeta` temp files while `eslint .` walks the tree. Without this ignore that
      // race makes ESLint's directory scan hit a just-deleted file and crash (ENOENT).
      'target',
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
  // `scripts/` are standalone Node dev tools run via tsx (the gate, bake pipeline, dev launchers).
  // They live outside the app's `tsconfig.json`, so the default project service can't resolve them;
  // point the type-aware parser at `tsconfig.scripts.json` explicitly and run them under Node
  // globals, not the browser.
  {
    files: ['scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: false,
        project: './tsconfig.scripts.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
