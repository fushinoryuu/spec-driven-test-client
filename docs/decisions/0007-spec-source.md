# 0007: Spec source

- Status: Accepted
- Date: 2026-10-30
- Updated: 2026-11-09 (ALP-16). The source is a local checkout, the script is `copy-specs` and arrives in Phase 1, and there is no source record.

## Context

The specs are owned by the Storefront backend project, which lives in its own repo. Each service's spec is the contract, and the backend bumps `info.version` on every change. The library needs a copy of each spec in `specs/`, committed so that generation, typechecking and unit tests work offline. The stage manifest (base URLs, secret names and deployed spec versions) is copied the same way in Phase 5.

## Options considered

1. **A script that copies the specs from a local checkout of the service repository into `specs/`.** Explicit and reviewable, and it works wherever the repositories can be cloned.
2. **A script that fetches the specs from a git ref, a release asset or a spec registry.** Always from a published source, but it needs network access to a hosted service. A company that adopts the library may not allow its tooling to reach that service, and a change that has not reached `main` cannot be tried.
3. **A git submodule of the backend repo.** Pins a commit, but pulls in the whole backend, and submodules are awkward for contributors and CI.
4. **Copy by hand.** Error-prone, and it does not scale past a few services.
5. **Fetch at build or test time.** Always current, but generation and unit tests then depend on the network and on the backend being up.

## Decision

Option 1. `npm run copy-specs` runs `scripts/copy-specs.ts` (ALP-16, Phase 1). It reads `specs.config.json`, which lists each repository, the spec folder inside it and the spec files to copy, and then replaces the contents of `specs/` with those files. The source is always a local checkout, for three reasons:

- A company that adopts this library may not allow tooling to read its repositories from a hosted Git service. A local folder works anywhere.
- A developer or QA engineer can change a service and want the library updated before that change reaches `main`. A checkout on a feature branch supports that.
- The layout is opinionated: the library and every service repository it generates for are cloned into the same parent folder. A repository named `storefront-backend` is found at `../storefront-backend` from the library's root.

The script checks everything before it changes anything: the repository and spec folders exist, every listed file exists, parses as YAML, declares OpenAPI 3.0.x, has an `info.version` and is named `<service>-service-v<N>.yaml` ([0001](0001-spec-format.md)), and no file name is listed twice. The swap is all or nothing, so a failed run leaves `specs/` as it was. Files in `specs/` that are not in the config are removed, and files are copied byte for byte. It prints what was added, removed, changed and left alone.

The script keeps no record of where a spec came from. The committed `specs/` folder and its git history are the record, and the backend keeps its own record of what it published. The library never edits a copied spec. A problem found in a spec is raised and fixed in the backend project.

Phase 5 extends the same script to copy the stage manifest and to detect breaking changes.

## Consequences

- The library depends on the backend's schedule: the throwaway spec (Phase 0), then the v0.1.0 drafts, then v1.0.0 as each service ships.
- A copy is only as current as the checkout it came from. Take specs from a checkout of the backend's `main` unless you are deliberately trying an unmerged change. The version check in global setup (Phase 4) flags a library whose specs differ from what a stage serves.
- The script copies standalone files only. A spec that needs `$ref` resolution across files must be bundled by its own project first, which the backend does.
- A team with many services lists each repository in `specs.config.json`, and clones them all beside the library.
- Fetching from a remote source (a git ref, an HTTP URL, a release asset or a spec registry) is not supported. It can be added later by a new decision record if a team needs it.
- Unit and generation checks never touch the Storefront services.
- A consumer project proves the published package works.
