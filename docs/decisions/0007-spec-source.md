# 0007: Spec source

- Status: Accepted
- Date: 2026-10-30

## Context

The specs are owned by the Storefront backend project, which lives in its own repo. Each service's spec is the contract, and the backend bumps `info.version` on every change. The library needs the three specs (and the stage manifest with base URLs, secret names and deployed spec versions) in `specs/`, with a trail back to where each came from. Specs are committed so that generation, typechecking and unit tests work offline.

## Options considered

1. **A sync script that copies the published specs and manifest into `specs/`.** Explicit and reviewable, and the origin of every spec is recorded.
2. **A git submodule of the backend repo.** Pins a commit, but pulls in the whole backend, and submodules are awkward for contributors and CI.
3. **Copy by hand.** Fine for the first pull, but error-prone and untraceable if it stays the process.
4. **Fetch at build or test time.** Always current, but generation and unit tests then depend on the network and on the backend being up.

## Decision

Option 1. `scripts/sync-specs.ts` (Phase 5) pulls the three specs together, so a change that spans services is one library change, and writes `specs/sources.json` with the source, ref and `info.version` of each. It also pulls the stage manifest, so the library's environment config does not duplicate it. It fails clearly if a source is unreachable and never leaves a half-updated `specs/` folder.

The source moves as the backend matures:

- **Before the sync script exists (Phase 1):** copy the three latest published specs by hand and record the backend commit and `info.version` in `specs/sources.json`.
- **Until the backend publishes specs as build artifacts:** fetch the bundled files from a git ref of the backend repo's `specs/` folder.
- **After:** use the backend's published artifact or release asset.

The library never edits a pulled spec. A problem found in a spec is raised and fixed in the backend project.

## Consequences

- The library depends on the backend's schedule: the throwaway spec (Phase 0), then the v0.1.0 drafts, then v1.0.0 as each service ships.
- The backend deploys a change to `dev` first, then the library syncs, so the version check in global setup (Phase 4) can flag a mismatch.
- The script can later point at many repos or a spec registry for a team with many services, with the same `specs/sources.json` trail.
- Unit and generation checks never touch the Storefront services.
