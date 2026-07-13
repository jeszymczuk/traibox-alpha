import js from '@eslint/js';
import next from '@next/eslint-plugin-next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/artifacts/**',
      '**/.turbo/**',
      '**/tmp/**',
      'scripts/conformance/fixtures/**',
      'apps/trade-brain/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    },
    rules: {
      'no-console': 'error'
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off'
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      '@next/next': next,
      'jsx-a11y': jsxA11y,
      react,
      'react-hooks': reactHooks
    },
    settings: {
      next: { rootDir: 'apps/web/' },
      react: { version: 'detect' }
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      'react-hooks/exhaustive-deps': 'error',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off'
    }
  }
);
