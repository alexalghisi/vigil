import js from '@eslint/js';
import globals from 'globals';

const rules = {
    indent: ['error', 4, { SwitchCase: 1 }],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
    'no-console': 'error',
    'prefer-const': 'error',
    eqeqeq: 'error',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};

export default [
    js.configs.recommended,
    {
        ignores: ['public/**'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
        rules,
    },
    {
        files: ['public/**'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
        rules,
    },
];
