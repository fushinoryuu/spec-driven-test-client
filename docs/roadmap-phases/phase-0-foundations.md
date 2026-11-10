# Phase 0: Foundations and Decisions

Set up the repo, write down the decisions that shape everything else, and run a short spike on the generator so later phases build on tested assumptions.

## Goals

- A repo that builds, lints, typechecks, and runs vitest from day one.
- Decisions recorded as short decision records, so changing direction later is a conscious act.
- Evidence for the generator choice instead of a guess.

## Deliverables

| Deliverable                    | Location                           |
| ------------------------------ | ---------------------------------- |
| Repo skeleton                  | repo root                          |
| Decision records               | `docs/decisions/NNNN-title.md`     |
| Generator spike notes          | `docs/decisions/0002-generator.md` |
| README stub with prerequisites | `README.md`                        |

## Target repo layout

```
.
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── openapitools.json          # Phase 2
├── specs.config.json          # which sibling repositories and spec files `copy-specs` copies (Phase 1)
├── specs/                     # input OpenAPI documents, one per service and API version
├── templates/                 # optional generator template overrides (default is none, see Phase 2)
├── src/
│   ├── generated/             # generator output, never edited by hand
│   ├── client/                # facade, config, auth, safety (Phase 3)
│   ├── testing/               # vitest helpers and fixtures (Phase 4)
│   └── index.ts
├── scripts/                   # generate, check, copy-specs, release helpers
├── tests/
│   ├── unit/                  # tests of the library itself
│   ├── examples/              # example suites that show each library feature, run against the stub service (Phase 4)
│   ├── stub/                  # a small in-process service with versioned fixture specs, for the example suites
│   └── fixtures/specs/        # fixture specs used by the pipeline tests and the stub
├── mock/                      # spec-driven mocks of the Storefront specs (Phase 1)
├── examples/consumer/         # a project that installs the built package (Phase 5)
├── spikes/                    # throwaway comparisons behind decision records (the generator spike)
├── docs/
└── .github/workflows/
```

The demo backend is the Storefront backend project (see the backend roadmap), and it lives in its own repo. Its contract with this library is its versioned OpenAPI files, the stage manifest, the API keys and the feature flag source, which Phase 1 describes.

**What lives where.** This repository holds the library and tests of the library itself: unit tests, pipeline tests, and example suites that run against a small in-process stub service, with no cloud and no secrets. The tests of the Storefront services live in the backend project, like the tests of any real service, and consume the published package. The example consumer (Phase 5) is the template for that setup. The library never runs write tests against a Storefront stage.

## Tasks

### 1. Repo skeleton

- [x] Initialize with a current Node LTS and pin it (`.nvmrc` and `engines`).
- [x] Pick one package manager and commit its lockfile.
- [x] TypeScript with `strict: true`, ESM output, and `moduleResolution` suited to modern Node.
- [x] Vitest installed and one trivial passing test.
- [x] ESLint and a formatter, with generated code excluded from linting but included in typechecking.
- [x] A `.gitignore` that does not ignore `src/generated/` (see decision on committed output below).

### 2. Decision records

Each record: context, options considered, decision, consequences. Keep them to a page.

| #    | Decision                          | Default to start from                                                                                                                                                                                                                                                                                                                                                                                                                        | Written in                          |
| ---- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 0001 | Spec format                       | OpenAPI 3.0.3 (the version the backend uses), YAML on disk                                                                                                                                                                                                                                                                                                                                                                                   | Phase 0                             |
| 0002 | Generator                         | No default. The spike decides among OpenAPI Generator (`typescript-fetch`, `typescript-axios`) and TypeScript-native generators, using the hard requirements in the spike task below                                                                                                                                                                                                                                                         | Phase 0                             |
| 0003 | Generated code in git?            | Commit it, with a CI drift check (reviewable diffs, no generator needed to consume)                                                                                                                                                                                                                                                                                                                                                          | Phase 0                             |
| 0004 | Facade strategy                   | Runtime facade with mapped types over the generated API classes (Phase 3)                                                                                                                                                                                                                                                                                                                                                                    | Phase 0                             |
| 0005 | Auth model                        | Pluggable provider function, with a static API key in `x-api-key` as the default (what the Storefront backend uses). Stretch: automatic bearer token acquisition and refresh (Phase 3)                                                                                                                                                                                                                                                       | Phase 0                             |
| 0006 | Publish target                    | npm or GitHub Packages                                                                                                                                                                                                                                                                                                                                                                                                                       | Phase 0, confirmed in Phase 3       |
| 0007 | Spec source                       | Copy the specs from a local checkout of each service repository with `npm run copy-specs`                                                                                                                                                                                                                                                                                                                                                    | Phase 0                             |
| 0008 | Custom generator templates        | None by default. Allowed only with a recorded reason, after generator options, the facade, transport hooks, and spec fixes were tried (decision rule in Phase 2)                                                                                                                                                                                                                                                                             | Phase 0                             |
| 0009 | Token source for the stretch goal | Mock OAuth2 server for tests (default). Which real identity provider to use, if any, is a backend decision, made after checking current cost (see Phase 3)                                                                                                                                                                                                                                                                                   | Only if the stretch goal is pursued |
| 0010 | Call shape                        | One request object per call (no positional parameters), a `{ status, headers, data }` response, and no throw on HTTP error statuses. Positional parameters were hard to read, and a new parameter early in a signature broke many tests. A 404 or 409 is an expected outcome in a negative test, not an exception (Phase 3)                                                                                                                  | Phase 0                             |
| 0011 | Naming across services            | Decided in Phase 2: the three services share an error schema name (`Problem`) and an `operations` tag, which collide in generated code unless each spec is generated into its own folder                                                                                                                                                                                                                                                     | Phase 2                             |
| 0012 | Package version vs spec versions  | Decided in Phase 5: independent semver, with spec versions listed in the changelog                                                                                                                                                                                                                                                                                                                                                           | Phase 5                             |
| 0013 | API versions of one service       | Decided in Phase 2, built into the facade in Phase 3: every Storefront spec is `<service>-service-v<N>.yaml`, generated into its own folder, and the facade adds a version segment (`apitest.ordersService.v1.orders.getOrder`). `v0` is the reserved operational spec. Different from a spec's `info.version` and from the package version. The version check compares each `specVersions` entry with the spec whose suffix matches the key | Phase 2                             |
| 0014 | Feature flags in tests            | Decided in Phase 3: a pluggable, read-only flag provider (a static per-environment map as the default, and a LaunchDarkly REST provider for the Storefront), flags resolved once per run, and helpers that skip a test with a stated reason. Skips are reported. Tests never write flags                                                                                                                                                     | Phase 3                             |

### 3. Generator spike

Goal: choose the generator and generator options with evidence. Time-box to a day or two.

- [x] Take a small throwaway spec with a few paths, a tag per group, an enum, a nullable field, a date-time, a paginated list, and a 4xx error response. If the backend's draft specs (v0.1.0) already exist, use them instead: they include an `apiKey` security scheme, a required header parameter (`Idempotency-Key`), and an error schema shared across services.
- [x] Generate with OpenAPI Generator `typescript-fetch` and `typescript-axios`, using the same spec.
- [x] Generate with at least one TypeScript-native generator for comparison. Candidates to look at: hey-api's openapi-ts, orval, openapi-typescript. They run on Node with no Java.
- [x] Record for each candidate: output layout, call shape, how errors surface, how config and base URL are injected, how auth headers are injected, support for middleware or a custom fetch, handling of the spec features above, output size, regeneration determinism, and install friction.
- [x] Check three hard requirements for every candidate. They come from decision record 0010 and the backend's specs. A candidate that needs hand edits to generated code to meet one is out:
    - A single request object per call is available, by option or by default, so there are no positional parameters.
    - The response status and headers are available without throwing on non-2xx statuses.
    - OpenAPI 3.0.3 is handled cleanly.
- [x] Confirm the options that matter for the leading candidates and record the chosen values. For `typescript-fetch`, the documented options include `useSingleRequestParameter` (default true), `withInterfaces`, `supportsES6`, `importFileExtension` (set `.js` or `.mjs` for ES modules), `npmName`, `npmVersion`, and `withoutRuntimeChecks`. Check whether `typescript-axios` offers the same single-request-object option, and what its equivalents are for the rest.
- [x] Write the decision. No generator is the default. Prefer the candidate that meets the hard requirements with the least facade code, and weigh output layout, error and auth hooks, determinism, and install friction (OpenAPI Generator needs Java, the TypeScript-native generators do not). Record the alternatives and why they lost.

### 4. Java requirement

This section applied only if the spike chose OpenAPI Generator, which is a Java jar. The spike chose hey-api, which needs no Java (decision record 0002), so the section does not apply and its items are dropped.

- [ ] ~~Document the three ways to run it: local Java, the Docker image, and the wrapper's `useDocker` option in `openapitools.json`.~~
- [ ] ~~Decide the default for contributors and for CI.~~
- [ ] ~~Add a prerequisites section to the README with a one-line check (`java -version`).~~

## Acceptance criteria

- `npm test`, lint, and typecheck all pass on a fresh clone.
- Decision records 0001 to 0008 and 0010 exist, with the generator record backed by spike notes. Records 0009 (only if the stretch goal is pursued), 0011 and 0013 (Phase 2), 0014 (Phase 3) and 0012 (Phase 5) are written in their own phases.
- If OpenAPI Generator was chosen, anyone can tell from the README which Java or Docker option to use.

## Risks and notes

- **Unrecorded assumptions.** If a choice depends on something not yet verified, such as a generator option or a backend behavior, say so in the decision record instead of guessing.
- **Spike sprawl.** Compare on one spec and stop. The goal is a decision, not a survey.
- **Java friction.** If Java setup becomes the main barrier for contributors, the Docker path should be the documented default.
