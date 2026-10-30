# Phase 5: Spec-Change Workflow, CI, and Release

The library's promise is that keeping it current is cheap. This phase turns "update the spec, regenerate, publish" into an automated, reviewable, versioned workflow, and rehearses it end to end with the Storefront backend.

## Goals

- A documented, scripted path from a changed spec to a published package version.
- Breaking changes are detected and reflected in the version number.
- CI keeps generated code, types, and tests honest.
- A consumer project proves the published package works.

## Deliverables

| Deliverable | Location |
|---|---|
| Spec sync script | `scripts/sync-specs.ts` |
| Spec diff and version-bump script | `scripts/spec-diff.ts`, `scripts/next-version.ts` |
| CI workflows | `.github/workflows/ci.yml`, `integration.yml`, `release.yml` |
| Changelog generation | `scripts/changelog.ts`, `CHANGELOG.md` |
| Build and packaging config | `package.json` exports, build config |
| Example consumer | `examples/consumer/` |
| Spec update runbook | `docs/updating-specs.md` |
| Demo script | `docs/demo-script.md` |

## The workflow

1. A service's spec changes in the Storefront backend project, where each service's `openapi.yaml` is the contract and `info.version` is bumped. The backend deploys the change to `dev` first.
2. `npm run sync-specs` pulls the published specs and the stage manifest from the backend project into `specs/`.
3. `npm run generate` regenerates the client.
4. The spec diff is computed, and the next version is proposed.
5. `npm run typecheck` shows which existing tests break (compile-time).
6. Tests are fixed or added, and `npm run test` and the integration tests pass.
7. The pull request shows the spec diff, the generated diff, and the proposed version.
8. Merge triggers the release pipeline, which publishes the new version.

## Tasks

### 1. Spec sync

- [ ] `sync-specs` pulls specs from their source into `specs/`. For Storefront, the backend publishes its three specs and a stage manifest as a build artifact or release asset and records the source commit. Copy them in, or fetch them at a given ref, naming each file `<service>-service.yaml`. Until the backend publishes those artifacts (its Phase 5), fetch the bundled files from a git ref of the backend repo's `specs/` folder. Record the source, ref, and spec version for each in `specs/sources.json` so the origin of every spec is traceable. Pull all three together, so a change that spans services is one library change.
- [ ] Fail clearly if a source is unreachable. Never leave a half-updated `specs/` folder.
- [ ] The same script pulls the stage manifest (service names, base URLs per stage, secret names, deployed spec versions), so the library's environment config does not duplicate it.
- [ ] Document how a team with many services would point the same script at many repos or an internal spec registry.

### 2. Spec diff and breaking-change detection

- [ ] Compare the old and new spec for each service on every PR that touches `specs/`. Evaluate an existing OpenAPI diff tool before writing your own (oasdiff is one to look at). A custom script based on a parsed spec is fine for a small demo if no tool fits, but then the rules must be tested.
- [ ] Classify changes: operation added (non-breaking), operation removed (breaking), required parameter or required request field added (breaking), response field removed or type changed (breaking), optional field added (non-breaking), description-only change (patch).
- [ ] Output a machine-readable report and a short human summary, posted on the PR.
- [ ] Unit test the classification with small before and after spec pairs for every rule, plus identical specs.

### 3. Versioning and changelog

- [ ] Semantic versioning for the package, driven by the diff: any breaking change means major, an added operation or field means minor, anything else means patch.
- [ ] Decide how the package version relates to spec versions (for example, independent semver with the spec versions listed in the changelog). Record the decision in decision record 0012.
- [ ] `next-version` proposes the bump and a human confirms it in the PR.
- [ ] Changelog entry per release listing added, removed, and changed operations per service, and the spec version each came from.
- [ ] A change to the generator version, its options, or a template override changes generated code with no spec change. Classify that release by its effect on the generated public types (a removed or retyped export is breaking, an addition is minor, no type change is a patch) and list it in the changelog as a tooling change, separate from spec changes.

### 4. CI

- [ ] **ci.yml** on every push and PR: install, lint, typecheck (including generated code), unit tests, and `generate:check`. Set up Java (or use Docker) and cache the generator jar. `generate:check` uses the same generator version, options, and template folder as `generate`, and any change under `openapitools.json` or `templates/` always runs it.
- [ ] **Spec PR job:** runs the diff, comments the result, and fails if a breaking change is not accompanied by a major version bump.
- [ ] **integration.yml:** runs the `smoke` project against `prod`, on a schedule and on demand. Smoke is read-only and never touches Aurora, so the job needs no warm-up and never wakes the cluster. The `full` project runs against `dev` only once the cross-repo wiring with the backend exists (its deploy-test-destroy flow), and until then runs locally. Credentials come from repository secrets. The scheduled smoke job uses the `prod` `tests` key. The `admin` key is stored separately and used only by `full` jobs that need it, and the `services` key is never loaded. Allow for the Aurora warm-up in the timeout of `full` jobs. Stretch: if a real identity provider is used, its client secrets are stored the same way, one per caller type, and the token provider tests that need no cloud access stay separate from them. Upload JUnit or JSON results.
- [ ] Never run write tests against a protected environment in CI.
- [ ] Keep unit and generation checks free of network access to the Storefront services, so a cloud outage cannot block unrelated work.
- [ ] Stretch: token provider tests run in CI against the in-process mock OAuth2 server, which needs no cloud access and no secrets.

### 5. Build and publish

- [ ] Build to a `dist/` folder with type declarations. Choose a build tool you can explain (plain `tsc` or a bundler such as tsup).
- [ ] `package.json` `exports` for the main entry and the `./testing` subpath. Declare `vitest` as a peer dependency, because the testing helpers depend on it.
- [ ] Decide on a registry: public npm, or GitHub Packages for a lower-stakes demo. Record the choice.
- [ ] Release workflow: on merge to main (or a tag), build, run the full checks, publish with provenance if the registry supports it, and create a GitHub release from the changelog entry.
- [ ] A dry-run mode (`npm pack` and inspect the contents) to run before the first real publish. Verify that no secrets, specs you do not want public, template overrides, or test output are in the tarball. The package ships built output and type declarations, not the generator inputs.

### 6. Example consumer

- [ ] `examples/consumer/` is a separate small project that installs the built package (from the tarball in CI, from the registry after release) and runs a few tests.
- [ ] CI builds the package, installs it into the consumer, and runs the consumer's tests. This catches packaging mistakes such as missing exports or declaration files.

### 7. Rehearse the demo

Script the full story using the planned spec changes from Phase 1, and run it end to end at least once. It needs the shipped v1.0.0 specs and a deployed `dev` stack, so it comes after the backend has finished its services:

- [ ] **v1.0.0:** the library is built from the three v1.0.0 Storefront specs and published. The example tests pass against `dev`.
- [ ] **v1.1.0 (non-breaking):** apply the backend's planned v1.1.0 changes (customers: optional `preferredLanguage`; orders: `GET /orders/{orderId}/timeline` and an optional `notes` field on order creation; shipping: an optional `carrier` filter on the shipment list). Once the backend has deployed them to `dev`, run sync and generate, and see `getOrderTimeline` appear in autocomplete. Add one test, publish 1.1.0. Time the whole thing.
- [ ] **v2.0.0 (breaking):** apply the backend's planned v2.0.0 changes (orders: `createOrder` requires `shippingAddressId`; shipping: status value `PICKED` renamed `PACKED`). Run generate and watch `tsc` flag every test that creates an order or checks the old status. The diff tool demands a major bump. Fix tests, publish 2.0.0.
- [ ] Keep the order explicit: the backend deploys a change to `dev` first, then the library syncs specs. The version check in global setup (Phase 4) flags a mismatch if the order is wrong.
- [ ] Record timings and the hand-written line count for each step. These become the measured claims in Phase 6.

### 8. Generator and template upgrades

Spec changes are not the only reason generated code changes. Bumping the pinned generator version, changing generator options, or editing a template override (Phase 2) all change the output with no spec change, so they get their own workflow.

- [ ] Use a separate pull request for generator and template changes, never mixed with a spec sync.
- [ ] Bump the pinned version in `openapitools.json`. If template overrides exist, follow the Phase 2 upgrade procedure: export the default templates for the old and new versions, diff them, and merge the relevant changes into each override.
- [ ] Regenerate, then review the generated diff, run typecheck, the unit and integration tests, and the compile-time safety test from Phase 4.
- [ ] CI treats changes under `openapitools.json` and `templates/` as triggers for the drift check and the full test run, and labels the pull request as a tooling change.
- [ ] Release it using the versioning rule above, with a "tooling change" changelog entry.

## Acceptance criteria

- A non-breaking spec change reaches a published package with a short, scripted sequence of commands and no hand edits to generated code.
- A breaking spec change is detected, flagged on the PR, and forces a major version.
- `generate:check` fails CI when generated code is stale.
- A generator version bump or template change arrives as its own pull request with a reviewable generated diff, and passes the same checks as a spec change.
- The example consumer passes against the packed or published package.
- The demo script has been run end to end and the timings recorded.

## Risks and notes

- **Over-trusting the diff tool.** Review its output on realistic changes before relying on it to gate releases.
- **Publishing something private.** Check the tarball contents. Use a dry run first.
- **Credential handling.** CI secrets for the integration job must be scoped to the stages and caller types each job needs: the `prod` `tests` key for scheduled smoke runs, and never the `services` key. API keys are shared secrets.
- **Version confusion.** If package versions and spec versions diverge, the changelog is the bridge, so keep it accurate.
