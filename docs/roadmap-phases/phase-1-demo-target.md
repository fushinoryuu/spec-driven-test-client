# Phase 1: Demo Target

The demo target is the Storefront backend, a separate project: three AWS microservices built with CDK (customers on Aurora, orders on DynamoDB, shipping driven by events), each publishing OpenAPI specs. Building the backend has its own roadmap. This phase covers the library's side: agreeing the contract between the two projects, consuming what the backend publishes, checking that it is good input for a generator, and planning how the demo spec changes will affect generated clients.

The backend publishes draft specs (v0.1.0, its Phase 0.5) before anything is deployed, and each business spec reaches v1.0.0 as its service ships (its Phases 2 to 4). The library's input moves from the Phase 0 throwaway spec, to the drafts, to the v1.0.0 specs, and each move is a re-pull and a regenerate. Until endpoints are deployed, use the local mocks described below.

Every Storefront service publishes its API in versions. The version is part of the path (`/v1/...`, and later `/v2/...` next to it), part of the spec file name (`orders-service-v1.yaml`), and the major of the spec's `info.version`, except that the 0.x drafts of the business specs use `/v1`. A reserved `v0` prefix holds the operational routes (health, version, and readiness for customers), which describe the deployment and not the business contract. The rules are decision record 0013 (written in Phase 2), and the backend's side is in `docs/backend-contract.md`.

## Goals

- The backend's real specs as the library's input, with their source recorded.
- A clear list of what the library needs from the backend, checked against what the backend actually provides.
- A readiness check for each environment, including a database that may be cold.
- A verified understanding of how each planned spec change affects the generated clients.
- Library work that can continue when the AWS stages are switched off.

## Deliverables

| Deliverable | Location |
|---|---|
| The backend's OpenAPI specs: a `v0` (operational) and a `v1` (business) spec for each of the three services, six files at first | `specs/<service>-service-v<N>.yaml`, for example `specs/customers-service-v0.yaml` and `specs/customers-service-v1.yaml` |
| Spec source record (backend ref, spec version, and pull date for each spec) | `specs/sources.json` |
| Contract checklist with gaps | `docs/backend-contract.md` |
| Stage readiness check | `scripts/check-stage.ts` |
| Local mocks | `mock/` |
| Effect of planned spec changes | `docs/demo-script.md` (section per change) |

## What the library needs from the backend

| Need | Details | Comes from |
|---|---|---|
| Specs | OpenAPI 3.0.3 as standalone bundled files named `<service>-service-v<N>.yaml`, `info.version` bumped on every change, stable `operationId` for every operation, one `tag` per endpoint group, a shared error schema named `Problem` on 4xx and 503 responses, an `apiKey` security scheme (header `x-api-key`), examples on every request body and response, no `servers` entry, no API Gateway integration extensions, and `oneOf` or `anyOf` only with a discriminator | Backend published specs (v0.1.0 drafts from its Phase 0.5, v1.0.0 as each service ships). Bundles are committed on the backend's `main`, which the library pulls from until a CI artifact exists |
| API versions and operational routes | `/v1/...` for the business API, and `/v2/...` beside it later. The operational routes live under the reserved `/v0` prefix, in their own small spec per service, and the `v1` and `v2` specs contain no health or version routes. The suffix of the file, the path prefix and the key in `specVersions` agree | Backend (decided in its replies of 2026-11-02) |
| Stage manifest | Service names, base URLs per stage, secret names per caller type, deployed spec versions per service | Backend published manifest (its Phase 5; until then the library uses a static config) |
| API keys | `tests` for everything, `admin` for the shipping simulation endpoint. The `services` key is for service-to-service calls and tests should never use it | Backend key retrieval script, stored as environment variables or CI secrets |
| Version and health | `GET /v0/version` and `GET /v0/health` on every service, open (no key required). The version response has the build id, the stage, and `specVersions`, an object keyed by prefix that lists every prefix the service serves, for example `{"v0": "0.1.0", "v1": "0.1.0"}` | Backend shared construct |
| Cold-database readiness | Customers `getReadiness` (`GET /v0/health/ready`). It needs an API key, touches the database, and returns 503 with a `Retry-After` header (seconds) while the database resumes. Used by warm-up only | Backend customers service |
| Feature flags | LaunchDarkly, with two environments (`dev` and `prod`). **No backend endpoint exposes flag state**, so the library reads it from LaunchDarkly with a read-only REST API token (the Reader role should be enough). Flags are plain booleans with no targeting rules, so a flag's state is its environment's `on` value. The hand-off doc lists the project, environment keys and flag keys, not their state. Flag-gated behavior is documented in the spec as a response (for example `advanceShipment` returns 404 with a `Problem` when the simulation flag is off) | Backend (flag keys are decided in its Phase 1) |
| Planned spec changes | Change notes for v1.1.0 and for the `v2` specs, per service | Backend Phase 5 (integration and contracts), possibly earlier |
| Reporting problems | Spec problems are raised as GitHub issues in the backend repository, and the backend announces a changed draft with its new `info.version` | Backend |

Check each row against the backend's `spec-handoff.md`. Record gaps in `docs/backend-contract.md` and raise them in the backend project instead of working around them in the library.

Bearer tokens are not part of the baseline. If the Phase 3 stretch goal is ever pursued against a real identity provider, the backend would need to add a token issuer and a matching authorizer. That is optional and out of scope for the first pass.

## The three services as the library sees them

Every service has an operational `v0` spec and a business `v1` spec. The facade name is the camel-cased file name without the version suffix, and the version is a segment of the same service.

| Spec files | Facade name | Endpoint groups (tags) | Notable operations |
|---|---|---|---|
| `customers-service-v0.yaml` | `customersService.v0` | `operations` | `getHealth`, `getVersion`, `getReadiness` |
| `customers-service-v1.yaml` | `customersService.v1` | `customers`, `addresses` | `createCustomer`, `getCustomer`, `listCustomers`, `updateCustomer`, `deleteCustomer`, `addAddress`, `listAddresses`, `updateAddress`, `deleteAddress` |
| `orders-service-v0.yaml` | `ordersService.v0` | `operations` | `getHealth`, `getVersion` |
| `orders-service-v1.yaml` | `ordersService.v1` | `orders`, `products` | `listProducts`, `createOrder` (needs an `Idempotency-Key` header), `getOrder`, `listOrders`, `cancelOrder` |
| `shipping-service-v0.yaml` | `shippingService.v0` | `operations` | `getHealth`, `getVersion` |
| `shipping-service-v1.yaml` | `shippingService.v1` | `shipments`, `simulation` | `getShipment`, `listShipments`, `advanceShipment` (admin only) |

Example calls (operation names come from the specs, so treat these as indicative):

```ts
await apitest.customersService.v1.customers.createCustomer({ ... });
await apitest.ordersService.v1.orders.createOrder({ ... });
await apitest.shippingService.v1.shipments.getShipment({ ... });
await apitest.ordersService.v0.operations.getVersion();
await apitest.customersService.v0.operations.getReadiness();
```

The `operations` group holds the health and version routes and, on customers, the readiness operation. The operationIds `getHealth`, `getVersion` and `getReadiness` are confirmed by the backend and checked against the real drafts in the spec review below. Every call returns `{ status, headers, data }` (Phase 3). `listProducts` is a `/v1` route.

## What makes these specs a good test for the generator

Check each of these in the generated output, and note anything the generator handles badly:

- [ ] Enums: order status, shipment status, customer status.
- [ ] Nullable and optional fields, `date-time` values, arrays, and nested objects (order line items).
- [ ] Cursor pagination parameters.
- [ ] A required header parameter (`Idempotency-Key` on `createOrder`) and how it appears in the generated request type.
- [ ] The shared `Problem` schema on 4xx and 503 responses, and the `Retry-After` header on the 503.
- [ ] The `apiKey` security scheme, and how the generated runtime lets you supply the key.
- [ ] The `operations` tag and the `Problem` schema appearing in every service, and the same operationIds (`getHealth`, `getVersion`) in the three `v0` specs. These collide unless each spec is generated into its own folder (Phase 2).
- [ ] Flag-gated responses documented in the spec (such as the 404 `Problem` on `advanceShipment`), and the `specVersions` object on the version response.

## Tasks

### 1. Agree the contract

- [ ] Walk through the "what the library needs" table with the backend's handoff doc. Until it exists (the backend's BEP-19), record "not yet published".
- [ ] Write `docs/backend-contract.md` listing each need, its status (provided, partial, missing, not yet published), and the action if not provided.
- [ ] Write down the naming rule, which the backend confirmed: bundled specs are `<service>-service-v<N>.yaml`, the facade name is the camel-cased file name without the suffix (`ordersService`), and the suffix is the version segment (`v1`).

### 2. Pull the specs once by hand

Before the Phase 5 sync script exists:

- [ ] Copy the latest published specs (v0.1.0 drafts or later) from the backend's `specs/` folder into `specs/`: the `v0` and `v1` file of each of the three services. Record the backend commit and each spec's `info.version` in `specs/sources.json`. The backend keeps its own source record. This file records what the library pulled. The backend publishes the shipping draft first, so try the generator on it early, and pull all of them together for this task.
- [ ] Validate each spec with the generator's `validate` command (or an equivalent) and fix nothing locally. If a spec is wrong, raise it as a GitHub issue in the backend repository and pull it again.

### 3. Review the specs as generator input

- [ ] Using the Phase 0 spike setup, generate all of them and read the output for the items in the checklist above.
- [ ] Sort every problem into: a spec issue (raise it in the backend project), a generator option (record it in decision record 0002), a facade concern (note it for Phase 3), or, as a last resort, a template override (only if the Phase 2 decision rule justifies it).
- [ ] Check the assumptions these docs make about the drafts against the real drafts, and update the affected docs wherever a draft differs: the operationIds `getHealth`, `getVersion` and `getReadiness` and the `operations` tag, `listCustomers` hiding deleted customers (with `status=deleted` showing them), a `Retry-After` header in seconds on the shared 503, the `specVersions` keys matching the file suffixes, and the `/v0` and `/v1` path prefixes.

### 4. Stage readiness check

`scripts/check-stage.ts` (also reused by the testing toolkit in Phase 4, so the backend's own tests can run it in global setup):

- [ ] Until the backend publishes its stage manifest (its Phase 5), read the service base URLs from a minimal static `config/environments.ts` that holds only base URLs per stage. Phase 3 extends that file with the environment flags and auth settings.
- [ ] For each service in the stage manifest, call `GET /v0/health` and `GET /v0/version`. Compare every entry of `specVersions` with the `info.version` of the spec whose file suffix matches the key, and fail on a prefix that the service serves but the library has no spec for, or the other way round. Check that the reported stage matches the selected environment. Both routes are open and never touch the database.
- [ ] With `--warmup` (off by default), call the customers `getReadiness` operation with a long timeout and report how long it took. This route needs a key and touches the database, so it wakes a paused Aurora cluster, which typically takes about 15 seconds and 30 seconds or more after a long pause. While the database resumes the route can return 503 with a retry hint, or the API gateway can time out first, so the warm-up retries on 503 and 504 within an overall time budget (see Phase 3, Warm-up). Never run it on a schedule, because that keeps the cluster awake.
- [ ] Print a table (service, health, each version's deployed and expected spec version, stage, and the readiness time when `--warmup` is used) and exit non-zero on any failure.
- [ ] Never print key values.
- [ ] The library tests the script with a fake `fetch` and fixture specs. Running it against a deployed stage is done by hand, or by the backend's tests, when a stage exists.

### 5. API keys and the flag token

- [ ] Document how to get the keys: run the backend's key retrieval script after deploy, then set the environment variables the library expects (names are defined in Phase 3, Auth) or store them as CI secrets.
- [ ] Expect keys to change. The `dev` stage is recreated on every backend pull request run, so its keys and base URLs differ each time. Take fresh values from the stage manifest and the key retrieval script on every run.
- [ ] Keep keys in an untracked local file, such as `.env`, and make sure it is ignored by git.
- [ ] Only `tests` is needed for most work. Ask for `admin` only when working on the simulation endpoint tests.
- [ ] The flag token is a separate secret. It is a read-only LaunchDarkly REST API token, set by an environment variable the same way, never printed, and never committed. The backend's hand-off doc states which role it needs.
- [ ] Link to the backend's key rotation runbook.

### 6. Local mocks

- [ ] A mock server per service, driven by its `v0` and `v1` specs, so generator, facade, and configuration work does not depend on AWS being up.
- [ ] Know the limits. A spec-driven mock returns example responses but has no state and no cross-service behavior, so an order never becomes `CONFIRMED`. Use the mocks for generator smoke tests, facade and config tests, the example consumer, and demos without AWS. Tests that need behavior (lifecycles, cleanup, idempotency, flags) run against the stub service in Phase 4, and the cross-service flows are tested in the backend project against the real stack.

### 7. Map the planned spec changes to generated clients

The backend plans two kinds of spec change for the demo and writes its change notes in its Phase 5 (it may pull the spec-edit part forward), so until then this table is the library's expectation and not a confirmed contract. For each change, apply it to a copy of the specs, regenerate, and record the real diff. Expected effects:

| Change | Spec change | Effect on the generated client | Example tests affected |
|---|---|---|---|
| v1.1.0, non-breaking | Customers: optional `preferredLanguage` on the customer (in `customers-service-v1`) | Customer model gains an optional property | None |
| v1.1.0, non-breaking | Orders: new `GET /v1/orders/{orderId}/timeline` | New `getOrderTimeline` method on `ordersService.v1.orders` | None. Add one new test |
| v1.1.0, non-breaking | Orders: optional `notes` on order creation | Create-order request model gains an optional property | None |
| v1.1.0, non-breaking | Shipping: optional `carrier` filter on the shipment list | `listShipments` request gains an optional parameter | None |
| `v2`, side by side | Orders: a new `orders-service-v2.yaml` where `createOrder` requires `shippingAddressId` | A new `ordersService.v2` namespace with its own models. `v1` is unchanged, so this is additive for the library | None for `v1` tests. A test or builder migrated to `v2` fails to compile until it supplies `shippingAddressId` |
| `v2`, side by side | Shipping: a new `shipping-service-v2.yaml` where the status value `PICKED` is renamed `PACKED` | `shippingService.v2` has its own status type | None for `v1`. Code that compares a `v2` status with `PICKED` fails to compile |
| Retiring `v1` (later) | Remove `orders-service-v1.yaml` | `ordersService.v1` disappears | Every test that uses it fails to compile. Breaking, so a major version |

- [ ] Verify each row against real generator output. Correct the table where reality differs.
- [ ] Keep the copies of the specs for each version so the Phase 5 demo can replay them.

## Acceptance criteria

- The `v0` and `v1` specs of the three services (v0.1.0 drafts or later) are in `specs/` with a recorded source commit, and each passes validation.
- `docs/backend-contract.md` exists, with every gap either closed or raised in the backend project as a GitHub issue.
- The stage readiness check passes its unit tests (all services healthy, unreachable service, version mismatch per version, stage mismatch, warm-up cases). Run by hand against `prod`, and against `dev` while a dev stack is deployed, it passes, and with `--warmup` it reports the Aurora warm-up time.
- The effect table has been verified by regenerating with the planned changes.

## Risks and notes

- **Dependency on the backend schedule.** The backend has no specs until its Phase 0.5 produces the drafts. The Phase 0 throwaway spec keeps early work moving, and the local mocks start from it too, because a mock needs a spec.
- **Spec and implementation drift.** The library trusts the spec. The backend runs conformance tests, and the version check flags a stage whose `specVersions` do not match the specs.
- **Name collisions across the three services.** The `Problem` schema and the `operations` tag appear in every service, and the same operationIds appear in the three `v0` specs. Each spec is generated into its own folder, and Phase 2 settles the naming strategy early (decision record 0011).
- **Keys are shared secrets.** Keep them scoped, never print or commit them, keep `prod` keys out of CI except the `tests` key for the scheduled smoke job in the backend project, and never load the `services` key. The flag token is a secret too.
- **Slow and eventually consistent flows.** Cold database starts and event-driven status changes make some tests slow. The testing toolkit (Phase 4) handles both with a warm-up hook and polling.
- **Flag state is shared.** Every backend pull request run shares the `dev` LaunchDarkly environment, and the library never writes flags, so its tests cannot change another run's behavior.
