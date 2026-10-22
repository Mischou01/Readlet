import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'src-tauri', 'vendor', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // foliate-js may only be imported by the reader wrapper (docs/PLAN.md §8).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['foliate-js/*', '**/vendor/foliate-js/*'],
              message: 'Import foliate-js only from src/reader/foliate.ts or BookView.tsx.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/reader/foliate.ts', 'src/reader/BookView.tsx', 'src/reader/foliate-js.d.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
)
