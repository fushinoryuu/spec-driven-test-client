# 0003: Generated code in git

- Status: Accepted
- Date: 2026-10-30

## Context

The generator turns each spec into TypeScript under `src/generated/<service>/`. Either that output is committed, or every consumer and every CI run has to generate it. The library's promise is "change the spec, regenerate, publish", so a spec change must produce a reviewable change in the repo.

## Options considered

1. **Commit the output, and check for drift in CI.** The generated diff shows up in every pull request. Nobody needs the generator to build, read or typecheck the code.
2. **Ignore the output, and generate on install or build.** The repo stays small, but diffs show only the spec change, every contributor and CI job needs the generator (and Java, if OpenAPI Generator wins), and a generator upgrade changes the library with no visible diff.
3. **Ignore the output, and generate only in the release pipeline.** The published package is right, but nobody reviews what ships.

## Decision

Commit `src/generated/`. A `generate:check` script (Phase 2) regenerates into a temporary folder and fails when the committed output differs, so stale or hand-edited generated code cannot be merged. CI runs it on every pull request, and always when `openapitools.json` or `templates/` change.

Generated code is typechecked but excluded from ESLint and Prettier, so formatting rules never fight the generator. `.gitignore` must not ignore `src/generated/`.

## Consequences

- Pull requests show the spec diff and the generated diff together. Generator upgrades arrive in their own pull request with a reviewable diff (Phase 5).
- The drift check must ignore harmless differences such as line endings. `.gitattributes` sets `eol=lf` for this reason.
- A merge conflict in generated files is resolved by regenerating, not by editing.
- Hand edits to generated code are never allowed. If one seems necessary, change a generator option, the facade, the transport hooks or the spec instead (the decision rule in [0008](0008-custom-generator-templates.md)).
- The repo grows with every regeneration. That is acceptable at this size.
