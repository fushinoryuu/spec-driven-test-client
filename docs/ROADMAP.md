# Spec-Driven Integration Test Client: Roadmap

A TypeScript library, run with vitest, that generates a typed client for every backend service from its OpenAPI spec so integration tests can call the services like ordinary functions. The central idea: **updating the library is "change the spec, rerun the generator, publish."**

## The target experience

```ts
import { expect } from 'vitest';
import { apitest, expectStatus } from 'spec-driven-test-client';

// library . service . version . endpoint group (spec tag) . operation (operationId)
// Every call takes one request object and returns { status, headers, data }.
// HTTP error statuses do not throw, so a negative test asserts on the status.
const version = await apitest.ordersService.v0.operations.getVersion();
expect(version.status).toBe(200);

const created = await apitest.customersService.v1.customers.createCustomer({
    createCustomer: { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' } // field names come from the generated request type
});
const customer = expectStatus(201, created); // the typed body, or a failure naming the status and correlation id

const missing = await apitest.ordersService.v1.orders.getOrder({ orderId: 'does-not-exist' });
expect(missing.status).toBe(404);
```

Every Storefront service publishes its API in versions: `v1` is the business API, `v2` will sit next to it, and the reserved `v0` holds the operational routes (health, version, readiness). The version is a segment of the call, taken from the spec file name (`orders-service-v1.yaml`), so a test names the version it exercises. Behavior behind a feature flag is handled the same explicit way: the flag state is read from LaunchDarkly and a test that needs a flag is skipped, with a reason, when it is off (decision records 0013 and 0014).

```ts
// Both business versions side by side, once the backend ships /v2.
await apitest.ordersService.v2.orders.getOrder({ orderId });

// A test that depends on a feature flag is skipped, with a reason, when the flag is off. The flag key is illustrative.
test('express shipping is offered', async ({ api, flags }) => {
    flags.require('express-shipping');
    // ...
});
```

**What lives where.** This repository holds the library and tests of the library itself: unit tests, pipeline tests, example suites that run against a small in-process stub service, and Storefront-shaped read-only examples that run against spec-driven mocks. The tests of the Storefront services live in the backend project, like the tests of any real service, and consume the published package. The example consumer (Phase 5) is the template for that setup.

A consuming project points the same tests at an environment with `TEST_ENV=dev` or `TEST_ENV=prod`. The backend's `dev` stage exists only while one of its pull request runs is deployed, and `prod` is flagged protected, so it is read-only (smoke tests only) unless explicitly unlocked. The services authenticate with API keys sent in the `x-api-key` header, chosen per caller type (`tests` by default, `admin` only where a test needs it). A stretch goal adds automatic bearer token acquisition and refresh, for services that use tokens instead of keys.

## Assumptions

- The specs are **OpenAPI 3.0.3** specs, the version the backend uses. The generator is hey-api `openapi-ts`, chosen by the Phase 0 spike (decision record 0002).
- The project has its own name, examples and specs, all invented for the Storefront demo.
- The demo backend is the Storefront backend ([storefront-backend](https://github.com/fushinoryuu/storefront-backend), see its roadmap): three AWS microservices built with CDK, customers on Aurora, orders on DynamoDB, and shipping driven by events. Each publishes versioned OpenAPI 3.0.3 specs: a `v0` (operational) and a `v1` (business) for each service at first, `v2` later, named `<service>-service-v<N>.yaml`. They are the library's input. It lives in its own project and its API uses API Gateway API keys. It has two stages: `dev`, which each of its pull request runs deploys and destroys, and `prod`, which stays up. Its draft specs (v0.1.0) come first, and each business spec reaches v1.0.0 when its service ships. Feature flags are in LaunchDarkly, with no backend endpoint for flag state.
- Spec problems are raised as bug tickets in the backend project (BEP). [docs/backend-contract.md](backend-contract.md) lists what the library needs from the backend and the status of each need.

## Phases

| Phase | Doc                                                                                    | Outcome                                                                                                      |
| ----- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0     | [Foundations and decisions](roadmap-phases/phase-0-foundations.md)                     | Repo, tooling, decision records, generator spike                                                             |
| 1     | [Demo target](roadmap-phases/phase-1-demo-target.md)                                   | Consume the Storefront specs (`v0` and `v1` of three services), stage manifest, API keys and the flag source |
| 2     | [Generation pipeline](roadmap-phases/phase-2-generation-pipeline.md)                   | One command turns specs into typed clients                                                                   |
| 3     | [Client facade and configuration](roadmap-phases/phase-3-client-facade.md)             | `apitest.service.version.group.operation()` plus environments, auth, flags, safety                           |
| 4     | [Test authoring with vitest](roadmap-phases/phase-4-vitest-integration.md)             | Fixtures, cleanup, flags, example suites against a stub service                                              |
| 5     | [Spec-change workflow, CI, release](roadmap-phases/phase-5-spec-change-and-release.md) | Spec change to published version, automated                                                                  |
| 6     | [Polish](roadmap-phases/phase-6-polish.md)                                             | Docs, demo, measured results                                                                                 |

## Checklist

### Phase 0: Foundations and decisions

- [x] Repo skeleton, TypeScript strict, ESM, lint and format
- [x] Decision records: spec version, generator, generated-code strategy, facade strategy, auth, publish target, call shape
- [x] Generator spike (OpenAPI Generator `typescript-fetch` and `typescript-axios`, plus at least one TypeScript-native generator for comparison), with no default generator
- [x] ~~Java requirement handled if OpenAPI Generator is chosen (local, CI, and Docker fallback)~~ Not needed: the spike chose hey-api, which needs no Java (decision record 0002)

### Phase 1: Demo target

- [x] Contract agreed with the backend project: versioned specs (`<service>-service-v<N>.yaml`, a `v0` operational and a `v1` business spec per service) with stable `operationId` and `tag` values, a shared `Problem` schema, an `apiKey` security scheme, `GET /v0/version` on every service, and LaunchDarkly as the flag source
- [x] `npm run copy-specs` copies the specs from the sibling service checkouts into `specs/`
- [x] Specs copied in (v0.1.0 drafts first), validated, and reviewed as generator input (including name collisions across services)
- [ ] Stage manifest and API keys (`tests`, `admin`) available for `dev` and `prod`
- [ ] Stage readiness check across the three services, with a per-version spec check and an opt-in Aurora warm-up
- [ ] Local mocks so library work is never blocked on AWS (request and response behavior only, not the event-driven flows)
- [ ] Backend's planned v1.1.0 (non-breaking) changes and its `v2` specs (added beside `v1`) mapped to their effect on generated clients

### Phase 2: Generation pipeline

- [ ] `@openapitools/openapi-generator-cli` as a dev dependency, version pinned in `openapitools.json`
- [ ] One generator entry per service, output to `src/generated/<service>/`
- [ ] `generate` script with validate, clean, generate, format steps
- [ ] `generate:check` that fails when committed output is stale
- [ ] Determinism test: two runs, identical output
- [ ] Several API versions of one service generated side by side (`<service>-service-v<N>.yaml`), proven with fixture specs (decision record 0013)
- [ ] Custom Mustache template overrides only if the Phase 2 decision rule justifies them (default is none)

### Phase 3: Client facade and configuration

- [ ] Document the call shape: one request object in, `{ status, headers, data }` out, no throw on HTTP error statuses
- [ ] Typed facade over generated API classes, no hand edits per endpoint
- [ ] Version segment in the facade (`apitest.ordersService.v1.orders.getOrder`, with `v0` for the operational routes) and a per-version spec version check
- [ ] Environment config and selection, fed by the backend's stage manifest
- [ ] Auth providers: static API key in `x-api-key` (the Storefront default), plus none, bearer, and custom function, with named caller types (`tests`, `admin`)
- [ ] Warm-up hook for services with cold dependencies (an idle Aurora database)
- [ ] Feature flags: a pluggable read-only flag provider (static map, environment variable, LaunchDarkly), flags resolved once per run, and helpers that skip a test with a stated reason (decision record 0014)
- [ ] Stretch: automatic bearer token acquisition and refresh (OAuth2 client credentials) when no API key is configured, built and tested against a mock OAuth2 server first
- [ ] Middleware: correlation id, redacted logging, timeouts, opt-in retries
- [ ] Protected-environment guard
- [ ] Unit tests for all of the above

### Phase 4: Test authoring with vitest

- [ ] Vitest config: global setup, reporters, and the `smoke` and `full` project recipe for consuming projects
- [ ] Fixtures: client, unique ids, cleanup registry
- [ ] Test data builders typed from generated models
- [ ] Example suites against an in-process stub service: lifecycle, negative cases, pagination, auth, idempotency, cleanup proof, warm-up (the Storefront suites are written in the backend project)
- [ ] Example suites for API versions and feature flags, against the stub service, with a run summary of tests skipped for a flag
- [ ] Stretch: token refresh suite against a mock OAuth2 server
- [ ] Proof that a removed or changed operation, a `v1` to `v2` migration, or a retired version fails at typecheck

### Phase 5: Spec-change workflow, CI, release

- [ ] `copy-specs` extended to copy the stage manifest, plus documented update steps
- [ ] Breaking-change detection on spec changes, including an added or removed API version of a service
- [ ] CI: lint, typecheck, unit, generate-check and the example suites. The scheduled smoke run against `prod` belongs to the backend project, with a recipe in `docs/backend-setup.md`
- [ ] Semver rules driven by spec diff, changelog entry per release
- [ ] Publish pipeline and an example consumer project
- [ ] Generator and template upgrade workflow: separate pull requests, drift check on `openapitools.json` and `templates/`, tooling entries in the changelog
- [ ] Scripted demo: v1.0.0, v1.1.0 (non-breaking), `v2` added beside `v1` (non-breaking for the library), then `v1` retired (breaking)

### Phase 6: Polish

- [ ] README with pipeline diagram and quick start
- [ ] Short demo recording or annotated transcript
- [ ] Measured claims (time to add an endpoint, hand-written vs generated lines)
- [ ] Repo hygiene, AWS teardown instructions
