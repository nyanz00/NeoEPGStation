import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['client/**', 'dist/**', 'node_modules/**'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.es2021,
                ...globals.node,
            },
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-namespace': 'off',
            'no-constant-condition': 'off',
            'no-useless-escape': 'off',
            'no-async-promise-executor': 'off',
            'max-len': [
                'error',
                {
                    code: 180,
                    tabWidth: 4,
                    ignoreComments: true,
                    ignoreTrailingComments: true,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreRegExpLiterals: true,
                },
            ],
        },
    },
    eslintConfigPrettier,
);
