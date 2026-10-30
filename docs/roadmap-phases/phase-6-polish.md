# Phase 6: Polish

Make the project easy to understand and easy to try. A reader should get the idea in two minutes, see the "update the spec, regenerate, publish" story working, and find every claim backed by something in the repo.

## Goals

- A README that explains the idea, shows it working, and gets someone running quickly.
- A short demo of the core story.
- Measured claims instead of adjectives.
- A clean, safe, shareable repo.

## Deliverables

| Deliverable | Location |
|---|---|
| Final README | `README.md` |
| Pipeline and architecture diagram | `docs/architecture.md` (Mermaid) |
| Demo recording or annotated transcript | `docs/demo/` |
| Measured results | `docs/results.md` |
| Decision records, finalized | `docs/decisions/` |
| Limitations and roadmap | `docs/limitations.md` |
| Resume bullets and interview notes | kept outside the repo |

## Tasks

### 1. README

- [ ] A one-paragraph summary: what the library is and the problem it solves (hand-written clients for many services drift and cost time).
- [ ] The target experience snippet from the roadmap, right at the top.
- [ ] A diagram of the pipeline: specs, validate, generate, facade, tests, publish.
- [ ] Quick start: prerequisites (Node, Java or Docker), install, generate, run the smoke tests against the mock or `prod`.
- [ ] "Add a service" and "Update a spec" in a few lines each, linking to the runbook.
- [ ] Configuration reference: environments, auth (API keys, and bearer tokens if the stretch goal is built), protected environments, logging.
- [ ] Testing section: unit, integration, smoke versus full.
- [ ] Design notes: why generated clients, why a facade, why commit generated code, why a protected-environment guard, and why there are no custom generator templates (or which overrides exist and why).
- [ ] Badges for CI and package version.

### 2. Demo

Pick one format and do it well.

- **Short screen recording or GIF**, under two minutes: edit the spec, run generate, show the new method appear in the editor, write a test, run it against the mock or a deployed `dev` stage.
- **Annotated transcript** of the same sequence with callouts.

Include the breaking-change moment, where `tsc` points at the tests that no longer match the spec. It shows the value faster than any description.

- [ ] Script it so it is repeatable.
- [ ] Use only the Storefront demo and invented data. Never show an API key in the recording or the README.

### 3. Measured results

Only claim what you measured.

- [ ] Time from "spec changed" to "new operation callable in a test," from the Phase 5 rehearsal.
- [ ] Lines of hand-written library code versus lines of generated code for the demo services.
- [ ] Number of operations covered, and how many required zero hand-written client code.
- [ ] What happened on the breaking change: how many tests were flagged at typecheck, and how long it took to fix them.
- [ ] Note the generator version, date, and machine for the numbers, and include the command to reproduce them.

### 4. Limitations

An honest limitations page builds credibility.

- [ ] What the library does not do (non-REST protocols, specs with unsupported features, response validation beyond what is implemented).
- [ ] Known generator quirks encountered and how they were handled.
- [ ] Generator upgrades change generated code, and any template overrides add work to every upgrade. Say how upgrades are handled (Phase 5).
- [ ] What would change at larger scale (many services, spec registry, parallel test sharding, per-team config).

### 5. Repo hygiene

- [ ] Secrets scan across files and history.
- [ ] Confirm that nothing from work appears anywhere: names, URLs, specs, code structure that is distinctive, commit messages.
- [ ] Re-read `docs/clean-room.md` and the employer's policy one more time before making the repo public.
- [ ] Remove dead code, stale TODOs, and unused scripts.
- [ ] License file and repository description and topics.
- [ ] Verify a fresh clone follows the README without help.
- [ ] AWS: the budget alarm, throttling, and teardown instructions live in the backend project, so confirm they are in place and link to them. Decide whether to leave the Storefront stack running or provide mocks for visitors. Because the services use API keys, do not leave a working key anywhere public.

### 6. Resume and interview material

Draft bullets in this shape and adjust to what was actually built and measured:

- Built a spec-driven integration test library in TypeScript that generates typed clients for backend services from OpenAPI specs, so a spec update reaches a published package version with one command and no hand-written client code.
- Designed a runtime facade, environment and auth configuration, and a protected-environment guard that blocks writes to production-like targets by default.
- (If the stretch goal is built) Added automatic OAuth2 client-credentials token acquisition and refresh, with single-flight refresh and a mock identity provider test harness.
- Automated spec change handling in CI: generated-code drift checks, breaking-change detection with enforced semantic versioning, and an example consumer that validates the published package.
- Built the demo target: a three-service AWS backend (Aurora, DynamoDB, and event-driven services, CDK in TypeScript) that publishes an OpenAPI contract per service.

Prepare short answers for:

- [ ] Why generate clients instead of hand-writing them?
- [ ] What happens when the spec and the real API disagree, and how do you detect it?
- [ ] How do you stop tests from damaging a real environment?
- [ ] How do you handle breaking changes across many services and consumers?
- [ ] What would you change to run this for 50 services?
- [ ] Where does generated code hurt, and how did you handle it?
- [ ] When would you override generator templates, and what does that cost you?
- [ ] How does the library handle expired tokens without flaky tests? (if the stretch goal is built)

## Acceptance criteria

- A stranger can read the README, watch the demo, and run the smoke tests in under ten minutes.
- Every claim in the README and on the resume maps to something in the repo: a test, a measurement, or a script.
- The repo contains no work-specific content and no secrets.

## Risks and notes

- **Overclaiming.** Report measured numbers with their conditions. If the original library was faster or broader, do not imply the replica matches it.
- **Scope creep.** If earlier phases are thin, ship a smaller feature set with better documentation instead of adding features.
- **Cost surprise.** Check the AWS bill and the budget alarm before sharing the repo widely.
