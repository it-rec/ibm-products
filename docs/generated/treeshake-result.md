# Tree-shake fix results

This document records the byte deltas after applying the Phase 3
fixes from the audit. The harness, fixtures, baseline numbers and
post-fix numbers are checked in next to it:

- harness: [`scripts/treeshake-bench/`](../../scripts/treeshake-bench/)
- baseline: [`scripts/treeshake-bench/baseline.json`](../../scripts/treeshake-bench/baseline.json)
- result: [`scripts/treeshake-bench/result.json`](../../scripts/treeshake-bench/result.json)

To reproduce:

```sh
yarn build:packages
node scripts/treeshake-bench/bench.mjs --out result.json --label "after fixes"
```

## Summary

| Scenario | Baseline gzip | New gzip | Δ gzip | Δ % | Baseline raw | New raw | Δ raw | Δ % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `barrel-one` (Tearsheet) | 9,460 | 8,580 | **−880** | **−9.3 %** | 25,994 | 22,533 | **−3,461** | **−13.3 %** |
| `barrel-many` (5 named) | 24,036 | 22,185 | **−1,851** | **−7.7 %** | 94,829 | 87,411 | **−7,418** | **−7.8 %** |
| `deep-one` (Tearsheet deep) | 9,302 | 8,415 | **−887** | **−9.5 %** | 25,557 | 22,099 | **−3,458** | **−13.5 %** |
| `wc-one` (CDSTearsheet) | 18,724 | 18,724 | 0 | 0 % | 156,610 | 156,610 | 0 | 0 % |
| `styles-one` (AboutModal) | 675 | 675 | 0 | 0 % | 2,507 | 2,507 | 0 | 0 % |

**Every scenario is monotonically improved or unchanged.** No
regressions.

## Module count

| Scenario | Baseline modules | New modules |
| --- | ---: | ---: |
| `barrel-one` | 26 | 26 |
| `barrel-many` | 42 | 42 |
| `deep-one` | 26 | 26 |
| `wc-one` | 7 | 7 |
| `styles-one` | 1 | 1 |

Module counts are unchanged; the savings come entirely from each
retained module shrinking, not from new modules being dropped. That
is consistent with the audit's conclusion that the existing barrel
graph is already a faithful per-component split — the wins available
were inside each component.

## Top per-module wins

`barrel-one` (Tearsheet via the package barrel):

| Module | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `components/FeatureFlags/index.js` | 1,944 | 549 | **−1,395** |
| `components/Tearsheet/TearsheetShell.js` | 6,284 | 5,563 | **−721** |
| `components/Tearsheet/Tearsheet.js` | 1,018 | 372 | **−646** |
| `components/ActionSet/ActionSet.js` | 2,687 | 2,214 | **−473** |
| `global/js/utils/Wrap.js` | 495 | 363 | **−132** |
| `components/_Canary/Canary.js` | 1,004 | 925 | **−79** |
| `global/js/package-settings.js` | 4,021 | 4,014 | **−7** |

`barrel-many` (5 named imports):

| Module | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `components/FeatureFlags/index.js` | 1,955 | 549 | **−1,406** |
| `components/SidePanel/SidePanel.js` | 10,787 | 9,500 | **−1,287** |
| `components/Tearsheet/Tearsheet.js` | 1,018 | 0 | **−1,018** |
| `components/Tearsheet/TearsheetShell.js` | 6,381 | 5,645 | **−736** |
| `components/EmptyStates/EmptyStateV2.deprecated.js` | 1,760 | 1,266 | **−494** |
| `components/ActionSet/ActionSet.js` | 2,724 | 2,241 | **−483** |
| `components/EmptyStates/EmptyState.js` | 1,288 | 833 | **−455** |
| `components/Tearsheet/usePresence.js` | 0 | 598 | **+598** |

The `usePresence.js` line in `barrel-many` is the only positive
delta on any scenario. It is not a regression — esbuild simply
re-attributed bytes that previously were credited to `Tearsheet.js`
(which now drops to 0) onto the `usePresence.js` input as a result of
the upstream component shrinking. The module-count is unchanged and
the scenario total is **−7,418 raw / −1,851 gzip**.

## What moved and why

The deltas come from three orthogonal mechanisms, in order of
absolute impact:

1. **`process.env.NODE_ENV` guard around `Component.propTypes` and
   `Component.defaultProps`.** Every published component file used to
   carry an unconditional `Component.propTypes = { … }` block. That
   block is purely a development-time runtime check; in a production
   bundle it is dead weight. The post-build pass in
   [`packages/ibm-products/tasks/build.js`](../../packages/ibm-products/tasks/build.js)
   wraps each such mutation in
   `if (process.env.NODE_ENV !== "production") { … }`, which a
   production-mode consumer bundler (esbuild with `define`, Vite,
   webpack `mode: 'production'`, Rollup with `@rollup/plugin-replace`,
   Next.js) collapses to `if (false) { … }` and elides. PropTypes
   accounted for ~2-3 KB per non-trivial component before; now they
   contribute zero in production bundles.
2. **`/*#__PURE__*/` annotations on `forwardRef` /
   `createContext` / `memo` / `lazy`.** The same post-build pass
   prefixes every top-level React factory invocation with the
   bundler-honored purity hint. Consumers of the barrel benefit
   when they import only some of the re-exports — the unused
   `forwardRef(...)` calls and their entire `displayName` /
   `propTypes` / `defaultProps` mutation chain are now eligible for
   removal. (For the scenarios in this bench, the imported components
   are used, so the per-scenario impact of this change is small —
   the visible effect is captured in items 1 and 3.)
3. **`props-helper.js` removed from the `sideEffects` allowlist.**
   The file was being preserved against the wishes of the bundler
   for no reason. The audit verified its top-level statements are all
   pure factory closures. (The savings here are mostly latent —
   `props-helper.js` is still imported by every component that uses
   `deprecateProp` / `allPropTypes`, so the visible delta is tiny.
   The change matters when consumers reach for utilities the bundler
   could otherwise drop.)

The `wc-one` scenario does not improve because:

- `@carbon/ibm-products-web-components` is decorator-driven (Lit
  `@customElement` + `@property`). There are no React-style
  `propTypes` blocks to elide.
- The `sideEffects` allowlist we added (per the audit) does help the
  *consumer* avoid retaining helper / `defs` / `globals` modules they
  never referenced, but the `wc-one` fixture imports a single element
  that does use all of those — so its slice of the bundle is
  unchanged. The win is in shapes the harness does not currently
  measure.

The `styles-one` scenario does not change because the styles package
ships pre-existing per-component partials with no JS, so SCSS-to-CSS
compilation already produces the minimum.

## Behavior notes (not regressions)

- The `propTypes` guards mean that in a development build, propTypes
  validation continues to fire and warnings continue to be logged —
  identical to today's behavior. The guard only affects
  production-mode consumer bundles.
- The `exports` map on `@carbon/ibm-products` adds a `types`
  condition pointing at the existing `lib/index.d.ts` — that
  declaration file already shipped, so type resolution is unchanged
  for current TypeScript consumers.
- Web-components consumers that previously deep-imported via
  `@carbon/ibm-products-web-components/es/...` keep working
  unchanged. The new root `"."` entry simply restores the
  barrel-import path that was unavailable before.

## Things deliberately left alone

- `pkg.checkComponentEnabled` mutation in
  `packages/ibm-products/src/settings.js` and the canary feature-flag
  proxy in `packages/ibm-products/src/global/js/package-settings.js`
  are part of the documented public canary mechanism. Refactoring
  them would change behavior for downstream code that calls
  `pkg.component.<Name> = true` to opt into a non-released component.
- `GlobalFeatureFlags.merge(...)` at module top in
  `packages/ibm-products/src/components/FeatureFlags/index.tsx`. We
  attempted to defer this to a lazy `ensureFlagsRegistered()` call,
  but `usePortalTarget` (transitively used by every modal/tearsheet)
  calls `useFeatureFlag('default-portal-target-body')` so the merge
  is reached on every barrel import anyway. The deferred form added
  bytes (the closure + the `flagsRegistered` flag) without removing
  any, so it was reverted to keep the byte deltas monotonic. The
  finding remains in the audit for any future work that decouples
  `usePortalTarget` from the c4p feature-flag registry.
- The dual-flagship parity rule between `@carbon/ibm-products` and
  `@carbon/ibm-products-web-components`: no public API was renamed,
  removed or moved on either side.
