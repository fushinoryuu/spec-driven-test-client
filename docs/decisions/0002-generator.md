# 0002: Generator

- Status: Accepted
- Date: 2026-10-30

## Context

The library turns each service's OpenAPI spec into a typed client ([0001](0001-spec-format.md)). The generator decides the shape of everything above it: the facade ([0004](0004-facade-strategy.md)), the call shape ([0010](0010-call-shape.md)) and whether contributors need Java. No generator was the default. This record is the result of a spike that generated a client from one spec with five candidates and measured each.

## Options considered

1. **OpenAPI Generator `typescript-fetch`.** Java jar, run through the `@openapitools/openapi-generator-cli` npm wrapper.
2. **OpenAPI Generator `typescript-axios`.** Same tool, axios as the transport.
3. **hey-api `openapi-ts`** with its fetch client and the SDK plugin. Runs on Node.
4. **orval** with its fetch client. Runs on Node.
5. **openapi-typescript + openapi-fetch.** Runs on Node. It generates types only, and a small runtime package makes the calls.

## Decision

**hey-api `openapi-ts` (option 3)**, pinned to an exact version, with the fetch client and the SDK plugin grouped by tag and with flat parameters.

It meets the three hard requirements without a custom wrapper beyond reshaping the result, it needs no Java, it types the error body per status code, and its output is one class per tag, which is the shape the facade ([0004](0004-facade-strategy.md)) maps over. The runner-up is OpenAPI Generator `typescript-fetch`. It passes the same requirements, but it throws on non-2xx statuses (so the wrapper is a try/catch), it does not type error bodies, and it needs Java in CI and for every contributor.

hey-api is at 0.x and its configuration has changed between minor versions. That is the main risk, and the mitigation is to pin an exact version and upgrade in a separate PR with the drift check ([0003](0003-generated-code-in-git.md)).

### Chosen options

```js
// openapi-ts.config.mjs (the spike's copy lives in spikes/generator/)
export default {
  input: 'specs/<service>.yaml',
  output: { path: 'src/generated/<service>', module: { extension: '.js' } },
  plugins: ['@hey-api/typescript', { name: '@hey-api/sdk', operations: { strategy: 'byTags' }, paramsStructure: 'flat' }, '@hey-api/client-fetch']
};
```

| Option | Value | Why |
|---|---|---|
| `operations.strategy` | `byTags` | One class per spec tag (`Orders`, `Version`), so the facade groups by tag. |
| `paramsStructure` | `flat` | One request object whose fields are the path, query and header parameters and the body, for example `getOrder({ orderId })`. The default (`grouped`) nests them as `{ path, query, headers, body }`. |
| `module.extension` | `.js` | Generated relative imports carry the extension that `NodeNext` requires. |
| `throwOnError` | left at its default (`false`) | A non-2xx status returns `{ error, response }` instead of throwing, which is what [0010](0010-call-shape.md) needs. |

Other generated shapes worth knowing about:

- The request object is the first argument, and transport options (the `client` instance, headers, signal) are an optional second argument. An operation with no parameters takes the options as its only argument. The facade hides both.
- Header parameters keep their wire name as the field name (`'Idempotency-Key'`). The request body is a field named after its schema (`createOrderRequest`). That matches the target experience in the roadmap.
- Operations are static methods and use a module-level default client. The facade passes its own `client` per call, so each service and environment gets its own base URL and key.
- The API key comes from the spec's security scheme: each operation declares it, and the client's `auth` option supplies the value.
- hey-api copies its HTTP runtime (`client/` and `core/`, about 1,600 lines) into every output folder. Three services mean three copies, which is the same as OpenAPI Generator's `runtime.ts`. The drift check covers them.

## Spike notes

The spike lives in [spikes/generator/](../../spikes/generator/), and the throwaway spec is [tests/fixtures/specs/generator-spike.yaml](../../tests/fixtures/specs/generator-spike.yaml). The spec has two tags, an enum, a nullable field, `date-time` fields, a cursor-paginated list, a shared 4xx error schema, an `apiKey` security scheme, a required `Idempotency-Key` header and a `Location` response header. The Storefront draft specs do not exist yet, so the spec is shaped like them. Rerun with `npm run spike` in that folder (it needs Java for the two OpenAPI Generator candidates, and skips them if Java is missing). Every candidate runs against a small mock server with the same eight scenarios: success, the API key and required header, query parameters, `date-time` and nullable values, 404, 409, a non-JSON 502 body, and 204.

Versions used: OpenAPI Generator 7.26.0 (wrapper 2.42.0, Temurin JDK 21.0.13), hey-api `openapi-ts` 0.99.0, orval 8.46.0, openapi-typescript 7.13.0 with openapi-fetch 0.17.0, axios 1.21.0, TypeScript 6.0.3, Node 24.22.2, Windows 11.

### Hard requirements

| Candidate | One request object | Status and headers without throwing | OpenAPI 3.0.3 | Result |
|---|---|---|---|---|
| OpenAPI Generator `typescript-fetch` | Pass. `useSingleRequestParameter` (on by default). | Pass, with a wrapper. The `*Raw` methods return `.raw`, but a non-2xx status throws `ResponseError`, which carries the `Response`. The wrapper catches it once for all operations. | Pass | In |
| OpenAPI Generator `typescript-axios` | Pass. `useSingleRequestParameter=true` (off by default). | Pass. `validateStatus: () => true` on the axios instance, so nothing throws. | Pass | In |
| hey-api `openapi-ts` | Pass. `paramsStructure: 'flat'` (the default `grouped` is also one object). | Pass. Native: `{ data, error, request, response }`, with `throwOnError` off by default. | Pass | **Chosen** |
| orval | **Fail.** Positional parameters. `override.useNamedParameters` only names the path parameters. The required `Idempotency-Key` header is not in any signature. | **Fail.** It returns `{ data, status, headers }`, but it calls `JSON.parse` on every body, so a non-JSON error body (a gateway 502) throws a `SyntaxError`. | Pass | Out |
| openapi-typescript + openapi-fetch | Pass. A `params` object. | Pass. `{ data, error, response }`. | Pass | In on the requirements, but loses on facade code (below) |

All five candidates read the spec without warnings (OpenAPI Generator's `validate` reports no issues), turned `nullable: true` into `T | null`, and returned `null` values intact at run time.

### Comparison

| | OpenAPI Generator `typescript-fetch` | OpenAPI Generator `typescript-axios` | hey-api `openapi-ts` | orval | openapi-typescript + openapi-fetch |
|---|---|---|---|---|---|
| Output layout | `apis/<Tag>Api.ts`, `models/*.ts`, `runtime.ts` (14 files) | `api.ts`, `base.ts`, `common.ts`, `configuration.ts` (5 files, models and APIs in `api.ts`) | `sdk.gen.ts`, `types.gen.ts`, `client/`, `core/` (16 files) | One folder per tag, `model/*.ts`, no runtime (20 files) | One `schema.ts` of types (1 file), runtime is the `openapi-fetch` package |
| Grouping | Class per tag: `OrdersApi` | Class per tag: `OrdersApi` | Class per tag: `Orders` (with `byTags`) | Module per tag, plain functions | None. Calls are keyed by method and path, not by `operationId` or tag. |
| Call shape | `api.getOrder({ orderId })` | `api.getOrder({ orderId })` | `Orders.getOrder({ orderId }, { client })` | `getOrder({ orderId }, options)` (positional) | `client.GET('/orders/{orderId}', { params: { path: { orderId } } })` |
| Errors | Throws `ResponseError` on non-2xx. The body is a raw `Response`, not typed. | `validateStatus` makes it return. `data` is typed as the success model only. | Returns `error`, typed per status code (`GetOrderErrors`: `403`, `404`). | Returns, with a union per status, but crashes on a non-JSON body. | Returns `error`, typed per status. |
| Config and base URL | `new Configuration({ basePath, apiKey, fetchApi, middleware, headers })` | `new Configuration({ apiKey })`, plus base path and axios instance in the constructor | `createClient(createConfig({ baseUrl, auth, fetch }))`, passed per call | URLs are relative. A custom mutator is needed to set a base URL. | `createClient({ baseUrl, headers, fetch })` |
| Auth header | From the spec's `apiKey` scheme: `Configuration.apiKey` (string or function) | Same, `Configuration.apiKey` | From the spec's scheme: `auth` on the client | Not generated. Set in request options. | Not generated. Set in `headers` or middleware. |
| Middleware or custom fetch | `middleware` (pre, post, onError) and `fetchApi` | axios interceptors and instance | `interceptors` (request, response, error) and `fetch` | Custom mutator | `use(middleware)` and `fetch` |
| `date-time` | **`Date`** (converted in `FromJSON`) | `string` | `string` | `string` | `string` |
| Required header parameter | Field `idempotencyKey` | Field `idempotencyKey` | Field `'Idempotency-Key'` | **Dropped** | `params.header` |
| Generated TypeScript (non-blank lines, KiB) | 1,402 lines, 48 KiB | 787 lines, 33 KiB | 1,977 lines, 62 KiB | 467 lines, 14 KiB | 294 lines, 8 KiB |
| Runtime dependencies | None (global `fetch`) | `axios` | None (runtime is generated into the output) | None | `openapi-fetch` |
| Deterministic (two clean runs, identical hashes) | Yes | Yes | Yes | Yes | Yes |
| Generate time | 2.5 s | 2.6 s | 1.1 s | 1.1 s | 1.0 s |
| Type check, `NodeNext`, `lib: ES2023` | 6 errors | 0 | 2 errors | 3 errors | 0 |
| Type check, `NodeNext`, `lib: ES2023, DOM` | 0 | 0 | 0 | 2 errors | 0 |
| Mock server scenarios passed | 8 of 8 | 8 of 8 | 8 of 8 | 7 of 8 (non-JSON 502 crashes) | 8 of 8 |
| Facade code needed per candidate | A try/catch wrapper and a body parser (about 15 lines) | A one-line mapping | A one-line mapping | Positional-to-object mapping per operation | A routing table from `operationId` to method and path, which nothing generates |
| Name collisions seen | `Error` schema becomes `ModelError` | `ModelError` | Type is `Error` (shadows the global in that module) | `Error` | `components['schemas']['Error']` |
| Install friction | Needs Java 11+ (the jar is 34 MiB and downloads on first run, about 8 s). A JDK is a 200 MiB download on a machine without one. | Same | `npm install` only | `npm install` only | `npm install`. openapi-typescript declares a peer dependency on TypeScript 5, so it needs `legacy-peer-deps` with 6.0. |

### Why the others lost

- **`typescript-fetch`** is the runner-up. It meets the requirements and `useSingleRequestParameter` is on by default, but it throws on every non-2xx status, so the wrapper is a try/catch on every call, and the error body arrives as an untyped `Response`. It also requires Java for every contributor and for CI (about 8 s on first run to fetch the jar, and a JDK install). Its date conversion to `Date` is the one place it is nicer than the winner.
- **`typescript-axios`** is easy to wrap with `validateStatus`, but it types `data` as the success model only, so error bodies are untyped, and it adds `axios` as a runtime dependency on top of the Java requirement.
- **orval** fails two hard requirements ([0010](0010-call-shape.md)): positional parameters, and a crash on non-JSON error bodies. It also drops the required `Idempotency-Key` header parameter, and its generated imports have no `.js` extension in two files, which `NodeNext` rejects.
- **openapi-typescript + openapi-fetch** passes the requirements and is the smallest, but it has no `operationId` methods and no tag grouping. The facade would need a table from operation to method and path that nothing generates, which is a second generator to keep in sync. It also ignores the spec's security scheme, so the API key is set by hand.

## Consequences

- **`NodeNext` works with the chosen generator.** `module.extension: '.js'` makes hey-api emit `.js` on every relative import, and the output typechecks under the repo's `NodeNext` settings. No change to `tsconfig.json` module settings is needed.
- **`tsconfig.json` needs `"DOM"` in `lib`** when the generated code is added in Phase 2. The root `lib` is `["ES2023"]`, and hey-api's client refers to `BodyInit`, which `@types/node` does not declare (two errors without it, none with it). Add `"DOM"` in the same PR that commits the first generated client.
- **No Java anywhere.** No Java requirement goes in the README, CI needs nothing beyond Node, and Phase 0 task 4 (the Java requirement) does not apply.
- **Facade mapping works.** `spikes/generator/probes/facade-types.ts` maps the generated classes to the call shape of [0010](0010-call-shape.md) with mapped types and typechecks, including `@ts-expect-error` cases for a missing required field, an unknown operation, a missing required header and an argument passed to an operation with no parameters. The facade passes its `client` as the second argument and sets nothing per endpoint. Operations with no parameters take the options as their only argument, so the mapped type has to tell the two cases apart.
- **The wrapper is small.** The adapter that reshapes `{ data, error, response }` into `{ status, headers, data }` is about five lines. `response` is typed as optional on the result, so the wrapper narrows it. Error bodies are typed per status code, so `expectStatus` ([0010](0010-call-shape.md)) can narrow beyond the shared error schema later if it is useful. API Gateway's own non-JSON responses still arrive as text, and the spike confirms hey-api returns them as a string instead of throwing.
- **Pin an exact version and upgrade deliberately.** hey-api is at 0.99 and changes its configuration between minor versions (`byTags` is not `byTag`, and `importFileExtension` is now `module.extension`). Phase 2 pins an exact version and adds a Dependabot ignore for its minor updates, so an upgrade is always a deliberate PR.
- **Audit findings.** On 2026-10-30, `npm audit` reports a high-severity `js-yaml` denial-of-service advisory in hey-api's spec parser, and another through OpenAPI Generator's proxy-agent chain. Both are tools that only read this project's own specs, so the exposure is low, but Dependabot alerts would open for it. In the spike, `"overrides": { "js-yaml": "^4.3.2" }` clears hey-api's finding and generation still works. Phase 2 applies the same override if the alert is still open then.
- **Templates.** hey-api has no Mustache templates. Its customization is plugins, and [0008](0008-custom-generator-templates.md) applies to them in the same way: the decision rule applies before any custom plugin, and the default is none.
- **Phase 2 is rewritten.** [Phase 2](../roadmap-phases/phase-2-generation-pipeline.md) was written for OpenAPI Generator (`openapitools.json`, a Java jar, Mustache templates). Its tasks are rewritten around `openapi-ts.config.mjs` when the Phase 2 tickets are filed.
- **Naming collisions across services** are still decision record 0011 (Phase 2). The spike shows the starting point: the shared `Error` schema is emitted as a type named `Error` in every service folder, so each service's generated types live in their own folder and the facade imports them by service.
