# Phase 1: Demo Target

The demo target is the Storefront backend, a separate project: three AWS microservices built with CDK (customers on Aurora, orders on DynamoDB, shipping driven by events), each publishing an OpenAPI spec. Building the backend has its own roadmap. This phase covers the library's side: agreeing the contract between the two projects, consuming what the backend publishes, checking that it is good input for a generator, and planning how the demo spec changes will affect generated clients.

The backend publishes draft specs (v0.1.0, its Phase 0.5) before anything is deployed, and each spec reaches v1.0.0 as its service ships (its Phases 2 to 4). The library's input moves from the Phase 0 throwaway spec, to the drafts, to the v1.0.0 specs, and each move is a re-pull and a regenerate. Until endpoints are deployed, use the local mocks described below.

## Goals

- Three real specs as the library's input, with their source recorded.
- A clear list of what the library needs from the backend, checked against what the backend actually provides.
- A readiness check for each environment, including a database that may be cold.
- A verified understanding of how each planned spec change affects the generated clients.
- Library work that can continue when the AWS stages are switched off.

## Deliverables

| Deliverable | Location |
|---|---|
| Three OpenAPI specs | `specs/customers-service.yaml`, `specs/orders-service.yaml`, `specs/shipping-service.yaml` |
| Spec source record (backend ref, spec version, and pull date for each spec) | `specs/sources.json` |
| Contract checklist with gaps | `docs/backend-contract.md` |
| Stage readiness check | `scripts/check-stage.ts` |
| Optional local mocks | `mock/` |
| Effect of planned spec changes | `docs/demo-script.md` (section per change) |

## What the library needs from the backend

| Need | Details | Comes from |
|---|---|---|
| Specs | OpenAPI 3.0.3 as standalone bundled files named `<service>-service.yaml`, `info.version` bumped on every change, stable `operationId` for every operation, one `tag` per endpoint group, a shared error schema on 4xx responses, an `apiKey` security scheme (header `x-api-key`), no API Gateway integration extensions | Backend published specs (v0.1.0 drafts from its Phase 0.5, v1.0.0 as each service ships) |
| Stage manifest | Service names, base URLs per stage, secret names per caller type, deployed spec version per service | Backend published manifest (its Phase 5; until then the library uses a static config) |
| API keys | `tests` for everything, `admin` for the shipping simulation endpoint. The `services` key is for service-to-service calls and tests should never use it | Backend key retrieval script, stored as environment variables or CI secrets |
| Version and health | `GET /version` and `GET /health` on every service, open (no key required). The version response has the build id, the spec version, and the stage | Backend shared construct |
| Cold-database readiness | Customers `getReadiness` (`GET /health/ready`). It needs an API key, touches the database, and returns 503 with a retry hint while the database resumes. Used by warm-up only | Backend customers service |
| Planned spec changes | Change notes for v1.1.0 and v2.0.0 per service | Backend Phase 5 (integration and contracts) |

Check each row against the backend's `spec-handoff.md`. Record gaps in `docs/backend-contract.md` and raise them in the backend project instead of working around them in the library.

Bearer tokens are not part of the baseline. If the Phase 3 stretch goal is ever pursued against a real identity provider, the backend would need to add a token issuer and a matching authorizer. That is optional and out of scope for the first pass.

## The three services as the library sees them

| Spec file | Facade name | Endpoint groups (tags) | Notable operations |
|---|---|---|---|
| `customers-service.yaml` | `customersService` | `customers`, `addresses`, `version` | `createCustomer`, `getCustomer`, `listCustomers`, `updateCustomer`, `deleteCustomer`, `addAddress`, `listAddresses`, `updateAddress`, `deleteAddress`, `getReadiness` |
| `orders-service.yaml` | `ordersService` | `orders`, `products`, `version` | `listProducts`, `createOrder` (needs an `Idempotency-Key` header), `getOrder`, `listOrders`, `cancelOrder` |
| `shipping-service.yaml` | `shippingService` | `shipments`, `simulation`, `version` | `getShipment`, `listShipments`, `advanceShipment` (admin only) |

Example calls (operation names come from the specs, so treat these as indicative):

```ts
await apitest.customersService.customers.createCustomer({ ... });
await apitest.ordersService.orders.createOrder({ ... });
await apitest.shippingService.shipments.getShipment({ ... });
await apitest.ordersService.version.getVersion();
```

The `version` group also holds the health route and, on customers, the readiness operation. The backend's tag lists contain no separate health tag, so these calls read `apitest.ordersService.version.getHealth()` and `apitest.customersService.version.getReadiness()`. The operationIds `getHealth` and `getVersion` are assumed until the drafts confirm them. Every call returns `{ status, headers, data }` (Phase 3).

## What makes these specs a good test for the generator

Check each of these in the generated output, and note anything the generator handles badly:

- [ ] Enums: order status, shipment status, customer status.
- [ ] Nullable and optional fields, `date-time` values, arrays, and nested objects (order line items).
- [ ] Cursor pagination parameters.
- [ ] A required header parameter (`Idempotency-Key` on `createOrder`) and how it appears in the generated request type.
- [ ] The shared error schema on 4xx responses.
- [ ] The `apiKey` security scheme, and how the generated runtime lets you supply the key.
- [ ] The `version` tag appearing in all three specs, and the shared error schema name appearing in all three. These collide unless Phase 2 handles them.

## Tasks

### 1. Agree the contract

- [ ] Walk through the "what the library needs" table with the backend's handoff doc.
- [ ] Write `docs/backend-contract.md` listing each need, its status (provided, partial, missing), and the action if not provided.
- [ ] Confirm the naming rule with the backend, which plans to name its bundled specs `<service>-service.yaml`. The facade name is the camel-cased file name (`ordersService`).

### 2. Pull the specs once by hand

Before the Phase 5 sync script exists:

- [ ] Copy the three latest published specs (v0.1.0 drafts or later) from the backend's `specs/` folder into `specs/`, and record the backend commit and the spec's `info.version` for each in `specs/sources.json`. The backend keeps its own source record. This file records what the library pulled.
- [ ] Validate each spec with the generator's `validate` command and fix nothing locally. If a spec is wrong, fix it in the backend project and pull it again.

### 3. Review the specs as generator input

- [ ] Using the Phase 0 spike setup, generate all three and read the output for the items in the checklist above.
- [ ] Sort every problem into: a spec issue (raise it in the backend project), a generator option (record it in decision record 0002), a facade concern (note it for Phase 3), or, as a last resort, a template override (only if the Phase 2 decision rule justifies it).

### 4. Stage readiness check

`scripts/check-stage.ts` (also reused by Phase 4 global setup):

- [ ] For each service in the stage manifest, call `GET /health` and `GET /version`, compare the deployed spec version with the spec version the library was generated from, and check that the reported stage matches the selected environment. Both routes are open and never touch the database.
- [ ] With `--warmup` (off by default), call the customers `getReadiness` operation with a long timeout and report how long it took. This route needs a key and touches the database, so it wakes a paused Aurora cluster, which typically takes about 15 seconds and 30 seconds or more after a long pause. While the database resumes the route can return 503 with a retry hint, or the API gateway can time out first, so the warm-up retries on 503 and 504 within an overall time budget (see Phase 3, Warm-up). Never run it on a schedule, because that keeps the cluster awake.
- [ ] Print a table (service, health, deployed version, expected version, stage, and the readiness time when `--warmup` is used) and exit non-zero on any failure.
- [ ] Never print key values.

### 5. API keys

- [ ] Document how to get the keys: run the backend's key retrieval script after deploy, then set the environment variables the library expects (names are defined in Phase 3, Auth) or store them as CI secrets.
- [ ] Expect keys to change. The `dev` stage is recreated on every backend pull request run, so its keys and base URLs differ each time. Take fresh values from the stage manifest and the key retrieval script on every run.
- [ ] Keep keys in an untracked local file, such as `.env`, and make sure it is ignored by git.
- [ ] Only `tests` is needed for most work. Ask for `admin` only when working on the simulation endpoint tests.
- [ ] Link to the backend's key rotation runbook.

### 6. Optional local mocks

- [ ] A mock server per service, driven by its spec, so generator, facade, and configuration work does not depend on AWS being up.
- [ ] Know the limits. A spec-driven mock returns example responses but has no cross-service behavior, so an order never becomes `CONFIRMED`. Use mocks for generator smoke tests, facade and config tests, and demos without AWS. The cross-service flow tests need the real stack.

### 7. Map the planned spec changes to generated clients

The backend plans two spec changes for the demo and writes its change notes in its Phase 5, so until then this table is the library's expectation and not a confirmed contract. For each change, apply it to a copy of the specs, regenerate, and record the real diff. Expected effects:

| Change | Spec change | Effect on the generated client | Example tests affected |
|---|---|---|---|
| v1.1.0, non-breaking | Customers: optional `preferredLanguage` on the customer | Customer model gains an optional property | None |
| v1.1.0, non-breaking | Orders: new `GET /orders/{orderId}/timeline` | New `getOrderTimeline` method on the `orders` group | None. Add one new test |
| v1.1.0, non-breaking | Orders: optional `notes` on order creation | Create-order request model gains an optional property | None |
| v1.1.0, non-breaking | Shipping: optional `carrier` filter on the shipment list | `listShipments` request gains an optional parameter | None |
| v2.0.0, breaking | Orders: `createOrder` requires `shippingAddressId` | Create-order request model gains a required property | Every test and builder that creates an order fails to compile |
| v2.0.0, breaking | Shipping: status value `PICKED` renamed `PACKED` | Shipment status type changes | Code comparing against `PICKED` fails to compile, and the lifecycle test breaks |

- [ ] Verify each row against real generator output. Correct the table where reality differs.
- [ ] Keep the copies of the specs for each version so the Phase 5 demo can replay them.

## Acceptance criteria

- Three specs (v0.1.0 drafts or later) are in `specs/` with a recorded source commit, and each passes validation.
- `docs/backend-contract.md` exists, with every gap either closed or raised in the backend project.
- The stage readiness check passes against `prod`, and against `dev` while a dev stack is deployed. With `--warmup` it reports the Aurora warm-up time.
- The effect table has been verified by regenerating with both planned changes.

## Risks and notes

- **Dependency on the backend schedule.** The backend has no specs until its Phase 0.5 produces the drafts. The Phase 0 throwaway spec keeps early work moving, and the local mocks start from it too, because a mock needs a spec.
- **Spec and implementation drift.** The library trusts the spec. The backend runs conformance tests, and the library's version check in global setup flags a stage that does not match the specs.
- **Name collisions across the three specs.** Shared error schema and `version` tag names will clash in generated code. Phase 2 must settle a naming strategy early (decision record 0011).
- **Keys are shared secrets.** Keep them scoped, never print or commit them, keep `prod` keys out of CI except the `tests` key for the scheduled smoke job, and never load the `services` key.
- **Slow and eventually consistent flows.** Cold database starts and event-driven status changes make some tests slow. Phase 4 handles both with a warm-up hook and polling.
