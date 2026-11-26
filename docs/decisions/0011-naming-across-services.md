# 0011: Naming across services

- Status: Accepted
- Date: 2026-11-25

## Context

Every Storefront spec shares names with the others. The ALP-12 review found, and ALP-17 rechecked against the generator output, that:

- `Problem` and `FieldError` are defined in all six specs.
- `Cursor`, `Limit` and `NextCursor` are in the three `v1` specs.
- The whole operational surface (`getHealth`, `getVersion`, the `operations` tag, and so the class `Operations`) is in the three `v0` specs.

Every copy is identical, so nothing is in conflict in meaning. The names still clash if two specs are generated into one folder, because each generated file declares the types and functions of one module. A second question rides on the same choice: hey-api copies its HTTP runtime (`client/` and `core/`) into every output folder.

## Options considered

1. **One folder per spec.** Each spec is generated into `src/generated/<spec file name without .yaml>/`, for example `src/generated/orders-service-v1/`. Nothing is renamed.
2. **One folder, with a name prefix per spec.** Every type and function would carry the service and version in its name. Every call in a test would carry the prefix too, and the prefix would have to be configured for each spec, so adding a spec would again need an edit.
3. **Fix the names at the source.** Ask the backend to give each service its own error schema and operation names. The shared `Problem` schema and the `v0` surface are what the backend and the library agreed on ([backend contract](../backend-contract.md)), and identical definitions are what makes a shared `expectStatus` possible, so this works against the contract.

## Decision

**Option 1.** One folder per spec, named after the spec file. The generator is told only the input and the output folder for each run ([0002](0002-generator.md)), so adding a spec is dropping in the file and running the generator. The version rules that go with the file names are in [0013](0013-api-versions.md).

### The repeated runtime

Each folder holds its own copy of the HTTP runtime: 1,694 non-blank lines in `client/` and `core/`, out of 1,845 to 2,511 lines per folder and 12,275 for the six specs. The six copies are byte-identical (checked with `diff -r`).

The generator can import the runtime from an npm package instead (`bundle: false` on the client plugin), and that was tried. It imports from `@hey-api/client-fetch`, which the registry marks deprecated since its version 0.73 ("this package is bundled directly inside `@hey-api/openapi-ts`"). A package that is no longer maintained would become a runtime dependency of the library and of every consumer, so it is rejected.

**The copies stay.** They are generated, so nobody edits them. They are excluded from lint and format and do not count toward the 500-line pull request limit ([0003](0003-generated-code-in-git.md)). The drift check covers them. A generator upgrade shows the same runtime diff six times, which is noisy but identical, and the reviewer reads one. Whether a pipeline test should assert that the copies stay identical is left to the generate-script ticket (ALP-18).

## Consequences

- **The facade can still import from the result.** All six folders typecheck under the repo's strict `NodeNext` settings with `lib: ["ES2023", "DOM"]`. A probe, written for this record and not committed, maps every exported class of a module (one class per tag: `Orders`, `Products`, `Operations`) to a group named by lower-casing its first letter, and nests the groups under the service and the version. It gives `apitest.ordersService.v1.orders.getOrder({ orderId })` and `apitest.ordersService.v0.operations.getVersion()` with full types, and these are compile errors, as they should be: `apitest.ordersService.v2` (no such version), `getOrder({})` (missing `orderId`), `apitest.ordersService.v0.operations.getOrder`, and an operation of another service.
- **The classes have no `Api` suffix.** The Phase 3 plan still says the facade takes the module keys that end in `Api`, which came from OpenAPI Generator. With hey-api the facade takes the exported classes. Phase 3 is corrected when its tickets are filed.
- **Types are shared by shape, not by name.** `Problem` in `orders-service-v1` and in `customers-service-v1` are separate types that are structurally identical, so one helper accepts either.
- **Without `"DOM"` in `lib`** each folder has two errors (`BodyInit` in `client/client.gen.ts`), 12 in all. `tsconfig.json` still gets `"DOM"` with the first committed client (ALP-18).
