# Phase 5: Spec-Change Workflow, CI, and Release

The library's promise is that keeping it current is cheap. This phase turns "update the spec, regenerate, publish" into an automated, reviewable, versioned workflow, and rehearses it end to end with the Storefront backend.

## Goals

- A documented, scripted path from a changed spec to a published package version.
- Breaking changes are detected and reflected in the version number.
- CI keeps generated code, types, and tests honest.
- A consumer project proves the published package works.

## Deliverables

| Deliverable                                                                      | Location                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------- |
| Stage manifest copy (an extension of the Phase 1 spec copy script)               | `scripts/copy-specs.ts`                           |
| Spec diff and version-bump script                                                | `scripts/spec-diff.ts`, `scripts/next-version.ts` |
| CI workflows                                                                     | `.github/workflows/ci.yml`, `release.yml`         |
| Changelog generation                                                             | `scripts/changelog.ts`, `CHANGELOG.md`            |
| Build and packaging config                                                       | `package.json` exports, build config              |
| Example consumer                                                                 | `examples/consumer/`                              |
| Recipe for a project that consumes the package (the backend's Storefront suites) | `docs/backend-setup.md`                           |
| Spec update runbook                                                              | `docs/updating-specs.md`                          |
| Demo script                                                                      | `docs/demo-script.md`                             |

## The workflow

1. A service's spec changes in the Storefront backend project, where each service's versioned OpenAPI file is the contract and `info.version` is bumped. A new API version is a new spec file. The backend deploys the change to `dev` first.
2. `npm run copy-specs` copies the specs and the stage manifest from the backend checkout (on `main`, beside this repository) into `specs/`.
3. `npm run generate` regenerates the client.
4. The spec diff is computed, and the next version is proposed.
5. `npm run typecheck` shows which existing tests break (compile-time).
6. Tests are fixed or added, and `npm run test` and the example suites pass.
7. The pull request shows the spec diff, the generated diff, and the proposed version.
8. Merge triggers the release pipeline, which publishes the new version.
9. The backend project takes the new package version and runs its own Storefront suites against `dev`.

## Tasks

### 1. Spec copy

- [ ] `copy-specs` (built in Phase 1, decision record 0007) already copies the versioned specs (a `v0` and a `v1` for each of the three services, named `<service>-service-v<N>.yaml`, decision record 0013) from the local sibling checkouts into `specs/`, all together, so a change that spans services is one library change. Check that it still covers the files the backend publishes once its `v2` specs exist, and keep its failure behavior: a failed run never leaves a half-updated `specs/` folder.
- [ ] Extend the same script to copy the stage manifest (service names, base URLs per stage, secret names, deployed spec versions) from the backend checkout, so the library's environment config does not duplicate it.
- [ ] Document how a team with many services lists each repository in `specs.config.json` and clones them beside the library. Remote sources (a git ref, a release asset or a spec registry) are not supported (decision record 0007).

### 2. Spec diff and breaking-change detection

- [ ] Compare the old and new spec for each service on every PR that touches `specs/`. Evaluate an existing OpenAPI diff tool before writing your own (oasdiff is one to look at). A custom script based on a parsed spec is fine for a small demo if no tool fits, but then the rules must be tested.
- [ ] Classify changes: operation added (non-breaking), operation removed (breaking), required parameter or required request field added (breaking), response field removed or type changed (breaking), optional field added (non-breaking), description-only change (patch).
- [ ] API versions (decision record 0013): a new `-v<N>` spec for a service is non-breaking (a new namespace, so minor), removing a version's spec is breaking (major), and changes inside one version are classified by the rules above, per version. Compare each version against its own previous spec, not against another version.
- [ ] Output a machine-readable report and a short human summary, posted on the PR.
- [ ] Unit test the classification with small before and after spec pairs for every rule, plus identical specs and the added and removed API version cases.

### 3. Versioning and changelog

- [ ] Semantic versioning for the package, driven by the diff: any breaking change means major, an added operation or field means minor, anything else means patch.
- [ ] Decide how the package version relates to spec versions (for example, independent semver with the spec versions listed in the changelog). Record the decision in decision record 0012.
- [ ] `next-version` proposes the bump and a human confirms it in the PR.
- [ ] Changelog entry per release listing added, removed, and changed operations per service, and the spec version each came from.
- [ ] A change to the generator version, its options, or a template override changes generated code with no spec change. Classify that release by its effect on the generated public types (a removed or retyped export is breaking, an addition is minor, no type change is a patch) and list it in the changelog as a tooling change, separate from spec changes.

### 4. CI

- [ ] **ci.yml** on every push and PR: install, lint, typecheck (including generated code), unit tests, and `generate:check`. Set up Java (or use Docker) and cache the generator jar. `generate:check` uses the same generator version, options, and template folder as `generate`, and any change under `openapitools.json` or `templates/` always runs it.
- [ ] **Spec PR job:** runs the diff, comments the result, and fails if a breaking change is not accompanied by a major version bump.
- [ ] **Examples:** `ci.yml` also runs the example suites against the stub service (`npm run test:examples`), which needs no cloud and no secrets. The scheduled `smoke` run against `prod` and the `full` run against `dev` are jobs of the backend project, which installs this package. `docs/backend-setup.md` gives it a recipe: the vitest projects from Phase 4; the secrets each job needs (the `prod` `tests` key for the scheduled smoke job, the `admin` key stored separately and used only by `full` jobs that need it, the read-only LaunchDarkly token, and never the `services` key); an allowance for the Aurora warm-up in the timeout of `full` jobs; and uploading JUnit or JSON results. Stretch: if a real identity provider is used, its client secrets are stored the same way, one per caller type.
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

- [ ] `examples/consumer/` is a separate small project that installs the built package (from the tarball in CI, from the registry after release) and runs a few tests. It is also the template for the backend project: it shows the `smoke` and `full` vitest projects, the global setup, a flag-gated test, and Storefront-shaped read-only tests that run against the spec-driven mocks.
- [ ] CI builds the package, installs it into the consumer, and runs the consumer's tests. This catches packaging mistakes such as missing exports or declaration files.

### 7. Rehearse the demo

Script the full story using the planned spec changes from Phase 1, and run it end to end at least once. The library side (copy specs, generate, typecheck, publish) needs the specs and the mocks only. Running the Storefront suites against a deployed `dev` stack happens in the backend project, so that part comes after the backend has finished its services:

- [ ] **v1.0.0:** the library is built from the v0 and v1 specs of the three Storefront services (v1.0.0 business specs) and published. The example consumer's tests pass against the mocks, and the backend's Storefront suites pass against `dev` using this package.
- [ ] **v1.1.0 (non-breaking):** apply the backend's planned v1.1.0 changes to the `v1` specs (customers: optional `preferredLanguage`; orders: `GET /v1/orders/{orderId}/timeline` and an optional `notes` field on order creation; shipping: an optional `carrier` filter on the shipment list). Once the backend has deployed them to `dev`, run copy-specs and generate, and see `getOrderTimeline` appear in autocomplete on `ordersService.v1.orders`. Add one test, publish 1.1.0. Time the whole thing.
- [ ] **`v2` beside `v1` (non-breaking for the library):** the backend adds `orders-service-v2.yaml` (`createOrder` requires `shippingAddressId`) and `shipping-service-v2.yaml` (status value `PICKED` renamed `PACKED`) next to the `v1` files. Run copy-specs and generate and see the new `v2` namespace appear while every `v1` call keeps compiling. The diff tool classifies the added versions as a minor change. Migrate one example from `v1` to `v2`, watch `tsc` flag the missing `shippingAddressId` and the old status value, fix it, and publish the minor version.
- [ ] **Retire `v1` (breaking):** remove the `v1` specs, as the backend would when it retires `/v1`. Run generate and watch `tsc` flag every example that uses `v1`. The diff tool demands a major bump. Fix the examples, publish 2.0.0.
- [ ] Keep the order explicit: the backend deploys a change to `dev` first, then the library copies the specs. The version check in global setup (Phase 4) flags a mismatch if the order is wrong.
- [ ] Record timings and the hand-written line count for each step. These become the measured claims in Phase 6.

### 8. Generator and template upgrades

Spec changes are not the only reason generated code changes. Bumping the pinned generator version, changing generator options, or editing a template override (Phase 2) all change the output with no spec change, so they get their own workflow.

- [ ] Use a separate pull request for generator and template changes, never mixed with a spec copy.
- [ ] Bump the pinned version in `openapitools.json`. If template overrides exist, follow the Phase 2 upgrade procedure: export the default templates for the old and new versions, diff them, and merge the relevant changes into each override.
- [ ] Regenerate, then review the generated diff, run typecheck, the unit tests and the example suites, and the compile-time safety test from Phase 4.
- [ ] CI treats changes under `openapitools.json` and `templates/` as triggers for the drift check and the full test run, and labels the pull request as a tooling change.
- [ ] Release it using the versioning rule above, with a "tooling change" changelog entry.

## Acceptance criteria

- A non-breaking spec change reaches a published package with a short, scripted sequence of commands and no hand edits to generated code.
- A breaking spec change is detected, flagged on the PR, and forces a major version. Adding an API version spec is a minor change and removing one is a major change.
- `generate:check` fails CI when generated code is stale.
- A generator version bump or template change arrives as its own pull request with a reviewable generated diff, and passes the same checks as a spec change.
- The example consumer passes against the packed or published package, and `docs/backend-setup.md` is enough for the backend project to set up its own suites.
- The demo script has been run end to end and the timings recorded.

## Risks and notes

- **Over-trusting the diff tool.** Review its output on realistic changes before relying on it to gate releases.
- **Publishing something private.** Check the tarball contents. Use a dry run first.
- **Credential handling.** CI secrets for the backend project's jobs must be scoped to the stages and caller types each job needs: the `prod` `tests` key for scheduled smoke runs, and never the `services` key. API keys are shared secrets.
- **Version confusion.** If package versions and spec versions diverge, the changelog is the bridge, so keep it accurate.
- **Cross-repo wiring is undecided on the backend side.** The backend project owns its Storefront suites and decides how its deploy-test-destroy flow installs this package. That wiring is not settled there yet, and its own end-to-end tests currently use plain `fetch`. This library supplies the package, the example consumer and `docs/backend-setup.md`, and revisits the details once the library has runnable tests.
