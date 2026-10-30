# Clean-room rules

This library is a clean rewrite of an idea: generate a typed client from OpenAPI specs so integration tests call services like ordinary functions. It is built from behavior and design ideas only. Everything in this repo is original work, written for the Storefront demo.

These rules apply to code, tests, specs, test data, documentation, commit messages, pull requests and issues.

## The rules

1. **Recreate behavior and design ideas only.** Do not copy code, file names, package names, internal URLs, service names or specs from work. If a design idea is worth keeping, rewrite it from the idea, in this project's own structure and words.
2. **Invent all examples, specs and test data.** Every example, spec and fixture is made up for the Storefront demo. The demo backend is a separate project with its own invented services (customers, orders and shipping).
3. **Do not mention the employer or internal systems.** Not in code, comments, commit messages, pull requests, issues or docs. This includes names, product names, hostnames and ticket numbers.
4. **Check the employer's IP and outside-work policy before making the repo public.** Do this before the first public push, and again before the first publish to a package registry (Phase 5) and before the final polish (Phase 6).

## How to apply them

- When a design choice comes from memory of how something worked at work, write down the reason it is a good idea (the behavior), not how it was built there. The decision records in [decisions/](decisions/) are the place for that reasoning.
- If a name, URL or snippet looks like it could have come from work, rename or rewrite it. When in doubt, leave it out.
- Do not paste anything from work into an issue, a pull request, an AI prompt or a scratch file in this repo. Scratch files are still files in the working tree.
- If the original project had custom generator templates, treat their contents as work product. Write fresh overrides only when the decision rule in [decision record 0008](decisions/0008-custom-generator-templates.md) says they are needed.

## Before the repo goes public

- [ ] Read the employer's IP and outside-work policy, and get approval if the policy asks for it.
- [ ] Search the whole history, not just the latest commit, for anything the rules above rule out.
- [ ] Re-read this file.
