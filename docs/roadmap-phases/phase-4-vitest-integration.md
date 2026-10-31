# Phase 4: Test Authoring with Vitest

Make writing an integration test feel easy and safe. This phase adds the vitest setup, fixtures, test data helpers, and example suites that show what the library is for. It also proves the main promise: because tests are written against generated types, a spec change that breaks a call fails at typecheck time, before any request is sent.

## Goals

- A vitest configuration that works against any environment, locally and in CI.
- Fixtures that give each test a ready client, unique data, and automatic cleanup.
- Example suites that are realistic and double as documentation.
- Typed test data builders based on generated models.

## Deliverables

| Deliverable | Location |
|---|---|
| Vitest config | `vitest.config.ts` |
| Global setup | `src/testing/global-setup.ts` |
| Fixtures | `src/testing/fixtures.ts` |
| Assertion helpers | `src/testing/expect.ts` |
| Test data builders | `src/testing/builders/` |
| Example integration suites | `tests/integration/` |
| Public testing entry point | `src/testing/index.ts` (exported as `spec-driven-test-client/testing`) |
| Authoring guide | `docs/writing-tests.md` |

## Tasks

### 1. Vitest configuration

- [ ] Separate the library's own unit tests from integration tests using vitest projects (or separate config files), so `npm test` is fast and offline and `npm run test:integration` hits a real environment.
- [ ] Sensible defaults for integration tests: a longer test timeout, retries at the runner level only when explicitly enabled, and sequential execution within a file.
- [ ] Reporters: the default reporter locally, plus JUnit or JSON output in CI for test result tooling.
- [ ] Two integration projects:
  - `smoke`: read-only checks that never touch Aurora, safe for any environment including protected ones. They call the open routes (`getVersion`, `getHealth`) and database-free routes that need the `tests` key, such as `listProducts`. They skip the Aurora warm-up, so a scheduled run never wakes the cluster.
  - `full`: lifecycle and negative tests that write data, for non-protected environments only (in practice `dev` during a backend pull request run), unless the explicit unlock from Phase 3 is set.
- [ ] Environment selection documented in one place: `TEST_ENV=dev npm run test:integration` for the full suites while a dev stack is deployed, and `TEST_ENV=prod npm run test:integration -- --project smoke` for the smoke checks against `prod`.

### 2. Global setup

- [ ] Resolve the environment and print the target and whether it is protected.
- [ ] Load the API keys for the selected environment once (from the environment or the secret store), fail fast with a clear message if the `tests` key is missing, and never print key values.
- [ ] Stretch: when a caller type has no API key but has a token source, acquire its token up front through the Phase 3 token provider and report how long it took.
- [ ] Verify each target service is reachable and compare its `GET /version` with the spec version the library was generated from. A mismatch warns clearly (this catches "tests ran against a stale environment"). The stage manifest lists the expected spec version per service. Also check that the reported `stage` matches the selected environment.
- [ ] For the `full` project only, run each service's warm-up hook before any test starts, notably customers, whose Aurora database may be paused, with a generous timeout. Report how long it took. Skip warm-up for `smoke`. Reuse the stage readiness check's `--warmup` mode from Phase 1.
- [ ] Refuse to run the `full` project against a protected environment unless the explicit opt-in from Phase 3 is set.

### 3. Fixtures

Use vitest's `test.extend` to export a `test` function that tests import instead of the plain one.

- [ ] `api`: the configured client for the current environment.
- [ ] `uid`: a unique id generator (run id plus counter) so parallel runs never collide. Customer emails must come from it too. The email unique index covers deleted rows, so a deleted customer still holds its email, and deleting a customer never frees it.
- [ ] `cleanup`: a registry where tests register undo actions as they create data. Actions run after each test, in reverse order, even when the test fails, and failures during cleanup are reported without hiding the original failure.
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

### 6. Example integration suites

Write these against the three Storefront services. They should read like documentation.

- [ ] **Smoke:** `getVersion` and `getHealth` respond on all three services and report the expected shape, and `listProducts` returns the catalog. None of them touches the customers database.
- [ ] **Customers lifecycle:** create a customer, add an address, fetch, update, list and find, delete, confirm it is gone (404, because customers are soft-deleted and `getCustomer` returns 404 for a deleted customer).
- [ ] **Negative cases:** invalid body returns 400 with the shared error shape, missing id returns 404, duplicate customer email returns 409, and a client-supplied price on an order is ignored or rejected.
- [ ] **Pagination:** create several customers, page through, assert ordering and that no customer is missed or repeated.
- [ ] **Auth:** a protected call without an API key is rejected with the shared error shape and succeeds with the `tests` key. The shipping simulation endpoint rejects the `tests` key and accepts the `admin` key (admin tests run on `dev` only. The backend proposes keeping the route in `prod`, but the admin tests treat `prod` as unavailable).
- [ ] **Cleanup proof:** after the suite, every customer the tests created is gone: `getCustomer` returns 404 for each tracked id. Deleted customers stay in the database with a `deleted` status, so the check uses the tracked ids and does not rely on the customer list. Whether the list hides deleted customers is not settled yet (the backend proposes that it does). Orders and shipments have no delete operation, so they are tagged with the run id and cleared by the backend's reset script or expire on their own.
- [ ] **Cross-service flow:** create a customer, place an order with an idempotency key, poll until the order is `CONFIRMED`, advance the shipment with the admin client, and poll until the order is `SHIPPED` and then `DELIVERED`. Use `expectEventually`, never fixed sleeps. Polling timeouts come from the per-environment config, because the simulated carrier takes seconds in `dev` and minutes in `prod`.
- [ ] **Idempotency:** repeat `createOrder` with the same key and assert that only one order exists.
- [ ] Stretch: **Token refresh.** Against the mock OAuth2 server and a stub API, set a short token lifetime, make calls across the expiry, and assert that every call succeeds and that only the expected number of token requests were made.
- [ ] Each suite carries a comment explaining which library feature it demonstrates.

### 7. Prove compile-time safety

This is the demonstration that sells the approach.

- [ ] A script or test that copies the Storefront specs, removes an operation (or renames a field), regenerates into a temporary folder, and runs `tsc` over the example tests. Use the same generator version, options, and template folder as the real pipeline.
- [ ] Assert that typecheck fails and that the error points at the test line using the removed call.
- [ ] Do the same for a changed request shape. The backend's planned v2.0.0 makes `shippingAddressId` required on `createOrder`, which should break every example test and builder that creates an order. Also try the enum rename (`PICKED` to `PACKED`) and confirm that code checking the old value fails to compile.
- [ ] Record the output as an example for the README and the Phase 6 demo.

## Acceptance criteria

- The `full` project passes against `dev` while a dev stack is deployed, and the `smoke` project passes against `prod`.
- Each test cleans up after itself, including when it fails.
- The `smoke` project runs safely against a protected environment, and `full` refuses to.
- Removing an operation from the spec makes the affected tests fail at typecheck, shown by an automated test.
- A new contributor can write a test for a new endpoint using only `docs/writing-tests.md`.

## Risks and notes

- **Cold database and eventual consistency.** The first customers call after an idle period can take 15 seconds or more, and an order reaches `CONFIRMED` only after events flow through the bus. The warm-up hook and `expectEventually` exist for these. Do not paper over them with retries.
- **Shared state.** Parallel files sharing data cause flaky failures. Keep unique ids and cleanup in the fixtures so test authors do not have to think about it.
- **Eventual consistency.** If the demo backend is eventually consistent, polling helpers are not optional. Design the API and tests with that in mind.
- **Environment drift.** The version check in global setup exists to catch stale deployments before they produce misleading failures.
- **Fixture overreach.** Keep fixtures small. If they grow into a framework, tests stop being readable.
