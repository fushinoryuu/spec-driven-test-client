# spec-driven-test-client

Generates typed clients for backend services from their OpenAPI specs, so integration tests can call `apitest.service.version.group.operation(request)` and get autocomplete and compile-time checks. The workflow is: change the spec, regenerate, publish.

The project is at the start of its roadmap. See [docs/ROADMAP.md](docs/ROADMAP.md) for the plan and the phases.

## Decisions

[docs/decisions/](docs/decisions/) holds short decision records for the choices that shape the library.

## Prerequisites

- Node.js, at the version in [.nvmrc](.nvmrc) (`nvm use` or `fnm use` picks it up)
- npm, which comes with Node

## Getting started

```sh
npm ci
```

## Scripts

| Command                | What it does                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run copy-specs`   | Copies the OpenAPI specs from the sibling service checkouts into `specs/`. See [Copying specs](#copying-specs).                                      |
| `npm run generate`     | Generates a typed client for every spec in `specs/` into `src/generated/`. See [Generating clients](#generating-clients).                            |
| `npm run check-stage`  | Checks that a deployed stage is ready: every service is healthy and serves the spec versions in `specs/`. See [Checking a stage](#checking-a-stage). |
| `npm run mock`         | Starts a mock of each Storefront service from the specs in `specs/`, for work when no stage is deployed. See [Local mocks](#local-mocks).            |
| `npm run lint`         | Runs ESLint. `src/generated/` is excluded.                                                                                                           |
| `npm run format:check` | Checks code formatting with Prettier. `src/generated/` is excluded.                                                                                  |
| `npm run format`       | Rewrites files with Prettier.                                                                                                                        |
| `npm run typecheck`    | Runs the TypeScript compiler without emitting. Includes generated code.                                                                              |
| `npm test`             | Runs the unit tests in `tests/unit/` with vitest.                                                                                                    |

CI runs the same checks, in the same order, on every pull request and every push to `main`.

## Copying specs

The specs belong to the service repositories. `npm run copy-specs` copies the ones listed in [specs.config.json](specs.config.json) into `specs/`, so nobody copies them by hand.

**Folder layout.** Clone this repository and every service repository it generates for into the same parent folder. A repository named `storefront-backend` is found at `../storefront-backend` from the root of this repository:

```
projects/
├── spec-driven-test-client/
└── storefront-backend/
```

**Config.** `specs.config.json` lists the repositories to copy from. Each entry has the repository folder name (`repo`), the folder inside it that holds the specs (`specsPath`) and the spec files to copy (`files`). A repository that holds several services is one entry that lists all of their files:

```json
{
    "services": [
        {
            "repo": "storefront-backend",
            "specsPath": "specs",
            "files": ["customers-service-v1.yaml", "orders-service-v1.yaml"]
        }
    ]
}
```

**What the command does.** It checks every listed file first: the repository and spec folders exist, each file is valid YAML, declares OpenAPI 3.0.x, has an `info.version`, and is named `<service>-service-v<N>.yaml`, and no name is listed twice. If anything is wrong, it prints every problem and leaves `specs/` as it was. Otherwise it replaces the contents of `specs/` with the listed files, byte for byte, removes files that are no longer listed, and prints what was added, changed, removed and left alone.

**Good to know.**

- The source is always a local checkout, so a checkout of a service's `main` gives the published specs and a checkout of a feature branch lets you try a change before it merges. Update the checkout (`git pull`) before you copy.
- Specs are copied as they are and never edited. If a spec is wrong, fix it in the service's repository, then copy again.
- Only standalone files are supported. A spec that references other files with `$ref` must be bundled by its own project first.
- The script keeps no record of where a spec came from. Commit the changed `specs/` files, and git history is the record.

The reasons for these choices are in [decision record 0007](docs/decisions/0007-spec-source.md).

## Generating clients

`npm run generate` turns every spec in `specs/` into a typed client with [hey-api `openapi-ts`](https://heyapi.dev), at the exact version in `package.json`. Each spec gets its own folder named after its file, so `specs/orders-service-v1.yaml` becomes `src/generated/orders-service-v1/`. Adding a spec is dropping its file into `specs/` and running the command. No script or configuration changes.

```sh
npm run generate
npm run generate -- --service orders-service-v1
```

**What the command does**, in order. It stops at the first problem, and `src/generated/` is changed only if every step passes:

1. **Check** every spec. It must be valid YAML and an OpenAPI document, have no duplicate `operationId` (hey-api does not report one) and have no local `$ref` that points at nothing (hey-api reports that with an unrelated message). All problems are printed together.
2. **Generate** each spec into a work folder with the shared options in `openapi-ts.config.mjs`. Anything hey-api prints as a warning or an error fails the run.
3. **Typecheck** the new code with the repository's `tsconfig.json`.
4. **Swap** the new folders in. The old folder of each spec is replaced as a whole, so a deleted operation leaves no stale file. A full run also removes the folders of specs that no longer exist.
5. **Print** the specs generated, the operations in each and the generator version.

`--service <name>` generates one spec, named without `.yaml`, and leaves every other folder alone. A name that is not in `specs/` is a usage error (exit code 2). A failed run exits with 1.

**Good to know.**

- Generated code is committed and never edited by hand ([decision record 0003](docs/decisions/0003-generated-code-in-git.md)). It is excluded from lint and format, and included in the typecheck. A spec change shows up as a generated diff.
- Every folder carries its own copy of the hey-api runtime (`client/` and `core/`, about 1,700 non-blank lines), so the six Storefront folders are about 12,400 non-blank lines. They are identical, and a test asserts it ([decision record 0011](docs/decisions/0011-naming-across-services.md)).
- The work folder `.generate-<random>/` is created in the repository root and removed at the end. It is gitignored and is left behind only if a run is killed.
- Upgrading hey-api is a one-line change of the pinned version, a regenerate, and a pull request with the generated diff ([decision record 0008](docs/decisions/0008-custom-generator-templates.md)).

## Checking a stage

`npm run check-stage -- <stage>` (`dev`, `prod` or `local`) checks that a stage is ready for tests, before you run any. `local` is the [local mocks](#local-mocks).

```sh
npm run check-stage -- dev
npm run check-stage -- dev --warmup
```

**What it checks.** For every service that has a spec in `specs/`, it calls the open routes `GET /v0/health` and `GET /v0/version`. It compares every entry of `specVersions` with the `info.version` of the spec whose file suffix matches the key (`v1` with `orders-service-v1.yaml`), and it checks that the service reports the stage you selected. A prefix that the service serves without a library spec, and a library spec whose prefix the service does not serve, are both failures. It prints one table and exits with 0 when everything passes, 1 when a check fails and 2 when it is used wrongly.

**Warm-up.** `--warmup` also calls the readiness route (`getReadiness`) of the services that have one, which today is customers. That route needs the `tests` API key and touches the database, so it wakes a paused Aurora cluster. While the database resumes the route answers 503 (with `Retry-After`) or the gateway answers 504, so the script retries within 90 seconds and reports how long it took. It honors `Retry-After` (in seconds) and waits at least 1 second between calls, so a `Retry-After: 0` never becomes a tight loop. Do not run it on a schedule, because a database that is queried all the time does not pause.

**Configuration.**

- Base URLs per stage are in [config/environments.ts](config/environments.ts), keyed by service name (`orders-service`). `local` has the default URLs of the mocks. `dev` and `prod` have no URLs yet, because no stage is deployed. Until the backend publishes its stage manifest, add them there by hand. The `dev` stage is recreated on every backend pull request run, so its URLs change each time.
- The key for `--warmup` is read from the environment variable `APITEST_<STAGE>_TESTS_API_KEY` (for example `APITEST_DEV_TESTS_API_KEY`), set from the backend's key retrieval script or an untracked `.env` file. The script sends it only to the readiness route and never prints it.

The script uses plain `fetch`. It does not need the generated clients.

## Local mocks

`npm run mock` starts a mock of each Storefront service on `127.0.0.1` (ports 4010 to 4012), built from the specs in `specs/`. Each serves the `v0` and the `v1` paths of its service from one base URL and answers with the examples written in the spec, so it needs no AWS account and a changed spec changes the answers with no code change. `npm run check-stage -- local` checks them like a deployed stage.

They have no state and no cross-service behavior, so an order never becomes `CONFIRMED`, and they do not validate request bodies. [mock/README.md](mock/README.md) lists what they check and what they do not, how to ask for an error response with `Prefer: code=409`, and why they are a small server of our own and not Prism.
