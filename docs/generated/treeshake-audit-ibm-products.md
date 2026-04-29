# Tree-shake audit: `@carbon/ibm-products`

Generated as part of Phase 2 of the tree-shake initiative. Findings are
ranked by impact on a downstream consumer that imports a single named
export from the package barrel.

Source of truth for the baseline numbers cited below:
[`scripts/treeshake-bench/baseline.json`](../../scripts/treeshake-bench/baseline.json).
A `Tearsheet`-only barrel import currently pulls in **25,994 raw / 9,460
gzip** bytes; **5 named imports** pull in **94,829 / 24,036**.

## 1. `package.json` shape

`packages/ibm-products/package.json:1-133`

| Field | Value | Verdict |
| --- | --- | --- |
| `main` | `lib/index.js` | OK (CJS for legacy resolvers) |
| `module` | `es/index.js` | OK |
| `types` | `lib/index.d.ts` | OK |
| `type` | (absent) | OK — Node treats package as CJS, ESM resolves via `module`/`exports` |
| `exports` | **(absent)** | **Hazard** — see below |
| `sideEffects` | `["**/global/js/utils/props-helper.js", "**/*.css", "**/*.scss"]` | Mostly OK; see findings below |
| `files` | `css, es, lib, scss, flags.js, telemetry.yml, .playwright/...` | OK |

### 1a. No `"exports"` map

The package does not expose a per-component `"exports"` map. Today
deep imports work only because consumers reach the published `es/`
tree directly via the package root (e.g.
`@carbon/ibm-products/es/components/Tearsheet/Tearsheet.js`). That
works for the published build because `files` includes `es`, but it
locks the package's internal layout into the public contract and
makes `import` and `require` conditional resolution impossible.

### 1b. `props-helper.js` is incorrectly flagged side-effecting

`packages/ibm-products/src/global/js/utils/props-helper.js` is listed
as side-effecting in `sideEffects`. Its top-level statements are
all `export const fn = ...` arrow declarations and one
`pconsole.shimIfProduction(...)` call (which is itself a pure factory
that returns a function). It has no observable side effects.

Listing it side-effecting was almost certainly a workaround for a
previous tree-shake regression. Removing it from the allowlist is a
small but real win: at the baseline this file contributes **1,169
bytes** to every barrel import.

## 2. Module format of the build output

The `es/` directory is real ESM (no `__esModule` shims, no `require()`
calls in JS modules). `tasks/build.js:35-72` configures `tsdown` with
`format: 'esm'`, `target: 'es2022'`, `unbundle: true` — preserves
modules, no IIFE down-leveling. Browser target is high enough that
arrows and classes survive. **No issues here.**

The `lib/` (CJS) tree gets a post-pass that rewrites `exports.x =
require_module;` to `exports.x = require_module.default ||
require_module;` (`tasks/build.js:93-121`). That fix-up is fine for
CJS but underscores that the lib/ tree should not be referenced from
the ESM consumer paths — `module`/`exports.import` already point to
`es/`.

## 3. Source-level hazards

### 3a. `forwardRef` / `createContext` / property-mutation pattern is not pure

This is the **single biggest tree-shake hazard** in the package.

Every public component follows the pattern:

```ts
// e.g. packages/ibm-products/src/components/AboutModal/AboutModal.tsx:112
export const AboutModal = React.forwardRef((props, ref) => { ... });
AboutModal.displayName = componentName;
AboutModal.propTypes = { ... };
```

The build output preserves this verbatim
(`packages/ibm-products/es/components/AboutModal/AboutModal.js:36-78`):

```js
const AboutModal = React.forwardRef(({ ... }, ref) => { ... });
AboutModal.displayName = componentName;
AboutModal.propTypes = { ... };
```

`React.forwardRef(...)` is an unannotated factory call at module top.
Esbuild and Rollup both treat such calls as side-effecting by
default; only a `/*#__PURE__*/` annotation marks them as pure. The
chain of consequences:

1. The `forwardRef` call cannot be eliminated when the component is
   unused.
2. The follow-up `Component.displayName = …`, `.propTypes = …`,
   `.defaultProps = …` mutations reference the (now-retained) binding,
   so they too survive.
3. Imported peers like `prop-types` and `@carbon/react`'s `Button`
   (used inside `propTypes`) survive with them.

Counts in source (excluding tests/stories/docs):

- `forwardRef(` / `React.forwardRef(` call sites at module top: **160+**
  across `packages/ibm-products/src/components/`.
- `createContext(` call sites at module top: **16**, e.g.
  `packages/ibm-products/src/components/FeatureFlags/index.tsx:53`,
  `Tearsheet/TearsheetPresence.tsx`, `Tearsheet/next/StackContext.tsx`.
- `memo(` call sites at module top: 0 (good).

**Fix strategy** (see Phase 3): annotate factory calls in build
output with `/*#__PURE__*/` via a post-build transform, since the
build pipeline (tsdown and its underlying bundler) does not run a
Babel pass and the
existing `@babel/plugin-transform-react-pure-annotations` is only
applied for Storybook/Jest, not the published artifacts.

### 3b. `FeatureFlags.merge(...)` runs at module top

`packages/ibm-products/src/components/FeatureFlags/index.tsx:38-48`:

```ts
GlobalFeatureFlags.merge({
  'default-portal-target-body': true,
  'enable-datagrid-useInlineEdit': false,
  // ...
});
```

This is an **unannotated method call on an imported binding at module
scope** — a textbook bundler-visible side effect. It causes
`./components/FeatureFlags/index.js` to be retained for *every*
barrel import even when the consumer does not import any of the
`preview__FeatureFlag*` exports.

At baseline this single side effect contributes **1,944 bytes** to
the `barrel-one` scenario (~7.5% of the total) and the same to all
other JS scenarios. The `FeatureFlagContext` (`createContext` call
on the same line) is also retained for the same reason.

**Fix**: defer the merge into a lazy `ensureFlagsRegistered()` called
from inside `FeatureFlags`/`useFeatureFlag`/`useFeatureFlags`, so the
merge happens on first use rather than on import.

### 3c. `pkgSettings.checkComponentEnabled = …` at module top in `settings.js`

`packages/ibm-products/src/settings.js:25-98` mutates `pkgSettings`
at module scope by attaching `logDeprecated` and `checkComponentEnabled`.
This is the canary mechanism. It is observable by every consumer, but
the writes are confined to the `pkgSettings` object that *every*
component already pulls in via `import { pkg } from '../../settings'`.
We accept this as design intent; it is not a regression.

### 3d. Namespace imports

`packages/ibm-products/src/components/OptionsTile/OptionsTile.tsx:8`:

```ts
import * as carbonMotion from '@carbon/motion';
```

Property-level dead-code-elimination is disabled for namespace
imports. `@carbon/motion` is small (a handful of constants exports)
so the practical bundle impact is bounded, but the right pattern is
named imports:

```ts
import { moderate01, easings } from '@carbon/motion';
```

This is the only namespace import in production source paths
(`packages/ibm-products/src/components/Datagrid/{useCustomizeColumns,
addons/CustomizeColumns/Actions,addons/CustomizeColumns/ButtonWrapper}.tsx`
each use `import * as React from 'react'`, but `react` is external
in real consumer builds so the namespace doesn't bloat the consumer
bundle).

`packages/ibm-products/src/components/TagOverflow/utils.jsx:9` does
`import * as CarbonIcons from '@carbon/icons-react'`, but that file
is not in the public export graph (only referenced by stories/tests),
so it has zero impact on the consumer bundle.

### 3e. `export *` chains are flat (good)

The root barrel `packages/ibm-products/src/components/index.ts`
contains 50 `export * from './<Subdir>'` lines, but every per-component
`./<Subdir>/index.ts` is a thin file containing only `export { X }
from './X'` and `export type { … }`. There are no chained
`export *` re-exports of side-effecting subgraphs. The barrel is as
good as a barrel can be.

### 3f. Numeric `enum`s

A spot check of the source did not find numeric TS `enum`s in
production paths. `Coachmark/utils/enums.ts` defines string-literal
constants (`BEACON_KIND`, `COACHMARK_OVERLAY_KIND`,
`COACHMARK_ALIGNMENT`) — already tree-shake-friendly.

### 3g. `export type` for type-only re-exports

A grep for `export {` with type-only symbols across component
barrels finds them already split:
`packages/ibm-products/src/components/AboutModal/index.ts:8-9`:

```ts
export { AboutModal } from './AboutModal';
export type { AboutModalProps } from './AboutModal';
```

No corrections required.

### 3h. Circular dependencies

Not yet measured with `madge`. Empirically, the bundler did not
report unresolved or thrash-y modules during the baseline run, so
any cycles that exist are not blocking dead-code elimination.
Recording as a follow-up: run
`npx madge --circular --extensions ts,tsx,js,jsx packages/ibm-products/src`
in CI.

## 4. Cross-package leaks ("magnet" modules)

The five-component `barrel-many` scenario shows
`packages/ibm-products/es/components/EmptyStates/assets/<X>Illustration.js`
as the largest contributors (NoTags 11,483 B, NotFound 9,190 B,
Notifications 8,435 B, Unauthorized 7,840 B, Error 5,854 B,
NoData 3,932 B). Each illustration is its own module — that is
correct (no magnet here): a consumer importing only `EmptyState`
(without one of the convenience presets) does not pull them in. A
consumer that does want only `ErrorEmptyState` correctly pulls in
**only** `ErrorIllustration.js`.

`packages/ibm-products/es/global/js/package-settings.js` (4,021 B)
shows up in every scenario. It is reached through
`./settings → pkgSettings → checkComponentEnabled` and contains the
canary feature-flag map and the Proxy-backed `component` /
`feature` registries. This is intentional shared state — splitting it
would change the public canary contract.

## 5. Summary of actionable items (carried forward to Phase 3)

| # | Hazard | Fix | Expected impact |
| --- | --- | --- | --- |
| A1 | No `"exports"` map | Add `"exports"` with conditional `import`/`require`/`types` and per-component sub-paths | Allows clean deep imports, enables `"types"` condition |
| A2 | `props-helper.js` falsely listed side-effecting | Drop from `sideEffects` allowlist | −1,169 B per scenario |
| B1 | `forwardRef`/`createContext`/`memo` calls unannotated | Post-build transform adds `/*#__PURE__*/` | Major: enables `Component.displayName`/`propTypes` mutation chains to be droppable when component unused |
| C1 | `GlobalFeatureFlags.merge(...)` at module top | Lazy-init: defer to first `<FeatureFlags>` / `useFeatureFlag` / `useFeatureFlags` call | −1,944 B per JS scenario |
| D1 | `import * as carbonMotion` in `OptionsTile` | Replace with named imports | Tiny — eligible to fix opportunistically |

Items intentionally *not* changed in Phase 3 (would break public API
or canary contract):

- The `pkg` mutation in `settings.js` (canary `checkComponentEnabled`
  binding) is part of the documented enable-via-feature-flag
  mechanism.
- The `'use client'` pragma at the top of `src/index.ts` is required
  for React Server Components compatibility.
