import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
    // Generated code is committed and typechecked, but never linted.
    globalIgnores(['src/generated/', 'dist/', 'coverage/']),
    js.configs.recommended,
    tseslint.configs.recommended
]);
