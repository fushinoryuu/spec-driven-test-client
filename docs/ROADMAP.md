# Spec-Driven Integration Test Client: Roadmap

A TypeScript library, run with vitest, that generates a typed client for every backend service from its OpenAPI spec so integration tests can call the services like ordinary functions. The central idea: **updating the library is "change the spec, rerun the generator, publish."**

## The target experience

```ts
import { expect } from 'vitest';
import { apitest, expectStatus } from 'spec-driven-test-client';

// library . service . endpoint group (spec tag) . operation (operationId)
// Every call takes one request object and returns { status, headers, data }.
// HTTP error statuses do not throw, so a negative test asserts on the status.
const version = await apitest.ordersService.version.getVersion();
expect(version.status).toBe(200);

const created = await apitest.customersService.customers.createCustomer({
  createCustomerRequest: { firstName: 'Jane' }, // field names come from the generated request type
});
const customer = expectStatus(201, created); // the typed body, or a failure naming the status and correlation id

const missing = await apitest.ordersService.orders.getOrder({ orderId: 'does-not-exist' });
expect(missing.status).toBe(404);
```

Point the same tests at an environment with `TEST_ENV=dev` or `TEST_ENV=prod`. The backend's `dev` stage exists only while one of its pull request runs is deployed, and `prod` is flagged protected, so it is read-only (smoke tests only) unless explicitly unlocked. The services authenticate with API keys sent in the `x-api-key` header, chosen per caller type (`tests` by default, `admin` only where a test needs it). A stretch goal adds automatic bearer token acquisition and refresh, for services that use tokens instead of keys.

## Assumptions

- The specs are **OpenAPI 3.0.3** specs, the version the backend uses. The generator is chosen by the Phase 0 spike, with no default. OpenAPI Generator (the Java jar, usually run through the `@openapitools/openapi-generator-cli` npm wrapper) is one candidate, alongside TypeScript-native generators.
- The project has its own name, examples and specs, all invented for the Storefront demo.
- The demo backend is the Storefront backend ([storefront-backend](https://github.com/fushinoryuu/storefront-backend), see its roadmap): three AWS microservices built with CDK, customers on Aurora, orders on DynamoDB, and shipping driven by events. Each publishes an OpenAPI 3.0.3 spec, and the three specs are the library's input. It lives in its own project and its API uses API Gateway API keys. It has two stages: `dev`, which each of its pull request runs deploys and destroys, and `prod`, which stays up. Its draft specs (v0.1.0) come first, and each spec reaches v1.0.0 when its service ships.

## Phases

| Phase | Doc | Outcome |
|---|---|---|
| 0 | [Foundations and decisions](roadmap-phases/phase-0-foundations.md) | Repo, tooling, decision records, generator spike |
| 1 | [Demo target](roadmap-phases/phase-1-demo-target.md) | Consume the three Storefront specs, stage manifest, and API keys |
| 2 | [Generation pipeline](roadmap-phases/phase-2-generation-pipeline.md) | One command turns specs into typed clients |
| 3 | [Client facade and configuration](roadmap-phases/phase-3-client-facade.md) | `apitest.service.group.operation()` plus environments, auth, safety |
| 4 | [Test authoring with vitest](roadmap-phases/phase-4-vitest-integration.md) | Fixtures, cleanup, example integration tests |
| 5 | [Spec-change workflow, CI, release](roadmap-phases/phase-5-spec-change-and-release.md) | Spec change to published version, automated |
| 6 | [Polish](roadmap-phases/phase-6-polish.md) | Docs, demo, measured results |

## Checklist

### Phase 0: Foundations and decisions
- [ ] Repo skeleton, TypeScript strict, ESM, lint and format
- [ ] Decision records: spec version, generator, generated-code strategy, facade strategy, auth, publish target, call shape
- [ ] Generator spike (OpenAPI Generator `typescript-fetch` and `typescript-axios`, plus at least one TypeScript-native generator for comparison), with no default generator
- [ ] Java requirement handled if OpenAPI Generator is chosen (local, CI, and Docker fallback)

### Phase 1: Demo target
- [ ] Contract agreed with the backend project: three specs with stable `operationId` and `tag` values, a shared error schema, an `apiKey` security scheme, `GET /version` on every service
- [ ] Specs pulled in (v0.1.0 drafts first), validated, and reviewed as generator input (including name collisions across services)
- [ ] Stage manifest and API keys (`tests`, `admin`) available for `dev` and `prod`
- [ ] Stage readiness check across the three services, with an opt-in Aurora warm-up
- [ ] Local mocks so library work is never blocked on AWS (request and response behavior only, not the event-driven flows)
- [ ] Backend's planned v1.1.0 (non-breaking) and v2.0.0 (breaking) spec changes mapped to their effect on generated clients

### Phase 2: Generation pipeline
- [ ] `@openapitools/openapi-generator-cli` as a dev dependency, version pinned in `openapitools.json`
- [ ] One generator entry per service, output to `src/generated/<service>/`
- [ ] `generate` script with validate, clean, generate, format steps
- [ ] `generate:check` that fails when committed output is stale
- [ ] Determinism test: two runs, identical output
- [ ] Custom Mustache template overrides only if the Phase 2 decision rule justifies them (default is none)

### Phase 3: Client facade and configuration
- [ ] Document the call shape: one request object in, `{ status, headers, data }` out, no throw on HTTP error statuses
- [ ] Typed facade over generated API classes, no hand edits per endpoint
- [ ] Environment config and selection, fed by the backend's stage manifest
- [ ] Auth providers: static API key in `x-api-key` (the Storefront default), plus none, bearer, and custom function, with named caller types (`tests`, `admin`)
- [ ] Warm-up hook for services with cold dependencies (an idle Aurora database)
- [ ] Stretch: automatic bearer token acquisition and refresh (OAuth2 client credentials) when no API key is configured, built and tested against a mock OAuth2 server first
- [ ] Middleware: correlation id, redacted logging, timeouts, opt-in retries
- [ ] Protected-environment guard
- [ ] Unit tests for all of the above

### Phase 4: Test authoring with vitest
- [ ] Vitest config: global setup, projects (smoke and full), reporters
- [ ] Fixtures: client, unique ids, cleanup registry
- [ ] Test data builders typed from generated models
- [ ] Example suites: smoke, CRUD lifecycle, negative cases, pagination, auth
- [ ] Stretch: token refresh suite against a mock OAuth2 server
- [ ] Proof that a removed or changed operation fails at typecheck

### Phase 5: Spec-change workflow, CI, release
- [ ] `sync-specs` script and documented update steps
- [ ] Breaking-change detection on spec changes
- [ ] CI: lint, typecheck, unit, generate-check, and a scheduled or on-demand smoke run against `prod`
- [ ] Semver rules driven by spec diff, changelog entry per release
- [ ] Publish pipeline and an example consumer project
- [ ] Generator and template upgrade workflow: separate pull requests, drift check on `openapitools.json` and `templates/`, tooling entries in the changelog
- [ ] Scripted demo: v1.0.0 to v1.1.0 to v2.0.0

### Phase 6: Polish
- [ ] README with pipeline diagram and quick start
- [ ] Short demo recording or annotated transcript
- [ ] Measured claims (time to add an endpoint, hand-written vs generated lines)
- [ ] Repo hygiene, AWS teardown instructions
