export default {
    input: '../../tests/fixtures/specs/generator-spike.yaml',
    output: { path: 'out/heyapi', module: { extension: '.js' } },
    plugins: ['@hey-api/typescript', { name: '@hey-api/sdk', operations: { strategy: 'byTags' }, paramsStructure: 'flat' }, '@hey-api/client-fetch']
};
