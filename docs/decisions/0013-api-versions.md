# 0013: API versions of one service

- Status: Accepted
- Date: 2026-11-25

## Context

Every Storefront service publishes its API in versions. The version is part of the path (`/v1/orders`, and `/v2/orders` beside it later), of the spec file name (`orders-service-v1.yaml`), and of the keys in the `specVersions` object that `GET /v0/version` returns. `v0` is the reserved operational spec of each service (health, version and, on customers, readiness). The backend plans a `v2` for orders and shipping, served next to `v1` ([backend contract](../backend-contract.md)).

The library has to say, in one place, what a version is and where it comes from, because the generator, the facade ([0004](0004-facade-strategy.md)), the version check and the release rules all depend on it. Three different things are called a version, and they change at different times:

- the **API version** of a service (`v1`, `v2`), which coexist and are chosen by a test,
- the **spec's `info.version`** (`0.2.0`, later `1.0.0`), which changes with every edit of the spec,
- the **package version** of this library (decision record 0012, written in Phase 5).

## Options considered

1. **The version comes from the spec file name.** `<service>-service-v<N>.yaml` is version `v<N>` of that service.
2. **The version comes from the major of `info.version`.** `info.version` 1.2.0 would be `v1`.
3. **Merge all versions of a service into one generated module.** The versions would be told apart by operation names.

## Decision

**Option 1.** The rules:

- A spec file named `<service>-service-v<N>.yaml` is version `v<N>` of the service named by the part before `-service`. It is generated into its own folder ([0011](0011-naming-across-services.md)), so models and errors never collide between versions.
- **The version comes from the file suffix, never from `info.version`.** The business drafts are at 0.x and already serve `/v1`, so the major of `info.version` is 0 while the API version is 1. An edit of a spec changes `info.version` and must not move the API version.
- `v0` is the reserved operational spec. For the library it is an ordinary version segment, and nothing is special-cased in the generator or the facade.
- A spec file with no suffix is a service without versions and gets no version segment. The Storefront does not use that form. Fixtures can.
- An API version is not the package version. Adding a version spec is a non-breaking change for the package (a new namespace, so a minor version), and removing one is breaking (a major version). Phase 5 writes this into the release rules.
- There is no `latest` alias. `v0` is operational, so "the highest version" is ambiguous, and a test names the version it exercises.
- The version check compares each key of `specVersions` from `GET /v0/version` with the spec whose file suffix matches the key, and never with the major of `info.version` (Phase 3).

The rules are proven with fixture specs of a small `widgets` service with `v0`, `v1` and `v2` under `tests/fixtures/specs/`, before the Storefront has a `v2` (ticket "Drift check, versioned fixtures and pipeline doc"). The facade adds the version segment in Phase 3.

## Why not the others

- **Option 2** fails on the real specs today: the three `v1` specs are at `info.version` 0.x and serve `/v1` paths. It would also make a spec edit look like an API change.
- **Option 3** removes the point of versions. A test could no longer say `v1` and get exactly the `v1` request and response types, and a field that exists only in `v2` would no longer be a type error on `v1`.

## Consequences

- Adding a version of a service is dropping in its spec file and regenerating. No per-version code exists.
- The file name pattern is part of the contract with the backend. [0007](0007-spec-source.md) already copies the files under these names.
- When the backend retires `v1`, deleting the spec removes `ordersService.v1` from the types, and every test that uses it fails to compile. That is the intended signal, and it is a major version of the package.
