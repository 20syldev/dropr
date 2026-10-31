import { builtinModules } from 'module';

import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Node built-ins and server packages, which the core never imports so that it runs on any JavaScript runtime
const SERVER_MODULES = [...builtinModules, '@20syldev/logger.ts', 'cors', 'express'];

// Node globals and timers the core never reads, console included since logging belongs to the adapter
const SERVER_GLOBALS = [
    'Buffer',
    '__dirname',
    '__filename',
    'console',
    'global',
    'process',
    'require',
    'setImmediate',
    'setInterval',
    'setTimeout',
];

// Globals the WebWorker lib of tsconfig.core.json declares but a worker runtime does not provide
const BROWSER_GLOBALS = ['FileReaderSync', 'XMLHttpRequest', 'importScripts', 'indexedDB', 'location'];

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strict,
    eslintConfigPrettier,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-dynamic-delete': 'off',
        },
    },
    {
        files: ['src/lib/**/*.ts', 'src/manifest.ts', 'src/types/index.ts'],
        rules: {
            'no-restricted-imports': ['error', { paths: SERVER_MODULES, patterns: ['node:*'] }],
            'no-restricted-globals': ['error', ...SERVER_GLOBALS, ...BROWSER_GLOBALS],
        },
    },
    {
        files: ['scripts/**/*.mjs', 'test/**/*.mjs'],
        languageOptions: { globals: globals.node },
    },
    {
        ignores: ['dist/', 'node_modules/'],
    },
);
