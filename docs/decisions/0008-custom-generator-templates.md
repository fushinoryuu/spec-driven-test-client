# 0008: Custom generator templates

- Status: Accepted
- Date: 2026-10-30
- Updated: 2026-11-25 (ALP-17). Rewritten for hey-api, which has plugins and no Mustache templates. The decision rule is unchanged.

## Context

A generator lets you change what it writes in a deeper way than its options. OpenAPI Generator builds its output from Mustache templates, and any of them can be overridden by a folder of replacement files. The chosen generator, hey-api `openapi-ts` ([0002](0002-generator.md)), has no templates. It is built from plugins, and a project can write its own. In both cases an override is powerful and expensive: it must be merged by hand when the generator version changes, and it hides generator behavior inside the repo. Most things people want from one can be done more cheaply elsewhere.

## Options considered

1. **No overrides by default, with a decision rule for exceptions.** Fewest moving parts, and exceptions are justified in writing.
2. **Override or extend the generator freely for ergonomics.** Quick wins now, but a growing upgrade cost and drift from the generator.
3. **Fork the generator.** Maximum control, and a maintenance burden this project cannot justify.

## Decision

Option 1. The default is **no custom plugin**. One is allowed only when the problem is not solved by any earlier step. Work down this list and stop at the first step that solves it:

1. **Generator options**: the plugin options in `openapi-ts.config.mjs` (naming, ES module settings, the flat request object, enums, dates and similar).
2. **The facade** (Phase 3, [0004](0004-facade-strategy.md)): call shape, grouping and ergonomics.
3. **Transport hooks** (Phase 3): headers, auth, logging, retries, timeouts and error wrapping, through the client's custom fetch and interceptors.
4. **The spec**, in the backend project: names, tags, `operationId` values and schema shapes are often better fixed at the source.
5. **A custom plugin**, only when the change must apply inside every generated file or class and none of the above can do it (for example, a different base error type thrown by every operation).

A custom plugin is not for things the facade can do, for one-off tweaks, or as a substitute for post-processing the output.

When one is justified, it is a small piece of code in the repository with a comment saying what it changes, why, and which generator version it was written for. A pipeline test asserts the behavior it creates, and the drift check ([0003](0003-generated-code-in-git.md)) covers the rest. What was tried at steps 1 to 4 and why it was not enough is added to this record when a plugin is written.

## Consequences

- No custom plugin exists, and none is planned.
- **The ALP-12 review of the six Storefront drafts found nothing that needed one**, and steps 1 to 4 solved everything it found:
    - Step 1: the flat request object (`paramsStructure: 'flat'`), the `.js` import extension, one class per tag (`byTags`), and the two open options, enums and dates, which are decided in [0002](0002-generator.md) (both stay at their defaults).
    - Step 1: names shared between specs are solved by one folder per spec ([0011](0011-naming-across-services.md)).
    - Steps 2 and 3: response headers such as `Retry-After` and `Location` have no generated type, so the facade reads them from the response ([Phase 3](../roadmap-phases/phase-3-client-facade.md)).
    - Step 4: the shared error schema was named `Error`, which collides with the JavaScript global in generated code. The backend named it `Problem` ([backend contract](../backend-contract.md)).
- **Generator upgrades follow one procedure.** Change the pinned version in `package.json`, regenerate, and review the generated diff in its own pull request. Dependabot ignores the minor updates of hey-api and keeps its patch updates out of the weekly group, so no upgrade arrives with others. If a custom plugin exists by then, merge any change in the generator it depends on first.
- **CI treats a change to the hey-api version or to `openapi-ts.config.mjs` as a trigger** for the drift check and the full test run (Phase 5).
