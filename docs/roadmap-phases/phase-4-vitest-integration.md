# Phase 4: Test Authoring with Vitest

Make writing an integration test feel easy and safe. This phase adds the vitest setup, fixtures, test data helpers, and example suites that show what the library is for. It also proves the main promise: because tests are written against generated types, a spec change that breaks a call fails at typecheck time, before any request is sent.

The helpers are part of the published package (`spec-driven-test-client/testing`), so a project that tests a real service can use them. The tests of the Storefront services live in the backend project, like the tests of any real service, and consume the package. This repository proves the toolkit against a small in-process stub service, with no cloud and no secrets, and the example consumer (Phase 5) is the template for the backend's setup.

## Goals

- A vitest configuration that works against any environment, locally and in CI, and a recipe for a project that consumes the package.
- Fixtures that give each test a ready client, unique data, resolved feature flags and automatic cleanup.
- Example suites that are realistic and double as documentation, run against a stub service so they work offline.
- Typed test data builders based on generated models.

## Deliverables

| Deliverable                                                                                          | Location                                                               |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Vitest config for this repository's tests                                                            | `vitest.config.ts`                                                     |
| Global setup                                                                                         | `src/testing/global-setup.ts`                                          |
| Fixtures                                                                                             | `src/testing/fixtures.ts`                                              |
| Assertion helpers                                                                                    | `src/testing/expect.ts`                                                |
| Test data builders                                                                                   | `src/testing/builders/`                                                |
| Stub service for the example suites (versioned fixture specs, state, idempotency, flags, cold start) | `tests/stub/`, specs in `tests/fixtures/specs/`                        |
| Example suites                                                                                       | `tests/examples/`                                                      |
| Storefront-shaped read-only examples, run against the spec-driven mocks                              | `tests/examples/storefront/`                                           |
| Public testing entry point                                                                           | `src/testing/index.ts` (exported as `spec-driven-test-client/testing`) |
| Authoring guide, including guidance for the backend's Storefront suites                              | `docs/writing-tests.md`                                                |

## Tasks

### 1. Vitest configuration

- [ ] Separate the library's own unit tests from the example suites using vitest projects (or separate config files), so `npm test` is fast and offline and `npm run test:examples` runs the suites against the stub service, also offline.
- [ ] Sensible defaults for suites that call a service: a longer test timeout, retries at the runner level only when explicitly enabled, and sequential execution within a file.
- [ ] Reporters: the default reporter locally, plus JUnit or JSON output in CI for test result tooling.
- [ ] Document the project layout a consuming project should use, and show it working in the example consumer (Phase 5):
    - `smoke`: read-only checks that never touch the Aurora database, safe for any environment including protected ones. They call the operational routes (`apitest.ordersService.v0.operations.getVersion`, `getHealth`) and database-free routes that need the `tests` key, such as `listProducts`. They skip the Aurora warm-up, so a scheduled run never wakes the cluster.
    - `full`: lifecycle and negative tests that write data, for non-protected environments only (in practice `dev` during a backend pull request run), unless the explicit unlock from Phase 3 is set.
- [ ] Environment selection documented in one place: `TEST_ENV=dev` for the full suites while a dev stack is deployed, and `TEST_ENV=prod` with the `smoke` project for the smoke checks against `prod`.

### 2. Global setup

- [ ] Resolve the environment and print the target and whether it is protected.
- [ ] Load the API keys for the selected environment once (from the environment or the secret store), fail fast with a clear message if the `tests` key is missing, and never print key values.
- [ ] Stretch: when a caller type has no API key but has a token source, acquire its token up front through the Phase 3 token provider and report how long it took.
- [ ] Verify each target service is reachable and run the per-version check from Phase 3: compare every entry of `specVersions` from `GET /v0/version` with the `info.version` of the spec whose file suffix matches the key. A mismatch warns clearly (this catches "tests ran against a stale environment"). The stage manifest lists the expected spec versions per service. Also check that the reported `stage` matches the selected environment.
- [ ] Resolve the feature flags the tests name (Phase 3) once, cache them for the run, and print them with the target environment. An unknown flag fails here, before any test starts.
- [ ] For the `full` project only, run each service's warm-up hook before any test starts, notably customers, whose Aurora database may be paused, with a generous timeout. Report how long it took. Skip warm-up for `smoke`. Reuse the stage readiness check's `--warmup` mode from Phase 1.
- [ ] Refuse to run the `full` project against a protected environment unless the explicit opt-in from Phase 3 is set.

### 3. Fixtures

Use vitest's `test.extend` to export a `test` function that tests import instead of the plain one.

- [ ] `api`: the configured client for the current environment.
- [ ] `uid`: a unique id generator (run id plus counter) so parallel runs never collide. Where a service has a unique index that covers deleted rows (the Storefront's customer emails), the values must come from it too, because deleting never frees them.
- [ ] `cleanup`: a registry where tests register undo actions as they create data. Actions run after each test, in reverse order, even when the test fails, and failures during cleanup are reported without hiding the original failure.
- [ ] `flags`: the resolved feature flags for the run, with `isEnabled`, `require` and `requireOff` (Phase 3). A test that calls `flags.require('name')` is skipped with a reason when the flag is off. The reporter adds a summary of tests skipped because of a flag, grouped by flag.
- [ ] `ctx`: run metadata (environment, run id, correlation id prefix) for log correlation.
- [ ] Document the pattern: create through the API, register cleanup immediately, then assert.

### 4. Assertion helpers

- [ ] `expectStatus(status, response)` and `expectProblem(response, matcher)` from Phase 3 (both also accept a pending call), with readable failure messages that include the request summary and correlation id.
- [ ] `expectEventually(fn, { timeout, interval })` for asynchronous backends, polling a condition instead of using fixed sleeps. Fixed sleeps are a flakiness source the library should not encourage.
- [ ] Optional: a schema assertion that validates a response body against the spec's schema, so responses are checked for shape and not only for the fields a test happened to read. Mark this as a stretch goal.

### 5. Test data builders

- [ ] A builder per request model, typed from the generated models, with valid defaults and per-test overrides: `buildCreateCustomer({ firstName: uid('jane') })`.
- [ ] Builders are typed with the generated model types, so a spec change that adds a required field makes the builder fail to compile until it is updated. That is intended.
- [ ] Keep builders hand-written and small. Do not generate them from the spec unless the pattern proves tedious.

### 6. Stub service and example suites

The example suites run against a stub service defined in this repository: a small in-process HTTP service with fixture specs (a `widgets` service with `v0`, `v1` and `v2`), real state, API key checks, cursor pagination, idempotency keys, a simulated cold start, a simulated slow asynchronous status change, and a flag-gated route. It exists so every library feature has a runnable example without a cloud account or a deployed Storefront. They should read like documentation.

- [ ] **Stub service:** built from the fixture specs, so the same generated clients, facade and fixtures are exercised exactly as they are against a real service. Starting it is one fixture.
- [ ] **Lifecycle:** create, fetch, update, list and find, delete, confirm it is gone (404), with cleanup registered at creation.
- [ ] **Negative cases:** invalid body returns 400 with the shared `Problem` shape, missing id returns 404, a duplicate unique value returns 409.
- [ ] **Pagination:** create several records, page through with the cursor, assert ordering and that nothing is missed or repeated.
- [ ] **Auth:** a call without an API key is rejected with the `Problem` shape and succeeds with the `tests` key. An admin-only route rejects the `tests` key and accepts the `admin` caller type.
- [ ] **Cleanup proof:** after the suite, every record the tests created is gone, checked by id.
- [ ] **Idempotency:** repeat a create with the same `Idempotency-Key` and assert that only one record exists.
- [ ] **Asynchronous change:** poll with `expectEventually` until a record reaches its final status. Never use fixed sleeps. Polling timeouts come from the per-environment config.
- [ ] **Warm-up:** the stub answers the first call with 503 and a `Retry-After` header, and the warm-up hook turns that into a slow start and not a failure.
- [ ] **API versions:** call the same operation through `v1` and `v2` side by side, assert each version's own response shape, and show that a field that exists only in `v2` is a type error on `v1`.
- [ ] **Feature flags:** run a suite with the flag on and with the flag off, using the static provider. Assert the documented response in each state (success when on, 404 `Problem` when off), skip tests with `flags.require` when the state does not match, and check that the run summary lists the skipped tests. A unit test covers the LaunchDarkly provider against a fake `fetch`.
- [ ] **Storefront-shaped read-only examples:** a few tests that call the Storefront operations that need no state (`getVersion`, `getHealth`, `listProducts`) against the spec-driven mocks from Phase 1. They run offline in CI, show the real call shapes (`apitest.ordersService.v1.products.listProducts`), and are what the compile-time proof below runs against.
- [ ] Stretch: **Token refresh.** Against the mock OAuth2 server and a stub API, set a short token lifetime, make calls across the expiry, and assert that every call succeeds and that only the expected number of token requests were made.
- [ ] Each suite carries a comment explaining which library feature it demonstrates.

**Guidance for the backend's Storefront suites.** Those suites are written in the backend project. `docs/writing-tests.md` records what they are expected to cover and how, so the library and the backend agree on the setup:

- `smoke` (read-only, no database): the operational routes on all three services, and `listProducts`. Safe against `prod`.
- Customers lifecycle with addresses, negative cases (400, 404, duplicate email 409), pagination, and the cleanup proof by tracked id. Customers are soft-deleted, so `getCustomer` returns 404 for a deleted one, and a deleted customer keeps its email.
- Auth: a protected call without a key is rejected, and the shipping simulation endpoint rejects `tests` and accepts `admin` (on `dev` only).
- The cross-service flow: create a customer, place an order with an idempotency key, poll until `CONFIRMED`, advance the shipment with the admin client, and poll until `SHIPPED` and then `DELIVERED`. The simulated carrier takes seconds in `dev` and minutes in `prod`, so the timeouts come from config.
- Flag-gated behavior: assert the documented response for the LaunchDarkly state of each flag (for example the 404 `Problem` from `advanceShipment` when the simulation flag is off).

### 7. Prove compile-time safety

This is the demonstration that sells the approach. It runs against the Storefront specs and the Storefront-shaped examples above, so it needs no deployed stage.

- [ ] A script or test that copies the Storefront specs, removes an operation (or renames a field), regenerates into a temporary folder, and runs `tsc` over the Storefront-shaped examples. Use the same generator version and options as the real pipeline.
- [ ] Assert that typecheck fails and that the error points at the test line using the removed call.
- [ ] Do the same for a changed request shape. With the backend's planned `orders-service-v2.yaml`, `createOrder` requires `shippingAddressId`, so an example or builder migrated from `v1` to `v2` fails to compile until it supplies it. Also try the enum rename (`PICKED` to `PACKED` in `shipping-service-v2`) and confirm that `v2` code checking the old value fails to compile.
- [ ] Do the same for retiring a version: remove `orders-service-v1.yaml` and confirm every example that uses `ordersService.v1` fails to compile.
- [ ] Record the output as an example for the README and the Phase 6 demo.

## Acceptance criteria

- `npm test` (unit) and `npm run test:examples` (the example suites against the stub service) pass offline in CI, with no secrets.
- Each test cleans up after itself, including when it fails.
- The warm-up, API version, feature flag and idempotency suites pass against the stub service, and the run summary shows which tests were skipped for which flag.
- Removing an operation from a Storefront spec makes the affected examples fail at typecheck, shown by an automated test, and so do the `v1` to `v2` migration and retiring `v1`.
- `docs/writing-tests.md` lets a new contributor write a test for a new endpoint, and gives the backend project what it needs to write the Storefront suites.

## Risks and notes

- **Cold database and eventual consistency.** In the Storefront, the first customers call after an idle period can take 15 seconds or more, and an order reaches `CONFIRMED` only after events flow through the bus. The warm-up hook and `expectEventually` exist for these. Do not paper over them with retries. The stub simulates both so the toolkit is tested without the real stack.
- **Shared state.** Parallel files sharing data cause flaky failures. Keep unique ids and cleanup in the fixtures so test authors do not have to think about it.
- **Environment drift.** The version check in global setup exists to catch stale deployments before they produce misleading failures.
- **Flags hiding failures.** A flag check that skips a test can hide a regression if the flag state is wrong. That is why unknown flags fail instead of defaulting to off, and why skips are listed in the summary.
- **The stub drifting from the Storefront.** The stub is a teaching and testing aid, not a model of the Storefront. The backend's own suites are what show the real services working.
- **Fixture overreach.** Keep fixtures small. If they grow into a framework, tests stop being readable.
