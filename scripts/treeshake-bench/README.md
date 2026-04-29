# Tree-shake bench

Reproducible bundle-size harness for the three published packages in this
monorepo. Each fixture in `fixtures/` is a single-file ESM "consumer"
module. The harness builds it with esbuild (production, minified, ESM,
tree-shaking on, marking every peer/runtime dependency a real consumer
would already have as external) and records:

- raw bytes
- gzipped bytes
- per-module byte contribution to the bundle (top 25)
- module count
- bytes attributable to **this monorepo's** own packages (vs. the small
  amount of esbuild runtime / inlined peer code)

For the SCSS scenario we compile with Dart Sass in compressed mode.

## Scenarios

| File | What it measures |
| --- | --- |
| `fixtures/barrel-one.js` | One named import (`Tearsheet`) from the `@carbon/ibm-products` barrel. |
| `fixtures/barrel-many.js` | Five named imports from the barrel (`AboutModal`, `Tearsheet`, `SidePanel`, `EmptyState`, `StatusIcon`). |
| `fixtures/deep-one.js` | Tearsheet imported via the deepest available subpath (`@carbon/ibm-products/es/components/Tearsheet/Tearsheet.js`). |
| `fixtures/wc-one.js` | One web-components import (`CDSTearsheet` via `@carbon/ibm-products-web-components/es/components/tearsheet/tearsheet.js`). |
| `fixtures/styles-one.scss` | `@use '@carbon/ibm-products-styles/scss/components/AboutModal'` — single component partial. |

## Running

```sh
# 1. Build the published artifacts first.
yarn build:packages

# 2. Run the bench.
node scripts/treeshake-bench/bench.mjs --out baseline.json --label baseline
node scripts/treeshake-bench/bench.mjs --out result.json   --label "after fixes"
```

The output JSON files live next to `bench.mjs`. `baseline.json` is
checked in as the pre-improvement reference; `result.json` is the
post-improvement re-measure.

## Notes / caveats

- All `@carbon/*`, React, lit, dnd-kit, prop-types, classnames, etc. are
  marked external so the numbers reflect only the bytes contributed by
  `@carbon/ibm-products`, `@carbon/ibm-products-styles`, and
  `@carbon/ibm-products-web-components`. A real consumer ships those
  externals once and shares them across the app.
- esbuild honours both the package-level `sideEffects` allowlist and
  `/*#__PURE__*/` annotations, so the harness is sensitive to the
  changes listed in `Phase 3` of the tree-shake initiative.
- The `wc-one` fixture deep-imports because
  `@carbon/ibm-products-web-components` does not currently expose a
  root `"."` entry in its `exports` map. (Documented in the audit.)
