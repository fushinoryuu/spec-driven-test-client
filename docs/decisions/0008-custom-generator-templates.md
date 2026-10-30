# 0008: Custom generator templates

- Status: Accepted
- Date: 2026-10-30

## Context

If the chosen generator is OpenAPI Generator, it builds its output from Mustache templates, and any of them can be overridden by pointing the generator at a folder of replacement files. That is powerful and expensive: every override must be merged by hand when the generator version changes, and it hides generator behavior inside the repo. Most things people want from templates can be done more cheaply elsewhere.

## Options considered

1. **No overrides by default, with a decision rule for exceptions.** Fewest moving parts, and exceptions are justified in writing.
2. **Override templates freely for ergonomics.** Quick wins now, but a growing upgrade cost and drift from the generator.
3. **Fork the generator.** Maximum control, and a maintenance burden this project cannot justify.

## Decision

Option 1. The default is **no template overrides**. An override is allowed only when the problem is not solved by any earlier step. Work down this list and stop at the first step that solves it:

1. **Generator options** (`additionalProperties`): naming, ES module settings, single request parameter and similar.
2. **The facade** (Phase 3, [0004](0004-facade-strategy.md)): call shape, grouping and ergonomics.
3. **Transport hooks** (Phase 3): headers, auth, logging, retries, timeouts and error wrapping, through the runtime's custom fetch and middleware support.
4. **The spec**, in the backend project: names, tags, `operationId` values and schema shapes are often better fixed at the source.
5. **Templates**, only when the change must apply inside every generated file or class and none of the above can do it (for example, a different base error type thrown by every operation).

Templates are not for things the facade can do, for one-off tweaks, or as a substitute for regex post-processing.

When an override is justified, it lives in `templates/<generator>/` and contains only the changed files. Each file starts with a comment saying what changed, why, and which generator version it is based on. `templates/README.md` lists every override and its reason, aiming for three or fewer. A pipeline test asserts the behavior each override creates, and the drift check ([0003](0003-generated-code-in-git.md)) covers the rest. The record of what was tried at steps 1 to 4 and why it was not enough is added to this record when an override is made.

If the spike ([0002](0002-generator.md)) picks a TypeScript-native generator, there are no Mustache templates. The same rule then applies to whatever customization mechanism that generator offers.

## Consequences

- No `templates/` folder exists until an override is justified.
- Generator upgrades follow the procedure in Phase 2: export the default templates for the old and new versions, diff them, merge into each override, regenerate and review the diff in its own pull request.
- CI treats changes under `openapitools.json` and `templates/` as triggers for the drift check and the full test run (Phase 5).
