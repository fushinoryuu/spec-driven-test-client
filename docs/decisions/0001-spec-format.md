# 0001: Spec format

- Status: Accepted
- Date: 2026-10-30

## Context

The library's input is an OpenAPI document per service. The Storefront backend writes its specs as OpenAPI 3.0.3 and publishes them as standalone, bundled YAML files. The input format decides which generators qualify, how specs are diffed (Phase 5), and how the library and the backend agree on a contract.

## Options considered

1. **OpenAPI 3.0.3, YAML on disk.** Matches what the backend publishes. Generators handle 3.0.x well.
2. **OpenAPI 3.1.** Aligns with JSON Schema, but the backend does not use it, and generator support varies by tool.
3. **Swagger 2.0.** Older format that nothing in this project needs.
4. **JSON on disk.** Same content as YAML, but harder to read in diffs and reviews.

## Decision

Specs are OpenAPI 3.0.3 documents stored as YAML in `specs/`, one standalone bundled file per service, named `<service>-service.yaml` (for example `orders-service.yaml`). The file name gives the facade name (`ordersService`). `specs/sources.json` records where each spec came from (see [0007](0007-spec-source.md)).

The library never edits a spec locally. If a spec is wrong, it is fixed in the backend project and pulled again.

## Consequences

- OpenAPI 3.0.3 is a hard requirement in the generator spike ([0002](0002-generator.md), written by the spike ticket). A candidate that does not handle it cleanly is out.
- Moving to OpenAPI 3.1 later needs a new decision record and a check of the generator choice.
- Spec diffs in pull requests are readable, and Phase 5 can classify changes from parsed YAML.
- Specs must be self-contained, with no external `$ref` files, so the generator and the diff tool need no extra files.
