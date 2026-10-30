# 0010: Call shape

- Status: Accepted
- Date: 2026-10-30

## Context

Test authors call operations thousands of times, and they test failures as often as successes. Two things hurt in generated clients:

- **Positional parameters.** Adding a parameter early in a signature silently shifts the meaning of arguments, and many tests break at once. Long argument lists are also hard to read.
- **Throwing on non-2xx statuses.** A 404 or 409 is an expected outcome in a negative test, not an exception, and wrapping every such call in a try/catch hides the status and headers the test wants to assert on.

## Options considered

1. **Generator default.** Whatever the generator emits, which varies by tool and usually throws on errors.
2. **One request object in, body out, throwing on errors.** Fixes the parameter problem only.
3. **One request object in, `{ status, headers, data }` out, no throw on HTTP error statuses.** Fixes both, at the cost of a normalization wrapper.

## Decision

Option 3.

- **Inputs:** one request object per call. Path, query and header parameters and the body are named fields of that object, and the field names come from the generated request type. There are no positional parameters. An operation with no parameters takes no argument.
- **Return value:** `{ status, headers, data }`, typed as a union discriminated by `ok` (true for 2xx). On success, `data` is the operation's success model. Otherwise `data` is the parsed error body (the shared error schema), or text or `unknown` when the body is not that shape, as with API Gateway's own responses. Reading a success field needs narrowing: check `ok`, or use `expectStatus`, which returns the typed body. `expect(response.status).toBe(200)` works on any response.
- **Failures:** HTTP error statuses do not throw. A library error is thrown only when there is no HTTP response: a network error, a timeout, or the protected-environment guard blocking a write. That error carries the request summary and correlation id, and has no status.

```ts
const found = await apitest.customersService.customers.getCustomer({ customerId });
const customer = expectStatus(200, found); // typed body

const missing = await apitest.customersService.customers.getCustomer({ customerId: 'unknown' });
expect(missing.status).toBe(404);
```

## Consequences

- These are hard requirements for the generator spike ([0002](0002-generator.md)), checked for every candidate: a single request object per call is available by option or by default, status and headers are available without throwing on non-2xx, and OpenAPI 3.0.3 is handled cleanly ([0001](0001-spec-format.md)). A candidate that needs hand edits to generated code to meet one is out.
- The facade ([0004](0004-facade-strategy.md)) holds a normalization wrapper around every generated method. How it works depends on the generator: call the raw-response variants (fetch-style clients) or turn off status validation (axios-style clients). The wrapper is written once, never per endpoint.
- Helpers `expectStatus` and `expectProblem` make asserting a 404 or 409 one line, and a mismatch fails with the request summary, status, error body and correlation id.
- Narrowing by `ok` is one extra step when reading a success body. That is accepted to keep negative tests simple.
- Documented for users in `docs/client-api.md` (Phase 3).
