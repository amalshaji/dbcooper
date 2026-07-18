# Dependency audit exceptions

## Root app

### `dagre` -> `lodash` (`GHSA-r5fr-rjxr-66jc`)

- **Audit path**: `dagre@0.8.5` -> `lodash@4.17.21`.
- **Reachability**: `dagre` is used by the schema visualizer for graph layout. The advisory requires attacker-controlled `_.template` import keys; the app only calls dagre's graph layout APIs, and dagre does not call `_.template` in its runtime source.
- **Blocker**: `dagre@0.8.5` is the latest release and has no patched lodash dependency. Replacing it requires a schema-layout migration rather than a safe dependency update.
- **Gate**: `bun run audit:prod` pins Bun, audits production high/critical advisories, and ignores only this documented, currently unreachable advisory. Revisit the exception when dagre publishes a fix, the schema visualizer changes layout engines, or lodash templating becomes reachable.

## Docs site

The docs dependency graph is independently locked by `docs/bun.lock` and is not covered by the root app gate.
