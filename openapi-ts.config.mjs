// The options every spec is generated with (decision record 0002). The input and the output folder are not here:
// each run gives them, so adding a spec needs no edit to this file.
//
//   npx openapi-ts -i ./specs/orders-service-v1.yaml -o <folder>
//
// The input must start with `./` or be absolute, or hey-api reads it as a Hey API project shorthand.
export default {
    output: { module: { extension: '.js' } },
    plugins: ['@hey-api/typescript', { name: '@hey-api/sdk', operations: { strategy: 'byTags' }, paramsStructure: 'flat' }, '@hey-api/client-fetch']
};
