import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
    // Generated code is committed and typechecked, but never linted. `.generate-*/` are the work folders of scripts/generate.ts (and of its tests), left behind only by a killed run.
    globalIgnores(['src/generated/', '.generate-*/', 'dist/', 'coverage/', 'spikes/*/out/']),
    js.configs.recommended,
    tseslint.configs.recommended
]);
