# spec-driven-test-client

Generates typed clients for backend services from their OpenAPI specs, so integration tests can call `apitest.service.group.operation(request)` and get autocomplete and compile-time checks. The workflow is: change the spec, regenerate, publish.

The project is at the start of its roadmap. See [docs/ROADMAP.md](docs/ROADMAP.md) for the plan and the phases.

## Project rules and decisions

- [docs/clean-room.md](docs/clean-room.md): what this project may and may not draw on. Read it before contributing.
- [docs/decisions/](docs/decisions/): short decision records for the choices that shape the library.

## Prerequisites

- Node.js, at the version in [.nvmrc](.nvmrc) (`nvm use` or `fnm use` picks it up)
- npm, which comes with Node

## Getting started

```sh
npm ci
```

## Scripts

| Command                | What it does                                                            |
| ---------------------- | ----------------------------------------------------------------------- |
| `npm run lint`         | Runs ESLint. `src/generated/` is excluded.                              |
| `npm run format:check` | Checks code formatting with Prettier. `src/generated/` is excluded.     |
| `npm run format`       | Rewrites files with Prettier.                                           |
| `npm run typecheck`    | Runs the TypeScript compiler without emitting. Includes generated code. |
| `npm test`             | Runs the unit tests in `tests/unit/` with vitest.                       |

CI runs the same checks, in the same order, on every pull request and every push to `main`.
