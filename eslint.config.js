import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/coverage/**', '**/test-results/**', '**/release-web/**', '**/.vscode-test/**']
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['scripts/capture-user-guide-screenshots.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    }
  },
  {
    files: ['apps/vscode-extension/src/webview/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  {
    files: ['apps/vscode-extension/test/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.mocha
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  }
)