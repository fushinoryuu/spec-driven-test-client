# 0006: Publish target

- Status: Provisional. Confirmed in Phase 5.
- Date: 2026-10-30

## Context

The library is meant to be installed by test projects, so it needs a registry. Nothing in Phases 0 to 4 depends on the choice: until the first publish, `package.json` stays `"private": true` and consumers use the repo directly. The choice affects the package name, who can install it, and how the release workflow authenticates, so it is written down now and confirmed when the release pipeline is built.

## Options considered

1. **Public npm.** Anyone can install it with no setup, and it supports provenance statements for builds from CI. The package name must be free on npm, and everything published is public and cannot be fully taken back.
2. **GitHub Packages (npm registry).** Lower stakes for a demo, and it publishes with the repository's own token. Packages live under the owner's scope, so the package name would need a scope (such as the GitHub account name), and consumers need registry configuration and a token to install. Check the current rules for these points in Phase 5.

## Decision

Not made yet, on purpose. Both options stay open until Phase 5, where the release workflow is built and the choice is recorded here with the facts checked at that time (name availability, install friction, provenance support, cost).

Until then:

- `package.json` keeps `"private": true`, so nothing can be published by accident.
- The library has no runtime need for a registry. The example consumer (Phase 5) installs from a packed tarball in CI either way.
- Before the first publish, run the clean-room check in [clean-room.md](../clean-room.md) and inspect the tarball with a dry run.

## Consequences

- If GitHub Packages is chosen, the package name changes to a scoped name, which touches `package.json`, the README and the docs.
- If public npm is chosen, the name must be checked for availability first, and the license (`GPL-3.0-only`) is public with the package.
- Phase 5 updates this record's status to Accepted and fills in the decision.
