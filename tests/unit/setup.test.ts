import { describe, expect, it } from 'vitest';
import * as library from '../../src/index.js';

describe('tooling', () => {
    it('runs vitest against the library entry point', () => {
        expect(library).toBeTypeOf('object');
    });
});
