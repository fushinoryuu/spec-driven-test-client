import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
            reportsDirectory: 'coverage'
        }
    }
});
