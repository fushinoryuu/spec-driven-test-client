# CLAUDE.md

Guidance for Claude Code in this repo. The rules themselves are in `docs/`; this file says where to find them and how to work.

## Read first

- `docs/ROADMAP.md` for the plan and `docs/roadmap-phases/` for each phase.
- `docs/decisions/` for why things are the way they are. Do not contradict an accepted record. Change the record itself for a small change, and write a new record that supersedes it only for a major rework.
- `docs/backend-contract.md` for what the Storefront backend has agreed to provide, and what has been checked against its specs.
- `README.md` for the commands and how to run them.
- `TODO.md` at the repo root, if it exists (see below).

## The two repositories

- This repo is the library: it turns OpenAPI specs into typed clients and vitest helpers.
- The Storefront backend is a separate repo, expected as a sibling checkout (`../storefront-backend`). It owns the specs. Its Jira project is BEP, this one is ALP.
- The library follows what the backend publishes. Do not change the backend's files from here.
- A problem in a backend spec is filed as a Bug in the Jira project BEP, with the context, what the docs say, what the generator does, the expected result and acceptance criteria. Never open a GitHub issue for it. Reference the BEP key in `docs/backend-contract.md`.

## How to work

- Every change belongs to a Jira ticket in project ALP. Work on a branch from `main` (after `git pull --ff-only`) named with the ticket key in capitals and a short lowercase slug: `ALP-14-local-mocks`, never `alp-14-...`. Never work on `main`.
- When asked to start a ticket, fetch it from Jira first, even if you read it earlier, because it may have changed. Then plan, do all the work, and hand over (see below).
- One ticket is one pull request. If a change will pass about 500 changed lines (lockfiles and generated code do not count), say so and ask how to split it before building it.
- Do not create, edit or transition Jira tickets unless asked. If a ticket's text is out of date, say so instead of editing it.
- Keep to the ticket's scope. Mention related work instead of doing it. If a pull request does change something the ticket does not cover, list it in the description with the reason.
- Tick a roadmap checkbox only when the work behind it is finished and true. For work that is partly done, leave the box unticked and add sub-bullets that list what is done and what remains.
- Never push. Run `git add` and `git commit` only when asked. The maintainer reviews the diff and commits.
- When you are asked how you will address something, such as a review comment, answer with the plan and wait for the go-ahead before you change anything.
- Prefer a recommendation over a survey. When a choice is open, name the options briefly, say which one you pick and why, and let the maintainer decide.

## Handing work over

When the work for a ticket is built, give the maintainer, in this order:

1. **A summary of the changes.**
2. **How they meet the ticket**, mapped to its acceptance criteria. Say what is not verified.
3. **How to verify them**: the commands to run and what to expect.
4. **The commits, in order, in one code block.** A `git add` and a `git commit -m "..."` for each. Each commit is one logical change. The subject is a plain imperative sentence with no ticket key and no `Co-Authored-By` line.
5. **The branch name** and a pull request title and description:
    - The title starts with the ticket key, then a colon and an imperative sentence (`ALP-14: Add spec-driven mocks of the Storefront services`).
    - The description follows `.github/pull_request_template.md` and starts with the link to the ticket.
    - It lists everything the pull request changes, states its size, and says what is not in it.
    - The description ends with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
    - Update it when the branch changes, so the numbers and the list stay true.

A reviewer's findings are posted as a Jira comment on the ticket. The fixes go on the same branch as new commits, and the pull request description is updated for them.

## TODO.md

`TODO.md` is the maintainer's scratch file. It is in `.gitignore`, so it is never committed and a new machine starts without it.

- Read it at the start of every turn, because the maintainer edits it between messages.
- The "Personal items" section is the maintainer's. Never edit it.
- The "Decisions" section holds questions waiting on the maintainer and things to verify. Add an item when you need an answer and cannot get it now. Update or remove items when they change or are answered, and keep what is already written in the docs, a decision record or Jira out of it.
- It may name tickets.

## Writing

- Docs, ticket text and pull requests are plain and direct. Short sentences, concrete names, no filler. Do not use em dashes.
- Write for a reader who has not seen the conversation. Say what a thing is and why, not how the work went.
- Do not put a secret, an API key value or a credential in a file, a commit, a pull request, a ticket or a log line.

## Rules that are easy to break

- **Specs are copied, never edited.** The files in `specs/` come from the backend through `npm run copy-specs`. Do not edit one by hand. Names are `<service>-service-v<N>.yaml`: `v0` is the operational spec and `v1` is the business API.
- **Generated code is committed and never edited by hand** (decision record 0003). It lives in `src/generated/`, is excluded from lint and format, and is included in the typecheck. A spec change shows up as a generated diff, reviewed in its own pull request.
- **Node runs the `.ts` files directly** (Node 26, type stripping). So no enums or parameter properties, and relative imports end in `.ts`. The module system is ESM with NodeNext. The Node version is in `.nvmrc`.
- **TypeScript stays on `~6.0.3`** until typescript-eslint supports 7. Dependabot ignores the major bump. `@types/node` follows the Node pin.
- **The `minimatch` override** in the root `package.json` stays until the packages that need it release fixes. Drop it then, and run `npm audit`.
- **Stage values live in `config/environments.ts`.** Do not write a stage name or a base URL inline. The stages are `dev`, `prod` and `local` (the mocks).
- **API keys** are read from `APITEST_<STAGE>_<CALLER>_API_KEY` environment variables (for example `APITEST_DEV_TESTS_API_KEY`), sent only where needed and never printed. Never load the `services` key. A `.env` file is untracked.
- **The mocks keep no state** and only enforce what `mock/README.md` lists. Tests that need behavior belong to the stub service (Phase 4) or to the backend project.
- **Prefer socket-free tests.** The mock tests call `respond()` directly, and the few tests that use real sockets have long timeouts. If `npm test` stalls on TCP connects, check the antivirus web shield before the code.
- **Dependencies are a cost.** Check what a package pulls in (audit output, install scripts, analytics packages) before adding it, and say what you found.

## Before you say it is done

Run what CI runs, in this order: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`. Run `npm audit` when `package.json` or the lockfile changed. If one fails or is skipped, say which and show why.

On Windows, run `npm test` from PowerShell. From Git Bash, a working directory with a lower-case drive letter (`cd /d/...` gives `d:\...`) can make vitest fail with "failed to find the runner" or load twice. `cd "D:/..."` with an upper-case letter avoids it.
