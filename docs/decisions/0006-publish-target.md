# 0006: Publish target

- Status: Provisional, leaning to public npm. Confirmed in Phase 5.
- Date: 2026-10-30

## Context

The library is meant to be installed by test projects, so it needs a registry. Nothing in Phases 0 to 4 depends on the choice: until the first publish, `package.json` stays `"private": true` and consumers use the repo directly. The choice affects the package name, who can install it, and how the release workflow authenticates, so it is written down now and confirmed when the release pipeline is built.

## Options considered

1. **Public npm.** Anyone can install it with no setup, and it supports provenance statements for builds from CI. The package name must be free on npm, and everything published is public and cannot be fully taken back.
2. **GitHub Packages (npm registry).** Lower stakes for a demo, and it publishes with the repository's own token. Packages live under the owner's scope, so the package name would need a scope (such as the GitHub account name), and consumers need registry configuration and a token to install. Check the current rules for these points in Phase 5.

## Decision

**Leaning to public npm**, because it is the easier and free choice. It stays provisional until Phase 5, where the release workflow is built and the choice is confirmed here with the facts checked at that time (name availability, install friction, provenance support, cost).

Why it leans that way:

- The unscoped name `spec-driven-test-client` was free on npm when this was written (2026-10-30), so the package keeps the plain name that `npm install spec-driven-test-client` implies.
- Consumers need no configuration. `npm install` reads the default registry, so a test project's `package.json` and `.npmrc` stay as they are.
- npm can use more than one registry at the same time, because a scope can be mapped to its own registry in `.npmrc` (for example `@owner:registry=https://npm.pkg.github.com`). GitHub Packages relies on that: the package must be scoped, and installing it needs that mapping plus an authentication token, even for a public package. That is one more setup step for every consumer and every CI job.

Until then:

- `package.json` keeps `"private": true`, so nothing can be published by accident.
- The library has no runtime need for a registry. The example consumer (Phase 5) installs from a packed tarball in CI either way.
- Before the first publish, inspect the tarball with a dry run.

## Consequences

- If GitHub Packages is chosen, the package name changes to a scoped name, which touches `package.json`, the README and the docs.
- If public npm is chosen, the name must be checked for availability first, and the license (`GPL-3.0-only`) is public with the package.
- Phase 5 updates this record's status to Accepted, confirms or reverses the leaning, and adds the facts checked at that time.
