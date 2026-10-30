# Phase 0: Foundations and Decisions

Set up the repo, write down the decisions that shape everything else, and run a short spike on the generator so later phases build on tested assumptions.

## Goals

- A repo that builds, lints, typechecks, and runs vitest from day one.
- Decisions recorded as short decision records, so changing direction later is a conscious act.
- Evidence for the generator choice instead of a guess.
- Clear boundaries about what is being recreated and what is not.

## Deliverables

| Deliverable | Location |
|---|---|
| Repo skeleton | repo root |
| Decision records | `docs/decisions/NNNN-title.md` |
| Generator spike notes | `docs/decisions/0002-generator.md` |
| README stub with prerequisites | `README.md` |

## Target repo layout

```
.
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── openapitools.json          # Phase 2
├── specs/                     # input OpenAPI documents, one per service
├── templates/                 # optional generator template overrides (default is none, see Phase 2)
├── src/
│   ├── generated/             # generator output, never edited by hand
│   ├── client/                # facade, config, auth, safety (Phase 3)
│   ├── testing/               # vitest helpers and fixtures (Phase 4)
│   └── index.ts
├── scripts/                   # generate, check, sync-specs, release helpers
├── tests/
│   ├── unit/                  # tests of the library itself
│   └── integration/           # example integration tests against the Storefront services
├── examples/consumer/         # a project that installs the built package (Phase 5)
├── docs/
└── .github/workflows/
```

The demo backend is the Storefront backend project (see the backend roadmap), and it lives in its own repo. Its contract with this library is the three OpenAPI files, the stage manifest, and the API keys, which Phase 1 describes.

## Tasks

### 1. Repo skeleton

- [ ] Initialize with a current Node LTS and pin it (`.nvmrc` and `engines`).
- [ ] Pick one package manager and commit its lockfile.
- [ ] TypeScript with `strict: true`, ESM output, and `moduleResolution` suited to modern Node.
- [ ] Vitest installed and one trivial passing test.
- [ ] ESLint and a formatter, with generated code excluded from linting but included in typechecking.
- [ ] A `.gitignore` that does not ignore `src/generated/` (see decision on committed output below).

### 2. Decision records

Each record: context, options considered, decision, consequences. Keep them to a page.

| # | Decision | Default to start from | Written in |
|---|---|---|---|
| 0001 | Spec format | OpenAPI 3.0.3 (the version the backend uses), YAML on disk | Phase 0 |
| 0002 | Generator | No default. The spike decides among OpenAPI Generator (`typescript-fetch`, `typescript-axios`) and TypeScript-native generators, using the hard requirements in the spike task below | Phase 0 |
| 0003 | Generated code in git? | Commit it, with a CI drift check (reviewable diffs, no generator needed to consume) | Phase 0 |
| 0004 | Facade strategy | Runtime facade with mapped types over the generated API classes (Phase 3) | Phase 0 |
| 0005 | Auth model | Pluggable provider function, with a static API key in `x-api-key` as the default (what the Storefront backend uses). Stretch: automatic bearer token acquisition and refresh (Phase 3) | Phase 0 |
| 0006 | Publish target | npm or GitHub Packages | Phase 0, confirmed in Phase 5 |
| 0007 | Spec source | Sync the published specs and stage manifest from the Storefront backend with a script | Phase 0 |
| 0008 | Custom generator templates | None by default. Allowed only with a recorded reason, after generator options, the facade, transport hooks, and spec fixes were tried (decision rule in Phase 2) | Phase 0 |
| 0009 | Token source for the stretch goal | Mock OAuth2 server for tests (default). Which real identity provider to use, if any, is a backend decision, made after checking current cost (see Phase 3) | Only if the stretch goal is pursued |
| 0010 | Call shape | One request object per call (no positional parameters), a `{ status, headers, data }` response, and no throw on HTTP error statuses. Positional parameters were hard to read, and a new parameter early in a signature broke many tests. A 404 or 409 is an expected outcome in a negative test, not an exception (Phase 3) | Phase 0 |
| 0011 | Naming across services | Decided in Phase 2: the three specs share an error schema name and a `version` tag, which collide in generated code | Phase 2 |
| 0012 | Package version vs spec versions | Decided in Phase 5: independent semver, with spec versions listed in the changelog | Phase 5 |

### 3. Generator spike

Goal: choose the generator and generator options with evidence. Time-box to a day or two.

- [ ] Take a small throwaway spec with a few paths, a tag per group, an enum, a nullable field, a date-time, a paginated list, and a 4xx error response. If the backend's draft specs (v0.1.0) already exist, use them instead: they include an `apiKey` security scheme, a required header parameter (`Idempotency-Key`), and an error schema shared across services.
- [ ] Generate with OpenAPI Generator `typescript-fetch` and `typescript-axios`, using the same spec.
- [ ] Generate with at least one TypeScript-native generator for comparison. Candidates to look at: hey-api's openapi-ts, orval, openapi-typescript. They run on Node with no Java.
- [ ] Record for each candidate: output layout, call shape, how errors surface, how config and base URL are injected, how auth headers are injected, support for middleware or a custom fetch, handling of the spec features above, output size, regeneration determinism, and install friction.
- [ ] Check three hard requirements for every candidate. They come from decision record 0010 and the backend's specs. A candidate that needs hand edits to generated code to meet one is out:
  - A single request object per call is available, by option or by default, so there are no positional parameters.
  - The response status and headers are available without throwing on non-2xx statuses.
  - OpenAPI 3.0.3 is handled cleanly.
- [ ] Confirm the options that matter for the leading candidates and record the chosen values. For `typescript-fetch`, the documented options include `useSingleRequestParameter` (default true), `withInterfaces`, `supportsES6`, `importFileExtension` (set `.js` or `.mjs` for ES modules), `npmName`, `npmVersion`, and `withoutRuntimeChecks`. Check whether `typescript-axios` offers the same single-request-object option, and what its equivalents are for the rest.
- [ ] Write the decision. No generator is the default. Prefer the candidate that meets the hard requirements with the least facade code, and weigh output layout, error and auth hooks, determinism, and install friction (OpenAPI Generator needs Java, the TypeScript-native generators do not). Record the alternatives and why they lost.

### 4. Java requirement

This section applies only if the spike chooses OpenAPI Generator. It is a Java jar, and the npm wrapper downloads and runs it. The documented minimum is Java 11.

- [ ] Document the three ways to run it: local Java, the Docker image, and the wrapper's `useDocker` option in `openapitools.json`.
- [ ] Decide the default for contributors and for CI.
- [ ] Add a prerequisites section to the README with a one-line check (`java -version`).

## Acceptance criteria

- `npm test`, lint, and typecheck all pass on a fresh clone.
- Decision records 0001 to 0008 and 0010 exist, with the generator record backed by spike notes. Records 0009 (only if the stretch goal is pursued), 0011 (Phase 2) and 0012 (Phase 5) are written in their own phases.
- If OpenAPI Generator was chosen, anyone can tell from the README which Java or Docker option to use.

## Risks and notes

- **Silent drift from "faithful replica."** If the original used custom templates or a different call shape, note it in the decision record rather than guessing.
- **Spike sprawl.** Compare on one spec and stop. The goal is a decision, not a survey.
- **Java friction.** If Java setup becomes the main barrier for contributors, the Docker path should be the documented default.
