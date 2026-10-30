# 0004: Facade strategy

- Status: Accepted
- Date: 2026-10-30

## Context

The generator emits one API class per spec tag, each taking a configuration object. Test authors should instead write `apitest.service.group.operation(request)` with full autocomplete, switch environments with one variable, and never wire up classes by hand. Adding an operation, a tag or a service to a spec should make it appear in the facade with no hand-written code per endpoint.

## Options considered

1. **Runtime facade with mapped types over the generated API classes.** At run time, the facade creates the classes lazily and wraps each method. At type level, mapped types take the generated module's `*Api` classes, strip the suffix and rewrite each method signature to the library's call shape ([0010](0010-call-shape.md)). No second code generator.
2. **Generate the facade as code.** A second generation step writes a typed facade file. Types are simple, but there is another generated artifact to keep in sync and to check for drift.
3. **Use the generated classes directly.** No facade code, but every test builds configuration, auth and classes itself, and the call shape is whatever the generator emits.
4. **Hand-write a wrapper per endpoint.** Simple types, but every spec change needs a facade change, which defeats the purpose.

## Decision

Option 1. The facade lives in `src/client/` (Phase 3). Names come from the structure of the specs:

| Part | Comes from |
|---|---|
| service (`ordersService`) | the spec file name, one registry entry per service |
| group (`orders`) | the OpenAPI tag, which becomes a generated API class |
| operation (`createOrder`) | the `operationId` |

Transport concerns (auth, correlation id, timeouts, the protected-environment guard) are applied through the generated runtime's custom fetch or middleware hook, not by forking the runtime.

## Consequences

- The mapped types depend on how the chosen generator exports its classes. The spike ([0002](0002-generator.md)) must verify the mapping works with its output.
- Mapped types can become brittle. They stay small and are covered by `expectTypeOf` tests. If inference breaks down, the fallback is a one-line-per-group registry (still no per-endpoint code).
- Adding a service is one registry line. Adding an operation needs only a spec change and a regenerate.
- The facade is step 2, and the transport hooks step 3, of the decision rule for shaping generated output in [0008](0008-custom-generator-templates.md), so they are tried before any template override.
