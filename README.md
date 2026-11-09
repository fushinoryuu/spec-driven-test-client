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

| Command                | What it does                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run copy-specs`   | Copies the OpenAPI specs from the sibling service checkouts into `specs/`. See [Copying specs](#copying-specs). |
| `npm run lint`         | Runs ESLint. `src/generated/` is excluded.                                                                      |
| `npm run format:check` | Checks code formatting with Prettier. `src/generated/` is excluded.                                             |
| `npm run format`       | Rewrites files with Prettier.                                                                                   |
| `npm run typecheck`    | Runs the TypeScript compiler without emitting. Includes generated code.                                         |
| `npm test`             | Runs the unit tests in `tests/unit/` with vitest.                                                               |

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

**What the command does.** It checks every listed file first: the repository and spec folders exist, each file is valid YAML, declares OpenAPI 3.0.x, has an `info.version`, and is named `<service>-service-v<N>.yaml`, and no name is listed twice. If anything is wrong, it prints every problem and leaves `specs/` as it was. Otherwise it replaces the contents of `specs/` with the listed files, byte for byte, removes files that are no longer listed (`specs/.gitkeep` stays), and prints what was added, changed, removed and left alone.

**Good to know.**

- The source is always a local checkout, so a checkout of a service's `main` gives the published specs and a checkout of a feature branch lets you try a change before it merges. Update the checkout (`git pull`) before you copy.
- Specs are copied as they are and never edited. If a spec is wrong, fix it in the service's repository, then copy again.
- Only standalone files are supported. A spec that references other files with `$ref` must be bundled by its own project first.
- The script keeps no record of where a spec came from. Commit the changed `specs/` files, and git history is the record.

The reasons for these choices are in [decision record 0007](docs/decisions/0007-spec-source.md).
