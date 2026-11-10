# Local mocks

`npm run mock` starts a mock of each Storefront service, built from the specs in `specs/`. Use the mocks when no stage is deployed: generator smoke tests, facade and configuration work, the example consumer and demos. They run on your machine and need no AWS account.

```sh
npm run mock
```

```text
Mocks of the specs in <repo>/specs (example responses, no state):
  customers-service  http://127.0.0.1:4010   v0 0.1.0, v1 0.2.0
  orders-service     http://127.0.0.1:4011   v0 0.1.0, v1 0.1.0
  shipping-service   http://127.0.0.1:4012   v0 0.1.1, v1 0.1.1
Press Ctrl+C to stop.
```

Each service has one mock that serves both its `v0` and its `v1` paths on one base URL. A line is printed for every request. Options (put them after `--`):

| Option             | What it does                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `--port <n>`       | The port of the first service. The others follow in service order. `0` picks free ports. Default 4010 |
| `--stage <name>`   | The stage that `GET /v0/version` reports. Default `local`                                             |
| `--specs <folder>` | The folder with the specs. Default `specs`                                                            |
| `--quiet`          | Do not print a line for every request                                                                 |

The mocks listen on `127.0.0.1` only. They are not reachable from other machines.

## How it works

For a request, the mock finds the operation whose path and method match in any of the service's specs. It then answers with the lowest success response (`200`, `201`, `204`) that the operation defines in its spec. The body is the `example` of the response, or the first of its `examples`, or the `example` of its schema. The headers are the response headers that have an `example` (`Location`, `Retry-After`). The mock reads the specs every time it starts, so a changed spec changes the answers with no change to the code. Restart the mocks after you copy new specs.

To get another response the operation defines, send `Prefer: code=<status>`. For example `Prefer: code=409` gets the `409` example of `createOrder`, and `Prefer: code=503` on `getReadiness` gets the `503` with its `Retry-After`. That is how to try a client's handling of an error.

The backend agreed to put an example on every response that has a body, and a test checks the six specs in `specs/` for it. If a response has a body but no example, the mock answers it with no body and an `x-mock-warning` header, and prints a warning when it starts.

## Limits

The mocks return example responses. They have no state and no cross-service behavior.

- An order never becomes `CONFIRMED`. `createOrder` always returns the example order, and `getOrder` always returns the example order too, whatever id you ask for.
- A created, changed or deleted resource does not show up in the next read. Lists always return the same page, and `nextCursor` is whatever the example says.
- Idempotency is not simulated. The same `Idempotency-Key` with a different body does not answer `409`.
- Feature flags, database pauses and the simulation routes do not exist. `getReadiness` answers `200` straight away.
- The mock never answers `409`, `422`, `429`, `502`, `503` or `504` by itself, because those come from behavior it does not have. Ask for one with `Prefer`.

Behavior like this is tested against the stub service in Phase 4. The Storefront's real behavior is tested in the backend project against the real stack.

### What the mock checks

| The mock checks                                                    | Answer                       |
| ------------------------------------------------------------------ | ---------------------------- |
| The path matches a route of one of the service's specs             | `404` if no route matches    |
| The method is defined for that route                               | `405` with an `Allow` header |
| A route that needs an API key has a non-empty `x-api-key` header   | `403`                        |
| A required query parameter or header is present                    | `400`                        |
| A request body that the spec requires is present and is valid JSON | `400`                        |

Where the operation defines that status, the answer is the example from its spec, so a caller sees the same `Problem` shape as from the real service. Otherwise the mock builds a `Problem` of its own. Every answer the mock decides on its own carries an `x-mock-reason` header that says why.

The mock does **not** check:

- The value of the API key, or which kind of key it is (`tests`, `services`, `admin`). Any non-empty value passes, so a route that needs the `admin` key is not protected from a `tests` key.
- The request body, the query parameters or the path parameters against their schemas: types, enums, ranges, required fields and unknown fields are not validated. A body the real service rejects with `400` gets the success response here.
- That an id exists. `/v1/orders/anything` is answered.

If a test needs one of these checks, it is not a test for the mock. Use the stub service or the real stack.

### One answer that is not copied from the spec

`GET /v0/version` reports `buildId: mock`, the selected stage (`local` unless you pass `--stage`), and `specVersions` built from the `info.version` of the specs the mock serves. The example in the spec has made-up versions that would not match the files next to it, and the stage readiness check would fail against the mock. Everything else in the answer is the spec's example.

## Pointing the stage readiness check at the mocks

`local` is a stage of the readiness check, with the default ports of the mocks in [config/environments.ts](../config/environments.ts):

```sh
npm run mock                                    # in one terminal
npm run check-stage -- local                    # in another
APITEST_LOCAL_TESTS_API_KEY=anything npm run check-stage -- local --warmup
```

Both pass. The key can be any value, because the mock only checks that one is sent. If you start the mocks with `--port`, the URLs in the config no longer match, so use the default ports or change the config.

## Pointing the client at the mocks

The generated clients and the facade do not exist yet (Phases 2 and 3). When they do, the client takes a base URL per service, and the mocks' base URLs go there: for example `http://127.0.0.1:4011` for `orders-service`. The routes already start with `/v0` or `/v1`, so the base URL has no version. Phase 3 adds a base URL override per service by environment variable for this, and extends [config/environments.ts](../config/environments.ts), which already has the `local` stage.

## Why a small server of our own

The mocks are about 500 lines in [server.ts](server.ts) and [start.ts](start.ts), with no dependency beyond the `yaml` package the repository already uses. The tool choice was made in ticket ALP-14.

| Option                                     | Why it was not chosen, or was                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A small server of our own (**chosen**)     | Serves `v0` and `v1` of a service from one base URL, which is how the real services are laid out. No new dependency to audit or keep updated. The behavior is small and written down above. The cost is that we maintain it.                                                                                                                                                                                |
| Stoplight Prism (`@stoplight/prism-cli`)   | The best-known spec-driven mock, with request validation. It serves one spec per process, so the six specs need six processes on six ports, or a proxy in front of them, and that breaks the "one base URL per service" layout. It adds about 20 direct dependencies (and more under them) to a repository that is meant to have a small, audited surface, including an analytics package (`@scarf/scarf`). |
| Mockoon or WireMock                        | Keep their own configuration (in Mockoon, an imported copy of the spec) that has to be kept in step with the specs, and WireMock needs a JVM or Docker. That breaks "change a spec, restart, and the answers change".                                                                                                                                                                                       |
| A mock written inside the generated client | The client then tests itself. The mocks must be independent of the code they are used to check.                                                                                                                                                                                                                                                                                                             |

If the mocks ever need request validation against the schemas, the right step is to put Prism, or a JSON Schema validator, in front of the handler. The handler in `server.ts` is small enough to replace.
