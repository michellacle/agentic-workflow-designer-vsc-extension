import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        files: ['src/**/*.ts', 'webview/src/**/*.ts'],
        ignores: ['out/**', 'dist/**', 'node_modules/**'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            // Security
            'no-eval': 'error',
            'no-implied-eval': 'error',

            // Code quality
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-console': ['warn', { allow: ['warn', 'error'] }],

            // Best practices
            'eqeqeq': 'error',
            'curly': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
];
