# Phase 2: Generation Pipeline

The core selling point: a repeatable, one-command path from OpenAPI specs to typed clients. When this phase is done, adding or updating a service means changing a spec file and running one script.

The generator is hey-api `openapi-ts`, chosen by the Phase 0 spike ([0002](../decisions/0002-generator.md)). It runs on Node, so the pipeline needs no Java, no jar and no template files.

## Goals

- One command regenerates every service client from the specs.
- The generator version is pinned, so output is the same on every machine.
- Stale or hand-edited generated code is caught automatically.
- Adding a service or an API version needs no changes to generation scripts.

## Deliverables

| Deliverable                                       | Location                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generator configuration (the shared options)      | `openapi-ts.config.mjs`                                                                                                                                                                                                                                |
| Generator version                                 | `@hey-api/openapi-ts`, an exact version in `package.json`                                                                                                                                                                                              |
| Decision records                                  | [0002](../decisions/0002-generator.md) (generator), [0008](../decisions/0008-custom-generator-templates.md) (no custom plugin), [0011](../decisions/0011-naming-across-services.md) (naming), [0013](../decisions/0013-api-versions.md) (API versions) |
| Generation script                                 | `scripts/generate.ts`                                                                                                                                                                                                                                  |
| Drift check script                                | `scripts/check-generated.ts`                                                                                                                                                                                                                           |
| Generated clients                                 | `src/generated/<service>-service-v<N>/`                                                                                                                                                                                                                |
| Fixture specs (a `widgets` service, `v0` to `v2`) | `tests/fixtures/specs/`                                                                                                                                                                                                                                |
| Pipeline unit tests                               | `tests/unit/pipeline/`                                                                                                                                                                                                                                 |
| Pipeline doc with a diagram                       | `docs/generation-pipeline.md`                                                                                                                                                                                                                          |

## How it works

```
specs/<service>-service-v<N>.yaml
        |
   parse and check the spec     (hey-api's own parse, plus a duplicate operationId check)
        |
   openapi-ts                   (exact version in package.json, shared options in openapi-ts.config.mjs, one run per spec)
        |
   src/generated/<service>-service-v<N>/    (generator output, never hand-edited)
        |
   typecheck
```

`openapi-ts.config.mjs` holds only the options that every spec shares: the plugins and the `.js` import extension. The input and the output folder are given on each run, so adding a spec needs no edit:

```
npx openapi-ts -i ./specs/orders-service-v1.yaml -o src/generated/orders-service-v1
```

Three details found while setting this up ([0002](../decisions/0002-generator.md#phase-2-setup-alp-17)):

- The input must start with `./` or be absolute. A bare `specs/x.yaml` is read as a Hey API project shorthand and fails.
- Both the command line and a programmatic call find `openapi-ts.config.mjs` in the working directory and merge it with what the run gives. That is why the file lists no inputs: a list would turn every run into one job per spec.
- Every generated file starts with `// This file is auto-generated by @hey-api/openapi-ts`, so nothing has to be prepended.

## Tasks

### 1. Install and pin

- [x] Add `@hey-api/openapi-ts` as a dev dependency at an exact version (no range). Pin to the current release when you upgrade.
- [x] Add a Dependabot ignore for its minor updates, and keep its patch updates out of the weekly group, so every upgrade is its own pull request.
- [x] Apply the `js-yaml` override while its audit alert is open, and run `npm audit`.
- [x] No Java, Docker or jar needs documenting: the generator is an npm package.

### 2. Configure the generator

- [x] One configuration for every spec, with the input and the output folder given on each run (see above).
- [x] Set the plugin options from the Phase 0 spike (`@hey-api/typescript`, `@hey-api/sdk` with `operations.strategy: 'byTags'` and `paramsStructure: 'flat'`, which decision record 0010 needs, and `@hey-api/client-fetch`) and the `.js` import extension that `NodeNext` requires.
- [x] Decide the two open options and record them in 0002: enums stay string unions, and `date-time` fields stay strings.
- [x] Check how the generator handles the Storefront specs' `apiKey` security scheme and the required `Idempotency-Key` header on `createOrder`. The key comes from the spec's scheme, and the header is a required request field (0002).
- [ ] For the Phase 3 stretch goal, check what the generator produces for a bearer (`http`) security scheme in a small test spec.

### 3. The generate script

`npm run generate` should do these steps in order and stop at the first failure:

- [x] **List** the files in `specs/`, and give each one its input and its folder, `src/generated/<file name without .yaml>/`.
- [x] **Check** each spec. hey-api has no `validate` command: its parse stops on malformed YAML or a missing `$ref`, and the script fails on any warning or error it prints. It does not report a duplicate `operationId`, so the script checks for that itself.
- [x] **Clean** each spec's output folder first, so deleted operations disappear instead of leaving stale files. The script replaces the folder as a whole, after everything has passed.
- [x] **Generate** with the pinned version, and fail if hey-api exits with an error.
- [x] **Typecheck** the generated code so a broken generation fails here, not later in someone's test. It runs before the new code replaces the old. Added `"DOM"` to `lib` in `tsconfig.json` in the same pull request as the first committed client.
- [x] Print a short summary: specs generated, operations per spec, generator version.

There is no formatter step: generated code is excluded from lint and format ([0003](../decisions/0003-generated-code-in-git.md)).

`npm run generate -- --service orders-service-v1` generates a single spec.

### 4. The drift check

`npm run generate:check` regenerates into a temporary folder and compares with the committed output.

- [ ] Fails with a clear diff summary when committed output is stale or hand-edited.
- [ ] Uses the same generator version and options as `generate`, so a changed version or option shows up as drift.
- [ ] Is used by CI (Phase 5) and as a pre-push hook if wanted.
- [ ] Ignores harmless differences such as line endings.

### 5. Multi-service support

- [x] Generate all the Storefront specs (a `v0` and a `v1` for customers, orders and shipping) and confirm that adding a service or a version requires only dropping its spec into `specs/` and rerunning `generate`. Name spec files `<service>-service-v<N>.yaml` (for example `orders-service-v1.yaml`). The file name gives the facade name (`ordersService`) and the version segment (`v1`).
- [x] Check that the specs do not collide on model or class names. All of them share an error schema (`Problem`), every service has an `operations` tag, and the three `v0` specs have the same operationIds. Each spec is generated into its own folder, which avoids every clash and which the facade can import from. Recorded in [0011](../decisions/0011-naming-across-services.md).
- [x] Write the API version rules in [0013](../decisions/0013-api-versions.md): a spec file `<service>-service-v<N>.yaml` is version `v<N>` of the service, generated into its own folder. `v0` is the reserved operational spec, and nothing is special-cased for it. The version comes from the file suffix, never from `info.version`. A file with no suffix is a service without versions (fixtures only). An API version is not the spec's `info.version` and not the package version.
- [ ] Prove the rules with fixture specs under `tests/fixtures/specs/` (a small `widgets` service with `v0`, `v1` and `v2`) before the Storefront has a `v2`. Phase 3 adds the version segment to the facade.

### 6. Pipeline tests

- [x] **Determinism:** run generation twice, assert identical output.
- [x] **Compiles:** the generated code passes `tsc` under the repo's strict settings.
- [x] **Surface check:** for each Storefront spec, assert that the expected operations exist (for example `getVersion` on the three `v0` specs, plus `createCustomer`, `createOrder` and `getShipment` on the `v1` specs) by importing the generated module.
- [x] **Removal:** remove an operation from a copy of the spec and assert it disappears from the output.
- [x] **Invalid spec:** a malformed spec, a missing `$ref` and a duplicate `operationId` each fail with a useful error and do not touch existing output.
- [ ] **API versions:** generate the two versioned fixture specs side by side, assert that each version lands in its own folder with no name collisions, that an operation present only in `v2` is absent from `v1`, and that `generate:check` covers both.
- [x] **Runtime copies:** assert that `client/` and `core/` are identical in every folder (0011). This was optional.
- [x] Keep these fast by using tiny specs under `tests/fixtures/specs/`.

### 7. Custom plugins (optional, default is none)

hey-api has plugins and no templates. The default decision for this project is **no custom plugin**, and [0008](../decisions/0008-custom-generator-templates.md) holds the decision rule. Work down it and stop at the first step that solves the problem:

1. **Generator options**: the plugin options in `openapi-ts.config.mjs`.
2. **The facade** (Phase 3): call shape, grouping and ergonomics.
3. **Transport hooks** (Phase 3): headers, auth, logging, retries, timeouts and error wrapping.
4. **The spec** (in the backend project): names, tags, `operationId` values and schema shapes are often better fixed at the source.
5. **A custom plugin**, only when the change must apply inside every generated file or class and none of the above can do it.

Do not use a plugin for things the facade can do, for one-off tweaks, or as a substitute for post-processing. If one is ever justified:

- [ ] Record in 0008 what was tried at steps 1 to 4 and why it was not enough.
- [ ] Keep it small, with a comment saying what it changes, why, and which generator version it was written for.
- [ ] Add a pipeline test that asserts the behavior it creates. The drift check covers the rest.

**Upgrade procedure** (document it in `docs/generation-pipeline.md`): change the pinned version in `package.json`, rerun `generate`, and review the generated diff in its own pull request. A new generator version changes the output, and at 0.x it can change its configuration too, so Dependabot does not propose minor updates.

## Acceptance criteria

- `npm run generate` produces typed clients for every Storefront spec (a `v0` and a `v1` for each of the three services), with no manual steps and no name collisions.
- Two fixture specs for one service (`-v1` and `-v2`) generate side by side with no name collisions.
- `npm run generate:check` passes on a clean tree and fails after editing a generated file.
- Pipeline tests pass in CI.
- Upgrading the generator version is a one-line change plus a regenerate, and the diff is reviewable.

## Risks and notes

- **Generator upgrades change output.** hey-api is at 0.x and has changed its configuration between minor versions. A pinned version avoids surprise diffs. Upgrade deliberately, in its own PR, and read the diff.
- **The runtime is copied into every folder.** Each spec's folder carries about 1,700 lines of hey-api runtime, identical in all of them (12,275 lines for the six Storefront specs in all). The copies are excluded from lint and format and do not count toward the pull request size limit, and the drift check covers them. Importing the runtime from an npm package is not an option ([0011](../decisions/0011-naming-across-services.md)).
- **Problems hey-api does not report.** A duplicate `operationId` generates without a warning, so the script checks for it. The backend lints its own specs, but the library does not rely on that.
- **Hand edits creep in.** The drift check and the "generated" header exist to stop this. Treat any need to edit generated code as a signal to change generator options, the facade, or (as a last resort) a custom plugin instead.
