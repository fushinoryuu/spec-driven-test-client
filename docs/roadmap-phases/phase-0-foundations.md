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
| Clean-room rules | `docs/clean-room.md` |
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

### 2. Clean-room rules

Write `docs/clean-room.md` and follow it:

- [ ] Recreate behavior and design ideas only. No copied code, file names, package names, internal URLs, service names, or specs from work.
- [ ] All examples, specs, and test data are invented for the Storefront demo.
- [ ] Do not mention the employer or internal systems in code, commits, or docs.
- [ ] Check the employer's IP and outside-work policy before making the repo public.

### 3. Decision records

Each record: context, options considered, decision, consequences. Keep them to a page.

| # | Decision | Default to start from |
|---|---|---|
| 0001 | Spec format | OpenAPI 3.x, YAML on disk |
| 0002 | Generator | OpenAPI Generator, TypeScript fetch generator (see spike) |
| 0003 | Generated code in git? | Commit it, with a CI drift check (reviewable diffs, no generator needed to consume) |
| 0004 | Facade strategy | Runtime facade with mapped types over generated API classes (Phase 3) |
| 0005 | Auth model | Pluggable provider function, with a static API key in `x-api-key` as the default (what the Storefront backend uses). Stretch: automatic bearer token acquisition and refresh (Phase 3) |
| 0006 | Publish target | npm or GitHub Packages |
| 0007 | Spec source | Sync the published specs and stage manifest from the Storefront backend with a script |
| 0008 | Custom generator templates | None by default. Allowed only with a recorded reason, after generator options, the facade, transport hooks, and spec fixes were tried (decision rule in Phase 2) |
| 0009 | Token source for the stretch goal | Mock OAuth2 server for tests (default). Decide later whether to use a real identity provider, after checking current cost (see Phase 3) |

### 4. Generator spike

Goal: choose the generator and generator options with evidence. Time-box to a day or two.

- [ ] Take a small throwaway spec with a few paths, a tag per group, an enum, a nullable field, a date-time, a paginated list, and a 4xx error response. If the Storefront specs already exist, use them instead: they include an `apiKey` security scheme, a required header parameter (`Idempotency-Key`), and an error schema shared across services.
- [ ] Generate with OpenAPI Generator `typescript-fetch` and `typescript-axios`, using the same spec.
- [ ] Generate with at least one TypeScript-native generator for comparison. Candidates to look at: hey-api's openapi-ts, orval, openapi-typescript. They run on Node with no Java.
- [ ] Record for each candidate: output layout, call shape, how errors surface, how config and base URL are injected, how auth headers are injected, support for middleware or a custom fetch, handling of the spec features above, output size, regeneration determinism, and install friction.
- [ ] Confirm the `typescript-fetch` options that matter and record the chosen values. The generator's documented options include `useSingleRequestParameter` (default true), `withInterfaces`, `supportsES6`, `importFileExtension` (set `.js` or `.mjs` for ES modules), `npmName`, `npmVersion`, and `withoutRuntimeChecks`.
- [ ] Write the decision. The default is OpenAPI Generator, because it matches the original library and its Java-jar workflow. Change the default only if the spike shows a clear problem, and record why.

### 5. Java requirement

OpenAPI Generator is a Java jar. The npm wrapper downloads and runs it. The documented minimum is Java 11.

- [ ] Document the three ways to run it: local Java, the Docker image, and the wrapper's `useDocker` option in `openapitools.json`.
- [ ] Decide the default for contributors and for CI.
- [ ] Add a prerequisites section to the README with a one-line check (`java -version`).

## Acceptance criteria

- `npm test`, lint, and typecheck all pass on a fresh clone.
- Decision records 0001 to 0007 exist, with the generator record backed by spike notes.
- Clean-room rules are written and linked from the README.
- Anyone can tell from the README which Java or Docker option to use.

## Risks and notes

- **Silent drift from "faithful replica."** If the original used custom templates or a different call shape, note it in the decision record rather than guessing.
- **Spike sprawl.** Compare on one spec and stop. The goal is a decision, not a survey.
- **Java friction.** If Java setup becomes the main barrier for contributors, the Docker path should be the documented default.
