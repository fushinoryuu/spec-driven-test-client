# 0005: Auth model

- Status: Accepted
- Date: 2026-10-30

## Context

The Storefront services authenticate with API Gateway API keys sent in the `x-api-key` header. The backend issues separate keys per caller type: `tests` (for almost everything), `admin` (for the shipping simulation endpoint) and `services` (service-to-service calls, which tests must never use). Other services use bearer tokens, and a library meant to be reused needs to fit them without a rewrite. Keys are shared secrets, and a leaked key in CI output is a real incident.

## Options considered

1. **Static API key only.** Matches the demo, but other schemes would need a redesign.
2. **Pluggable provider function, with a static API key in `x-api-key` as the default.** One extension point, and the demo works out of the box.
3. **Built-in OAuth2 token handling from the start.** Realistic, but the demo backend has no token issuer, and it needs a mock server and a lot of code before the first test runs.

## Decision

Option 2. An auth provider is a function `(context) => headers | Promise<headers>`. Built-ins are a static API key (header name configurable, default `x-api-key`), none, a bearer token from an environment variable, and a custom async function with token caching. Providers can be set per service and per environment.

Named caller types select the secret: `tests` is the default, and `admin` is requested explicitly, for example `apitest.as('admin')`, so ordinary tests never hold admin credentials. The `services` caller type is not supported, and the library never loads that key.

Secrets come from environment variables or the test runner's secret store, never from files in the repo. The variable names are `APITEST_<ENV>_<CALLER>_API_KEY` (for example `APITEST_DEV_TESTS_API_KEY`), where `APITEST` follows the placeholder library name and changes if it is renamed. A local untracked `.env` file may set them. Keys never appear in logs.

Automatic bearer token acquisition and refresh (OAuth2 client credentials) is a **stretch goal**, built and tested against a mock OAuth2 server first. It is not part of the baseline, and the deployed demo keeps using API keys.

## Consequences

- The baseline needs no identity provider and costs nothing.
- Redaction of auth headers needs unit tests (Phase 3).
- The stretch goal fits the same provider interface. If a real identity provider is ever used, which one is a backend decision, recorded in decision record 0009 (written only if the stretch goal is pursued).
- Provider selection is explicit: when nothing is configured, startup fails with a message listing what is missing. The library never silently sends no credentials, unless the provider is set to `none`.
