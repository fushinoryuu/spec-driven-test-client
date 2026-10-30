# Spec-Driven Integration Test Client: Roadmap

A TypeScript library, run with vitest, that generates a typed client for every backend service from its OpenAPI spec so integration tests can call the services like ordinary functions. The central idea: **updating the library is "change the spec, rerun the generator, publish."**

`apitest-kit` is a placeholder name used in examples. Rename it freely.

## The target experience

```ts
import { apitest } from 'apitest-kit';

// library . service . endpoint group (spec tag) . operation (operationId)
const version = await apitest.ordersService.version.getVersion();
const customer = await apitest.customersService.customers.createCustomer({ firstName: 'Jane' });
const order = await apitest.ordersService.orders.createOrder({ customerId: customer.id });
```

Point the same tests at any environment with `TEST_ENV=dev` or `TEST_ENV=staging`. Protected environments (such as prod) are read-only unless explicitly unlocked. The services authenticate with API keys sent in the `x-api-key` header, chosen per caller type (`tests` by default, `admin` only where a test needs it). A stretch goal adds automatic bearer token acquisition and refresh, for services that use tokens instead of keys.

## Assumptions to confirm

- "OpenAI specs" and "OpenAI auto generator" are read as **OpenAPI** specs and **OpenAPI Generator** (the Java jar, usually run through the `@openapitools/openapi-generator-cli` npm wrapper). If the original used something else, Phase 0 records the change.
- The portfolio version is a clean rewrite from behavior and design ideas, with its own name and examples. No code, internal names, or internal specs from work. Check your employer's IP policy before publishing.
- The demo backend is the Storefront backend (see the backend roadmap): three AWS microservices built with CDK, customers on Aurora, orders on DynamoDB, and shipping driven by events. Each publishes an OpenAPI spec, and the three specs are the library's input. It is built first, in its own project, and its API uses API Gateway API keys.

## Phases

| Phase | Doc | Outcome |
|---|---|---|
| 0 | [Foundations and decisions](roadmap-phases/phase-0-foundations.md) | Repo, tooling, decision records, generator spike |
| 1 | [Demo target](roadmap-phases/phase-1-demo-target.md) | Consume the three Storefront specs, stage manifest, and API keys |
| 2 | [Generation pipeline](roadmap-phases/phase-2-generation-pipeline.md) | One command turns specs into typed clients |
| 3 | [Client facade and configuration](roadmap-phases/phase-3-client-facade.md) | `apitest.service.group.operation()` plus environments, auth, safety |
| 4 | [Test authoring with vitest](roadmap-phases/phase-4-vitest-integration.md) | Fixtures, cleanup, example integration tests |
| 5 | [Spec-change workflow, CI, release](roadmap-phases/phase-5-spec-change-and-release.md) | Spec change to published version, automated |
| 6 | [Polish](roadmap-phases/phase-6-polish.md) | Docs, demo, resume material |

## Checklist

### Phase 0: Foundations and decisions
- [ ] Repo skeleton, TypeScript strict, ESM, lint and format
- [ ] Clean-room rules written down
- [ ] Decision records: spec version, generator, generated-code strategy, facade strategy, auth, publish target
- [ ] Generator spike (OpenAPI Generator `typescript-fetch` and `typescript-axios`, plus at least one TypeScript-native generator for comparison)
- [ ] Java requirement handled (local, CI, and Docker fallback)

### Phase 1: Demo target
- [ ] Contract agreed with the backend project: three specs with stable `operationId` and `tag` values, a shared error schema, an `apiKey` security scheme, `GET /version` on every service
- [ ] Specs pulled in, validated, and reviewed as generator input (including name collisions across services)
- [ ] Stage manifest and API keys (`tests`, `admin`) available for `dev` and `staging`
- [ ] Stage readiness check across the three services, including the Aurora warm-up
- [ ] Optional local mocks so library work is never blocked on AWS (request and response behavior only, not the event-driven flows)
- [ ] Backend's planned v1.1.0 (non-breaking) and v2.0.0 (breaking) spec changes mapped to their effect on generated clients

### Phase 2: Generation pipeline
- [ ] `@openapitools/openapi-generator-cli` as a dev dependency, version pinned in `openapitools.json`
- [ ] One generator entry per service, output to `src/generated/<service>/`
- [ ] `generate` script with validate, clean, generate, format steps
- [ ] `generate:check` that fails when committed output is stale
- [ ] Determinism test: two runs, identical output
- [ ] Custom Mustache template overrides only if the Phase 2 decision rule justifies them (default is none)

### Phase 3: Client facade and configuration
- [ ] Recover and document the original public API shape (research task)
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
- [ ] CI: lint, typecheck, unit, generate-check, integration (manual or scheduled)
- [ ] Semver rules driven by spec diff, changelog entry per release
- [ ] Publish pipeline and an example consumer project
- [ ] Generator and template upgrade workflow: separate pull requests, drift check on `openapitools.json` and `templates/`, tooling entries in the changelog
- [ ] Scripted demo: v1.0.0 to v1.1.0 to v2.0.0

### Phase 6: Polish
- [ ] README with pipeline diagram and quick start
- [ ] Short demo recording or annotated transcript
- [ ] Measured claims (time to add an endpoint, hand-written vs generated lines)
- [ ] Repo hygiene, AWS teardown instructions
- [ ] Resume bullets and interview answers

## Open questions to settle from memory or research

- What did the original generator output look like, and did it use custom templates?
- Was the `service.group.operation` facade generated or hand-written?
- How was auth handled across services and environments?
- How was it published (private registry?) and consumed (peer dependency on vitest?)
- How many services did it cover, and how were specs obtained (repo, URL, artifact)?
- Did it include test data helpers or cleanup conventions that are worth recreating?
