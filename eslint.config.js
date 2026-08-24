import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/coverage/**', '**/test-results/**']
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
  }
)