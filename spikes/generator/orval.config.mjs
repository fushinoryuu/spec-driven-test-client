export default {
    spike: {
        input: '../../tests/fixtures/specs/generator-spike.yaml',
        output: {
            target: 'out/orval/api.ts',
            schemas: 'out/orval/model',
            client: 'fetch',
            mode: 'tags-split',
            override: { useNamedParameters: true }
        }
    }
};
