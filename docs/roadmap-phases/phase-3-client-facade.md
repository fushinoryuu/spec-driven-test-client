# Phase 3: Client Facade and Configuration

The generated code gives you one API class per spec tag. This phase wraps it so test authors write `apitest.ordersService.orders.createOrder(...)`, switch environments with one variable, and cannot accidentally write to a protected environment.

## Goals

- A single entry point that exposes every generated service, endpoint group, and operation with full type inference.
- No hand-written code per endpoint. Adding an operation to a spec adds it to the facade automatically.
- Environment, auth, and safety handled in one place, not in every test.
- The original public API shape recovered and documented, then matched or deliberately improved.

## Deliverables

| Deliverable | Location |
|---|---|
| Facade and service registry | `src/client/facade.ts`, `src/client/services.ts` |
| Environment config | `src/client/config.ts`, `config/environments.ts` |
| Auth providers | `src/client/auth.ts` |
| Fetch wrapper (middleware) | `src/client/transport.ts` |
| Protected-environment guard | `src/client/safety.ts` |
| Public exports | `src/index.ts` |
| Unit tests | `tests/unit/client/` |
| API reference doc | `docs/client-api.md` |

## Public API shape

The remembered shape was `library.backend-service.version-endpoint.endpoint(inputs)`. Map it to the spec:

| Part | Comes from |
|---|---|
| `apitest` | the library's exported client |
| `.ordersService` | the service (one spec file, one registry entry). The name comes from the spec file name, so `orders-service.yaml` becomes `ordersService` |
| `.version` | the endpoint group (an OpenAPI `tag`, which becomes a generated API class) |
| `.getVersion(...)` | the operation (`operationId`) |

The Storefront services give calls such as `apitest.customersService.customers.createCustomer(...)`, `apitest.ordersService.orders.createOrder(...)`, and `apitest.shippingService.shipments.getShipment(...)`. Every service also has a `version` group. The `Service` suffix avoids the awkward `apitest.customers.customers` reading when a service and its main tag share a name.

Research task for this phase: **recover the real original shape** before locking this in. Write down, from memory or from any notes you have, how a call looked, how inputs were passed (positional, object, or both), what a call returned (parsed body, or a response object with status and headers), and how failures surfaced. Where the memory is fuzzy, pick the better design and record it as a decision.

## Design

### Facade over generated classes

The generator emits one class per tag, typically named `<Tag>Api`, each taking a `Configuration`. The facade instantiates them for you and exposes them by lower-cased tag name.

The facade is step 2 of the Phase 2 decision rule for shaping generated output, and the transport hooks below are step 3. Use them before reaching for custom generator templates.

- [ ] Registry: one line per service mapping a name to its generated module (`ordersService: () => import('../generated/orders-service')`), or auto-discovery from `src/generated/*`.
- [ ] Mapped types so the facade is fully typed with no codegen of its own: take the keys of the generated module that end in `Api`, strip the suffix, lower-case the first letter, and map to `InstanceType` of the class. Verify this works with the chosen generator's export style in the Phase 0 spike.
- [ ] Lazy construction: API classes are created on first access and share one `Configuration` per service per environment.
- [ ] Result: adding an operation or a tag to a spec, regenerating, and rebuilding makes it appear in autocomplete with no facade edits. Adding a whole service is one registry line.

### Environments

- [ ] A config file maps `{ environment: { service: baseUrl } }` plus flags per environment (`protected`, `allowWrites`).
- [ ] Base URLs normally come from the backend's stage manifest (service names, base URLs per stage, secret names, deployed spec versions), loaded at startup. A checked-in static config is the fallback when the manifest is unavailable.
- [ ] Selection order: explicit `createClient({ env })` argument, then `TEST_ENV` environment variable, then a default (`dev`).
- [ ] Base URLs can be overridden per service by environment variable for ad hoc targets (for example a local mock or a preview deployment).
- [ ] Clear error when an environment or service is unknown, listing the valid options.

### Auth

- [ ] An auth provider is a function `(context) => headers | Promise<headers>`, so any scheme fits.
- [ ] Built-ins: static API key (header name configurable, default `x-api-key`, which is what the Storefront backend uses), none, bearer token from an environment variable, and a custom async function (for fetching a token). Automatic bearer token acquisition and refresh is the stretch goal described below.
- [ ] Token caching with expiry for the custom-function provider, so tests do not fetch a token per request. A static API key needs no caching.
- [ ] Per-service and per-environment overrides.
- [ ] **Named caller types.** The backend issues separate keys for `tests` and `admin` (and `services`, which tests should never use). Config maps a caller type to a secret per environment, with `tests` as the default. A test that needs admin behavior, such as advancing a shipment through the simulation endpoint, asks for an admin client explicitly, for example `apitest.as('admin').shippingService.simulation.advanceShipment(...)`. An admin client is created only on request, so ordinary tests never hold admin credentials.
- [ ] Secrets come from environment variables or the test runner's secret store, never from files in the repo. Keys are retrieved after deploy by the backend's key retrieval script and are never printed.

### Stretch: bearer token acquisition and refresh

Real services usually use bearer tokens, not API keys. When no API key is configured for a caller but a token source is, the library gets a token itself, caches it, and refreshes it, so tests never handle tokens by hand. This is a **stretch goal**. The baseline with API keys is complete without it, and the deployed Storefront demo keeps using API keys.

**Provider selection** (per service, per environment, per caller type):

1. An explicit provider in config wins.
2. Otherwise a configured API key is used.
3. Otherwise, if a token endpoint and client credentials are configured, the token provider is used.
4. Otherwise fail at startup with a message listing what is missing. Never fall back to sending no credentials, except for a provider explicitly set to `none`.

**Token flow:** OAuth 2.0 client credentials. The library posts the client id and secret (plus an optional scope or audience) to the token endpoint and reads `access_token`, `expires_in`, and `token_type` from the response.

- [ ] Config per caller type: token endpoint (or an OIDC discovery URL), client id and client secret from environment variables or the secret store, optional scope and audience. The stage manifest may carry the token endpoint and the secret names, never the secrets.
- [ ] In-memory cache keyed by environment, caller type, and scope. Tokens are never written to disk.
- [ ] **Proactive refresh:** treat a token as expired a safety margin before `expires_in` elapses (for example 60 seconds, configurable), to cover clock skew and request latency.
- [ ] **Single flight:** concurrent requests that find an expired token share one in-flight token request.
- [ ] **Reactive refresh:** if a call returns 401 with a token the cache believed valid, force a refresh and retry once. A 401 means the request was not processed, so the retry is safe for every method. Never loop.
- [ ] "Refresh" under client credentials means requesting a new token, because this grant normally returns no refresh token. If a flow does return a `refresh_token`, use the refresh grant first and fall back to a new token request. Treat that as a stretch within the stretch.
- [ ] If `expires_in` is missing, read the `exp` claim from the token payload only to schedule the refresh. Never verify or trust tokens client-side. The server does that.
- [ ] Failure handling: unreachable token endpoint, rejected client credentials, and malformed responses each produce a clear library error naming the caller type and environment, without the secret or token. Retry with backoff for network errors only, with a cap.
- [ ] Logging and redaction: tokens, client secrets, and the `Authorization` header never appear in logs. Extend the redaction tests to cover them.
- [ ] Admin credentials are requested only when an admin client is created, and the protected-environment guard still applies.
- [ ] Global setup acquires tokens up front (Phase 4), so token problems show before the first test.

**Where tokens could come from.** Cost is the open question, so the options are listed with it:

| Option | Cost | Notes |
|---|---|---|
| Mock OAuth2 server inside the tests (for example the `oauth2-mock-server` npm package) | Free | Supports client credentials and refresh grants, starts in-process from a test, and lets you change token expiry and claims before signing, which makes expiry and refresh easy to test. Its tokens cannot be verified against a real issuer, so this proves the library, not a backend. Recommended for building and testing this feature |
| Keycloak (or similar) in Docker on your machine | Free | A realistic identity provider for local demos. Heavier to run and not part of a hosted demo |
| Amazon Cognito user pool with a resource server and client credentials | Small, but not zero | When checked in late October 2026, M2M token requests were charged per successful token response (the pricing page example is $0.00225 per request in US East), with no free tier for token requests and no monthly charge per app client (that charge was removed in November 2025). A pool with no end users stays within the free monthly active user tier. With in-memory caching a test run requests only a couple of tokens, so a demo should cost cents. Check current pricing and keep the budget alarm. It also means the backend must add a Cognito authorizer to its REST APIs |
| Free tier of a hosted identity provider | Free within limits | Limits and terms change, so check before relying on one |
| A small token endpoint you write yourself (a Lambda that signs short-lived tokens, plus a Lambda authorizer) | Pennies | Works for a demo, but it is hand-rolled auth. Label it demo-only and never present it as a pattern to copy |
| Keep API keys on the deployed demo and show bearer tokens only against the mock server | Free | The least effort, and it still demonstrates the library capability |

**Recommendation:** build and test the token provider against the mock server. Decide later, as a separate optional step, whether to wire a real identity provider into the backend. Record the choice in decision record 0009.

**Stretch tasks:**

- [ ] Implement the token provider with the cache, safety margin, single flight, and reactive refresh.
- [ ] Unit tests with a fake `fetch` and vitest fake timers: token reuse, refresh before expiry, single flight under concurrency, one retry on 401 and then failure, rejected credentials, missing `expires_in`, and redaction.
- [ ] Integration tests against an in-process mock OAuth2 server and a small stub API that validates bearer tokens: a short token lifetime forces a refresh mid-run, and a revoked token forces a reactive refresh.
- [ ] Give the stub API a tiny spec of its own with a bearer (`http`) security scheme, so the full path from spec to generated client to token-bearing call is exercised.
- [ ] Document the configuration and the options table in `docs/auth.md`.
- [ ] Optional: wire a real identity provider into the backend, run one manual end-to-end test, and record the cost you observed.

**Stretch acceptance criteria:** with no API key configured and a token endpoint configured, the example tests run against the stub API using bearer tokens that refresh automatically. No token or secret appears in logs. The baseline API key flow behaves the same with the feature present or absent.

### Transport and middleware

The generated `typescript-fetch` runtime accepts a custom `fetchApi` and middleware in its `Configuration`. Use that hook, not a fork of the runtime. Confirm the exact option names against the generated runtime during the spike.

- [ ] **Correlation id** header on every request, logged so a failing test can be matched to backend logs.
- [ ] **Logging** of method, path, status, and duration, with auth headers and configured fields redacted. Quiet by default, verbose with an env var.
- [ ] **Timeouts** with a sensible default and a per-call override.
- [ ] **Retries** off by default. When enabled, retry only network errors and 502, 503, 504 on idempotent methods, with a cap, and log every retry so it never hides a real problem.
- [ ] **Safety guard** (below) runs first in the chain.

### Errors and negative testing

Generated clients usually throw on non-2xx responses and also expose a raw variant that returns the response. Tests need both.

- [ ] Document when to use the normal call (happy path, typed body) and the raw call (inspect status, headers, error body).
- [ ] Provide `expectStatus(status, call)` and `expectProblem(call, matcher)` helpers (Phase 4 uses them) so asserting a 404 or 409 is one line.
- [ ] Wrap thrown errors in a library error type that carries the request summary, status, parsed error body, and correlation id.
- [ ] Cope with responses produced by API Gateway itself (a missing or invalid key, throttling with 429). The backend customizes these to the shared error shape, but the error type should still handle a plain gateway body.

### Warm-up for cold dependencies

The customers service uses an Aurora Serverless v2 database that can pause when idle. The first request after a pause typically takes about 15 seconds, and longer after a long idle period.

- [ ] An optional per-service `warmup` hook (a call to a readiness operation) that global setup runs before any test, with a generous timeout, so a cold database reads as a slow start and not a failure.
- [ ] Per-service default timeouts, with a longer allowance for the first call to customers.
- [ ] Retries stay off by default. Warm-up is the intended fix, not blanket retries.

### Protected-environment guard

Integration tests that can point at any environment need a seatbelt.

- [ ] Environments flagged `protected` (such as prod) allow only safe methods (GET, HEAD, OPTIONS) by default.
- [ ] Writes to a protected environment require an explicit opt-in that is hard to set by accident (for example both an environment variable and a per-test marker), and are logged loudly.
- [ ] The guard lives in the transport layer, so it cannot be bypassed by a test using a raw call.
- [ ] Startup message states which environment is targeted and whether it is protected.
- [ ] Unit tests prove a write to a protected environment is blocked before any network call.

## Tasks

- [ ] Write down the recovered original API shape and the design decisions that depart from it.
- [ ] Implement config loading and environment selection.
- [ ] Implement auth providers (static API key first), caller types, and token caching for custom providers.
- [ ] Implement the warm-up hook and the stage manifest loader.
- [ ] Stretch: implement automatic bearer token acquisition and refresh (see the stretch section above).
- [ ] Implement the transport wrapper with correlation id, logging, timeout, optional retry, and the guard.
- [ ] Implement the facade with mapped types, and a typed `createClient` for custom setups.
- [ ] Export a ready-to-use default client for the common case.
- [ ] Write unit tests using a fake `fetch`, covering: environment selection order, unknown environment errors, each auth provider, token caching, redaction, retry rules, the guard, error wrapping, and the facade's lazy construction.
- [ ] Add a type-level test (for example with `expectTypeOf` in vitest) confirming that `apitest.ordersService.orders.createOrder` accepts and returns the generated types.

## Acceptance criteria

- A test can call any generated operation through `apitest.<service>.<group>.<operation>()` with full autocomplete.
- Adding an operation to a Storefront spec (for example the planned `getOrderTimeline` in v1.1.0) and regenerating makes it available with zero facade edits.
- Switching `TEST_ENV` changes the target for every call.
- A write against a protected environment is blocked by default and covered by a unit test.
- Unit tests for config, auth, transport, and the guard pass in CI without network access.

## Risks and notes

- **Type gymnastics.** Mapped types over generated modules can get complicated. Keep them small, tested with `expectTypeOf`, and fall back to a one-line-per-group registry if inference becomes brittle.
- **Hiding too much.** A facade that swallows status codes or headers makes negative tests painful. Always provide access to the raw response.
- **Secrets in logs.** Redaction needs tests, because a leaked API key in CI output is a real incident.
- **Retry masking flakiness.** Retries are off by default for a reason. If they are on, surface the retry count in the test output.
