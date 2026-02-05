import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import alignAssignments from 'eslint-plugin-align-assignments'

export default [
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            }
        },
        plugins: {
            '@typescript-eslint': tseslint,
            'align-assignments': alignAssignments
        },
        rules: {
            'max-len': ['error', { code: 120 }],
            'no-trailing-spaces': 'error',
            'align-assignments/align-assignments': 'error'
        }
    }
]
