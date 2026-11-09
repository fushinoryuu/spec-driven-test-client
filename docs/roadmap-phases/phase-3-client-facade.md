# Phase 3: Client Facade and Configuration

The generated code gives you one API class per spec tag. This phase wraps it so test authors write `apitest.ordersService.v1.orders.createOrder(...)`, switch environments with one variable, and cannot accidentally write to a protected environment.

## Goals

- A single entry point that exposes every generated service, endpoint group, and operation with full type inference.
- No hand-written code per endpoint. Adding an operation to a spec adds it to the facade automatically.
- Environment, auth, and safety handled in one place, not in every test.
- A call shape that suits tests: one request object in, `{ status, headers, data }` out, and no throw on HTTP error statuses (decision record 0010).

## Deliverables

| Deliverable                                      | Location                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Facade and service registry                      | `src/client/facade.ts`, `src/client/services.ts`                                                         |
| Environment config                               | `src/client/config.ts`, `config/environments.ts` (created in Phase 1 with base URLs only, extended here) |
| Auth providers                                   | `src/client/auth.ts`                                                                                     |
| Fetch wrapper (middleware)                       | `src/client/transport.ts`                                                                                |
| Call normalization and response type             | `src/client/response.ts`                                                                                 |
| Protected-environment guard                      | `src/client/safety.ts`                                                                                   |
| Feature flag providers and helpers               | `src/client/flags.ts`                                                                                    |
| Public exports                                   | `src/index.ts`                                                                                           |
| Unit tests                                       | `tests/unit/client/`                                                                                     |
| API reference doc (including versioned services) | `docs/client-api.md`                                                                                     |
| Feature flag guide                               | `docs/feature-flags.md`                                                                                  |

## Public API shape

The public shape is `library.service.version.group.operation(request)`. Map it to the spec:

| Part             | Comes from                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apitest`        | the library's exported client                                                                                                                                                                                                                                                                                                                          |
| `.ordersService` | the service (one registry entry per service). The name comes from the spec file name without the version suffix, so `orders-service-v1.yaml` becomes `ordersService`                                                                                                                                                                                   |
| `.v1`            | the API version. It comes from the suffix of the spec file (`orders-service-v1.yaml`). `v0` is the reserved operational spec of each service. Every Storefront service is versioned. A spec file with no suffix has no version segment, which stays supported for services that are not versioned (decision record 0013). See Versioned services below |
| `.orders`        | the endpoint group (an OpenAPI `tag`, which becomes a generated API class)                                                                                                                                                                                                                                                                             |
| `.getOrder(...)` | the operation (`operationId`)                                                                                                                                                                                                                                                                                                                          |

The Storefront services give calls such as `apitest.customersService.v1.customers.createCustomer(...)`, `apitest.ordersService.v1.orders.createOrder(...)`, and `apitest.shippingService.v1.shipments.getShipment(...)`. The operational routes are on `v0`, in a group called `operations`: `apitest.ordersService.v0.operations.getVersion()` and, on customers, `apitest.customersService.v0.operations.getReadiness()`. The `Service` suffix avoids the awkward `apitest.customers.customers` reading when a service and its main tag share a name.

### Call shape (decision record 0010)

- **Inputs:** one request object per call. Path, query and header parameters and the body are named fields of that object, and the field names come from the generated request type. There are no positional parameters, so adding a parameter to an operation never shifts the meaning of existing arguments or breaks existing calls. An operation with no parameters takes no argument.
- **Return value:** `{ status, headers, data }`. The type is a union discriminated by `ok` (true for 2xx). On success `data` is the operation's success model. Otherwise `data` is the parsed error body (the shared error schema), or text or `unknown` when the body is not that shape, as with API Gateway's own responses. Reading a success field directly needs narrowing: check `ok`, or use `expectStatus`, which returns the typed body. `expect(response.status).toBe(200)` works on any response.
- **Failures:** HTTP error statuses do not throw. A library error is thrown only when there is no HTTP response: a network error, a timeout, or the protected-environment guard blocking a write.

```ts
const found = await apitest.customersService.v1.customers.getCustomer({ customerId });
const customer = expectStatus(200, found); // typed body

const missing = await apitest.customersService.v1.customers.getCustomer({ customerId: 'unknown' });
expect(missing.status).toBe(404);
```

## Design

### Facade over generated classes

The generator emits one class per tag, typically named `<Tag>Api`, each taking a `Configuration`. The facade instantiates them for you and exposes them by lower-cased tag name.

The facade is step 2 of the Phase 2 decision rule for shaping generated output, and the transport hooks below are step 3. Use them before reaching for custom generator templates.

- [ ] Registry: one line per service mapping a name to the generated module of each of its versions (`ordersService: { v0: () => import('../generated/orders-service-v0'), v1: () => import('../generated/orders-service-v1') }`), or auto-discovery from `src/generated/*`, where the folder name gives the service and the version.
- [ ] Mapped types so the facade is fully typed with no codegen of its own: take the keys of the generated module that end in `Api`, strip the suffix, lower-case the first letter, and map to `InstanceType` of the class. The mapped type also rewrites each operation's signature to the call shape above (one request object in, response object out). Verify this works with the chosen generator's export style in the Phase 0 spike.
- [ ] Call normalization: a runtime wrapper around each generated method turns the generator's result into `{ status, headers, data }` without throwing on HTTP statuses. How depends on the generator chosen: call the raw-response variants (fetch-style clients) or turn off status validation (axios-style clients). The hand-written code lives in the wrapper, never per endpoint.
- [ ] Lazy construction: API classes are created on first access and share one `Configuration` per service per environment.
- [ ] Result: adding an operation or a tag to a spec, regenerating, and rebuilding makes it appear in autocomplete with no facade edits. Adding a whole service is one registry line.

### Versioned services

Every Storefront service is versioned (decision record 0013, written in Phase 2). The version is a segment between the service and the group, taken from the spec file name, so `orders-service-v1.yaml` gives `apitest.ordersService.v1`. `v0` is the reserved operational spec of each service, with the health, version and (customers only) readiness operations. The API version is not the spec's `info.version` and not the package version (decision record 0012): those change over time, while API versions coexist. The Storefront adds `/v2` next to `/v1` in its Phase 5, so until then only the fixtures (a small stub service with `v0`, `v1` and `v2` specs) show two business versions side by side.

```ts
await apitest.ordersService.v0.operations.getVersion(); // operational: which spec versions the service serves
await apitest.ordersService.v1.orders.getOrder({ orderId }); // business, version 1
await apitest.ordersService.v2.orders.getOrder({ orderId }); // business, version 2 (once the backend ships it)
```

- [ ] The registry derives the service and its versions from the spec file names (`<service>-service-v<N>.yaml`). Adding a version is dropping in a spec file and regenerating, with no per-version code. A spec file with no suffix is a service with no version segment, kept for fixtures and for services that are not versioned.
- [ ] Mapped types add the version segment for a versioned service. Each version carries its own request and response types, so a field that exists only in `v2` is a type error on `v1`, and `.v3` on a service with two versions is a type error.
- [ ] One `Configuration` per service, version and environment. All versions share the service's base URL by default, because the version is part of the path in the spec, and config can override a base URL for one version.
- [ ] Auth, the protected-environment guard, logging, timeouts and the warm-up hook apply to every version of a service the same way, with per-version overrides only where config sets them.
- [ ] A clear error when a version is unknown at run time (for example a version named in a base URL override), listing the versions that exist.
- [ ] **Version check.** The readiness check and global setup compare each entry of `specVersions` (from `GET /v0/version`) with the `info.version` of the spec whose file suffix matches the key. They match by suffix, never by the major of `info.version`, because the 0.x business drafts use `/v1`. A prefix that the service serves but the library has no spec for, or the other way round, is reported.
- [ ] No `latest` alias: `v0` is operational, so "the highest version" is ambiguous, and a test names the version it exercises.
- [ ] Unit tests with the fixture specs and the stub service: both business versions are callable and reach their own paths, `expectTypeOf` shows different request types per version, a spec with no suffix has no version segment, an unknown version fails clearly, and the version check reports a missing or extra prefix.

### Environments

- [ ] A config file maps `{ environment: { service: baseUrl } }` plus flags per environment (`protected`, `allowWrites`). `prod` is flagged `protected`. `dev` is not.
- [ ] Base URLs normally come from the backend's stage manifest (service names, base URLs per stage, secret names, deployed spec versions), loaded at startup. A checked-in static config is the fallback when the manifest is unavailable, which is the case until the backend publishes it (its Phase 5). The `dev` stage is recreated on every backend pull request run, so its URLs change each time: read the manifest at the start of every run and never cache URLs between runs.
- [ ] Selection order: explicit `createClient({ env })` argument, then `TEST_ENV` environment variable, then a default (`dev`).
- [ ] Base URLs can be overridden per service by environment variable for ad hoc targets (for example a local mock or a preview deployment).
- [ ] Clear error when an environment or service is unknown, or not currently deployed (for example `dev` outside a backend pull request run), listing the valid options.

### Auth

- [ ] An auth provider is a function `(context) => headers | Promise<headers>`, so any scheme fits.
- [ ] Built-ins: static API key (header name configurable, default `x-api-key`, which is what the Storefront backend uses), none, bearer token from an environment variable, and a custom async function (for fetching a token). Automatic bearer token acquisition and refresh is the stretch goal described below.
- [ ] Token caching with expiry for the custom-function provider, so tests do not fetch a token per request. A static API key needs no caching.
- [ ] Per-service and per-environment overrides.
- [ ] **Named caller types.** The backend issues separate keys for `tests` and `admin` (and `services`, which tests should never use). Config maps a caller type to a secret per environment, with `tests` as the default. A test that needs admin behavior, such as advancing a shipment through the simulation endpoint, asks for an admin client explicitly, for example `apitest.as('admin').shippingService.v1.simulation.advanceShipment(...)`. An admin client is created only on request, so ordinary tests never hold admin credentials.
- [ ] Secrets come from environment variables or the test runner's secret store, never from files in the repo. Keys are retrieved after deploy by the backend's key retrieval script and are never printed. Environment variables are named `APITEST_<ENV>_<CALLER>_API_KEY` with the environment and caller type in upper case, for example `APITEST_DEV_TESTS_API_KEY` and `APITEST_PROD_ADMIN_API_KEY` (`APITEST` follows the placeholder library name). A local untracked `.env` file may set them. The `services` caller type is not supported: the library never loads that key.

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

**Where tokens could come from.** The library only needs an OAuth2 client-credentials token endpoint. Which provider issues the tokens, and any authorizer the backend's APIs would need, are backend decisions outside this library's scope. Cost is the open question, so the options are listed with it:

| Option                                                                                                       | Cost                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock OAuth2 server inside the tests (for example the `oauth2-mock-server` npm package)                       | Free                  | Supports client credentials and refresh grants, starts in-process from a test, and lets you change token expiry and claims before signing, which makes expiry and refresh easy to test. Its tokens cannot be verified against a real issuer, so this proves the library, not a backend. Recommended for building and testing this feature                                                                                                                                                                                                                                                 |
| Keycloak (or similar) in Docker on your machine                                                              | Free                  | A realistic identity provider for local demos. Heavier to run and not part of a hosted demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Amazon Cognito user pool with a resource server and client credentials                                       | Small, but not zero   | When checked in late October 2026, M2M token requests were charged per successful token response (the pricing page example is $0.00225 per request in US East), with no free tier for token requests and no monthly charge per app client (that charge was removed in November 2025). A pool with no end users stays within the free monthly active user tier. With in-memory caching a test run requests only a couple of tokens, so a demo should cost cents. Check current pricing and keep the budget alarm. It also means the backend must add a Cognito authorizer to its REST APIs |
| Another hosted identity provider that supports client credentials (for example Microsoft Entra ID)           | Check current pricing | Limits and terms change, so check before relying on one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A small token endpoint you write yourself (a Lambda that signs short-lived tokens, plus a Lambda authorizer) | Pennies               | Works for a demo, but it is hand-rolled auth. Label it demo-only and never present it as a pattern to copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Keep API keys on the deployed demo and show bearer tokens only against the mock server                       | Free                  | The least effort, and it still demonstrates the library capability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Recommendation:** build and test the token provider against the mock server. Decide later, as a separate optional step, whether to wire a real identity provider into the backend. That choice belongs to the backend project, because it would need a token issuer and a matching authorizer. Record it in decision record 0009 if it is ever made.

**Stretch tasks:**

- [ ] Implement the token provider with the cache, safety margin, single flight, and reactive refresh.
- [ ] Unit tests with a fake `fetch` and vitest fake timers: token reuse, refresh before expiry, single flight under concurrency, one retry on 401 and then failure, rejected credentials, missing `expires_in`, and redaction.
- [ ] Integration tests against an in-process mock OAuth2 server and a small stub API that validates bearer tokens: a short token lifetime forces a refresh mid-run, and a revoked token forces a reactive refresh.
- [ ] Give the stub API a tiny spec of its own with a bearer (`http`) security scheme, so the full path from spec to generated client to token-bearing call is exercised.
- [ ] Document the configuration and the options table in `docs/auth.md`.
- [ ] Optional: wire a real identity provider into the backend, run one manual end-to-end test, and record the cost you observed.

**Stretch acceptance criteria:** with no API key configured and a token endpoint configured, the example tests run against the stub API using bearer tokens that refresh automatically. No token or secret appears in logs. The baseline API key flow behaves the same with the feature present or absent.

### Transport and middleware

Whichever generator the spike picks has a hook for a custom transport: the `typescript-fetch` runtime accepts a custom `fetchApi` and middleware in its `Configuration`, and axios-based clients accept an axios instance with interceptors. Use that hook, not a fork of the runtime. Confirm the exact option names during the spike.

- [ ] **Correlation id** header on every request, logged so a failing test can be matched to backend logs.
- [ ] **Logging** of method, path, status, and duration, with auth headers and configured fields redacted. Quiet by default, verbose with an env var.
- [ ] **Timeouts** with a sensible default and a per-call override.
- [ ] **Retries** off by default. When enabled, retry only network errors and 502, 503, 504 on idempotent methods, with a cap, and log every retry so it never hides a real problem. The warm-up call has its own bounded retry rule (see Warm-up).
- [ ] **Safety guard** (below) runs first in the chain.

### Errors and negative testing

Generated clients usually throw on non-2xx responses. This library does not (decision record 0010), because a 404 or 409 is an expected outcome in a negative test.

- [ ] A call returns `{ status, headers, data }` for every HTTP response, success or error. It throws a library error only when there is no HTTP response: a network error, a timeout, or the protected-environment guard blocking a write.
- [ ] Provide `expectStatus(status, response)` and `expectProblem(response, matcher)` helpers (Phase 4 uses them). Both also accept the pending call, so `await` is optional. `expectStatus` returns the typed body, and a mismatch fails with a message that includes the request summary, status, error body, and correlation id. Asserting a 404 or 409 is one line.
- [ ] The library error type for thrown failures carries the request summary and correlation id. It has no status, because there was no response.
- [ ] Cope with responses produced by API Gateway itself (a missing or invalid key returning 403, throttling returning 429). The backend customizes these to the shared error shape, but `data` must still handle a plain gateway body, typed as text or `unknown` and not as the shared error schema.

### Warm-up for cold dependencies

The customers service uses an Aurora Serverless v2 database that can pause when idle. The first request after a pause typically takes about 15 seconds, and 30 seconds or more after a long idle period. The API Gateway integration timeout is 29 seconds by default, and API Gateway returns a 504 when it is exceeded, so a long resume could surface as a 504. The backend's intended design is for the readiness Lambda to give up before the gateway does and return a 503 in the shared error shape, so the library treats both 503 and 504 as "retry". What API Gateway returns if the readiness Lambda times out before the gateway does is unverified, and the retry rule handles it the same way. The backend has not settled whether `prod` may pause at all (its ADR 0007), so the library always plans for a cold first call.

- [ ] An optional per-service `warmup` hook (a call to a readiness operation: `apitest.customersService.v0.operations.getReadiness`, which needs a key and touches the database) that global setup runs before the `full` project, never before `smoke`. It retries on 503 and 504 within an overall time budget of roughly 60 to 90 seconds (a budget, not an attempt count, to cover a resume of 30 seconds or more), honoring a `Retry-After` header in seconds when present. The backend proposes that header but has not put it in the spec yet, so do not depend on it. A cold database then reads as a slow start and not a failure. This is the only place the library retries on those statuses by default.
- [ ] Per-service default timeouts, with a longer allowance for the first call to customers.
- [ ] Retries stay off by default. Warm-up is the intended fix, not blanket retries. Nothing calls the readiness operation on a schedule, because that keeps the database awake, so scheduled `smoke` runs skip warm-up.

### Feature flags

Behavior that sits behind a feature flag differs by environment. A test written for the new behavior fails, or passes for the wrong reason, where the flag is off. The library lets a test ask for a flag, and skip with a stated reason when the flag is in the wrong state (decision record 0014, written in this phase).

The Storefront uses LaunchDarkly, with two environments, `dev` and `prod`. The backend exposes **no endpoint** for flag state, so the library reads it from LaunchDarkly itself, through a provider. The Storefront's flags are plain booleans with no targeting rules, so a flag's state is its environment's `on` value. The library only reads flags and never writes one: every backend pull request run shares the `dev` environment, and the library's runs are not coordinated with them. The backend documents flag-gated behavior in the spec as a response (for example `advanceShipment` returns 404 with a `Problem` when the simulation flag is off), so a test can assert the documented response for whichever state the flag is in. Flag keys are decided in the backend's Phase 1, so the names below are illustrative.

```ts
test('advancing a shipment depends on the simulation flag', async ({ api, flags }) => {
    const response = await api.as('admin').shippingService.v1.simulation.advanceShipment({ shipmentId });
    expect(response.status).toBe(flags.isEnabled('shipment-simulation') ? 200 : 404);
});

test('express shipping is offered', async ({ api, flags }) => {
    flags.require('express-shipping'); // skips with a reason when the flag is off in this environment
    // ...
});
```

- [ ] A flag provider is a function `(flag, context) => boolean | Promise<boolean>`, where the context holds the environment and caller type. Providers are read-only.
- [ ] Built-ins: a static map per environment in the config (the default, and what the stub service uses), an environment variable override named `APITEST_FLAG_<NAME>` for ad hoc runs, a **LaunchDarkly provider**, and a custom async function for any other source.
- [ ] The LaunchDarkly provider reads a flag's state from the LaunchDarkly REST API with a read-only API token (the Reader role should be enough, and the backend confirms it when the token is created). The token comes from an environment variable, is never printed or logged, and is redacted like the other secrets. The project key, the environment key per stage and the flag keys come from config, fed by the backend's hand-off doc. It takes the environment's `on` value, and fails with a clear message for a flag that has targeting rules or is not a boolean, because it supports only the simple flags the Storefront uses. It retries only on rate limiting, with a cap. Check the endpoint and field names against the current LaunchDarkly documentation when building it. Whether REST calls count against the free plan's connection limits is unverified, so check it before relying on it.
- [ ] Flags are resolved once in global setup (Phase 4) and cached for the run, never once per test. The startup message lists the resolved flags for the selected environment.
- [ ] A flag the provider does not know is an error naming the flag and the environment, not a silent "off". A flag declared optional in config may default to off.
- [ ] Helpers: `flags.isEnabled(name)`, `flags.require(name)` and `flags.requireOff(name)`, which skip the test with a reason. Flag names are a union type declared in the config, so a typo fails at typecheck.
- [ ] Skips are visible. The run summary lists the tests skipped because of a flag, grouped by flag, so a flag that quietly disables a whole suite shows up.
- [ ] No flag writes. A provider has no `set`, and nothing in the library changes a flag's state.
- [ ] Document the providers, the helpers and the skip reporting in `docs/feature-flags.md`.

### What the Storefront drafts need from the facade

These come from the spec review in ALP-12 (see the review section of [backend-contract.md](../backend-contract.md#review-of-the-drafts-as-generator-input-alp-12)). The generator does not cover them.

- [ ] **Response headers.** The generated types describe bodies only, so `Retry-After` (seconds, on the 503) and `Location` (on the 201 of `createCustomer`, `addAddress` and `createOrder`) have no type. The `headers` of a call result are read at run time. Provide a small helper for `Retry-After`, which warm-up uses, and keep `Location` available to tests.
- [ ] **A flag-off 404 looks like an unknown id.** `advanceShipment` answers 404 with the same `Problem` and problem `type` whether the simulation flag is off or the shipment does not exist, and the API does not report the flag. A flag-aware test reads the flag state first and uses a shipment that exists, as in the example above.
- [ ] **Caller types are in prose.** The specs say in text that `advanceShipment` and a `listOrders` call without `customerId` need the `admin` key. No machine-readable field says which key a route takes, so the test or the config chooses the caller type (`api.as('admin')`).
- [ ] **`specVersions` is a string map.** Its keys are not typed, so the version check compares them with the spec file suffixes at run time (ALP-13).
- [ ] **Customers `v1` documents no 503** (BEP-31). Until the spec says otherwise, a 503 on a customers business route is an undocumented response, and the facade passes it through like any other status.

### Protected-environment guard

Integration tests that can point at any environment need a seatbelt.

- [ ] Environments flagged `protected` (`prod` is flagged by default) allow only safe methods (GET, HEAD, OPTIONS) by default.
- [ ] Writes to a protected environment require an explicit opt-in that is hard to set by accident (for example both an environment variable and a per-test marker), and are logged loudly.
- [ ] The guard lives in the transport layer, so it applies to every call and a test cannot bypass it.
- [ ] Startup message states which environment is targeted and whether it is protected.
- [ ] Unit tests prove a write to a protected environment is blocked before any network call.

## Tasks

- [ ] Document the call shape (decision record 0010) in `docs/client-api.md`.
- [ ] Implement config loading and environment selection.
- [ ] Implement auth providers (static API key first), caller types, and token caching for custom providers.
- [ ] Implement the warm-up hook and the stage manifest loader.
- [ ] Stretch: implement automatic bearer token acquisition and refresh (see the stretch section above).
- [ ] Implement the transport wrapper with correlation id, logging, timeout, optional retry, and the guard.
- [ ] Implement the facade with mapped types and call normalization, and a typed `createClient` for custom setups.
- [ ] Add the version segment (every Storefront service is versioned) and the per-version spec version check, and write decision record 0013 with the Phase 2 naming rules.
- [ ] Implement the feature flag providers (static map, environment variable, LaunchDarkly, custom function) and helpers, and write decision record 0014.
- [ ] Export a ready-to-use default client for the common case.
- [ ] Write unit tests using a fake `fetch`, covering: environment selection order, unknown environment errors, each auth provider, token caching, redaction, retry rules, the guard, call normalization (HTTP error statuses do not throw), thrown transport errors, the facade's lazy construction, versioned services, and the flag providers (known and unknown flags, one lookup per flag per run, the LaunchDarkly provider against a fake `fetch` including rules it does not support, and the token never appearing in output).
- [ ] Add a type-level test (for example with `expectTypeOf` in vitest) confirming that `apitest.ordersService.v1.orders.createOrder` accepts the generated request type and returns the response object, with `data` typed from the generated models and narrowed by `ok`.

## Acceptance criteria

- A test can call any generated operation through `apitest.<service>.<group>.<operation>()` with full autocomplete.
- Adding an operation to a Storefront spec (for example the planned `getOrderTimeline` in v1.1.0) and regenerating makes it available with zero facade edits.
- Switching `TEST_ENV` changes the target for every call.
- Every versioned service is callable as `apitest.<service>.v1.<group>.<operation>()` (and `.v0` for the operational routes, and `.v2` once it exists), each version with its own types.
- A test that requires a feature flag is skipped, with a reason, when the flag is off, and the unknown-flag and skip-reporting cases are covered by unit tests.
- A write against a protected environment is blocked by default and covered by a unit test.
- Unit tests for config, auth, transport, and the guard pass in CI without network access.

## Risks and notes

- **Type gymnastics.** Mapped types over generated modules can get complicated. Keep them small, tested with `expectTypeOf`, and fall back to a one-line-per-group registry if inference becomes brittle.
- **Hiding too much.** A facade that swallows status codes or headers makes negative tests painful. The response object always carries the status and headers, so negative tests never need a separate raw call.
- **Secrets in logs.** Redaction needs tests, because a leaked API key in CI output is a real incident.
- **Retry masking flakiness.** Retries are off by default for a reason. If they are on, surface the retry count in the test output.
