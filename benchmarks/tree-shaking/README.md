# Tree-shaking benchmark for `@carbon/ibm-products`

Measures the minified (and gzipped) application bundle size that consumers pay
for importing components from `@carbon/ibm-products`, across four bundlers:

- webpack 5 (production mode, terser)
- rollup 4 (`@rollup/plugin-node-resolve` + `commonjs` + `terser`)
- vite powered by rolldown (`rolldown-vite`)
- esbuild

Three entry points are measured (see `src/`):

| Entry     | Imports                                          |
| --------- | ------------------------------------------------ |
| `single`  | `AboutModal` only                                |
| `typical` | `Tearsheet`, `PageHeader`, `TagSet`, `SidePanel` |
| `full`    | `import * as products` (entire public API)       |

Only `react`, `react-dom` and `react-is` are treated as externals; everything
else — including `@carbon/react` — is bundled, which mirrors a real application
build and exposes cross-package duplication.

## Usage

```sh
# from this directory
npm install
# install the library build you want to measure, e.g. a packed tarball:
#   (cd ../../packages/ibm-products && npm pack)
npm install ../../packages/ibm-products/carbon-ibm-products-<version>.tgz
./run-bench.sh <label>   # writes dist/<label>/... and results/<label>.json
```

`results/<label>.json` contains raw and gzip byte sizes per bundler per entry.

## Results: optimization of June 2026

Comparison of `v2.89.0-rc.0` before/after the tree-shaking optimizations
(minified KiB / gzip KiB):

| Bundler         | Entry   | Before raw | After raw |      Δ raw | Before gz | After gz |       Δ gz |
| --------------- | ------- | ---------: | --------: | ---------: | --------: | -------: | ---------: |
| webpack         | single  |      112.9 |      99.3 | **−12.1%** |      35.3 |     31.4 | **−11.2%** |
| webpack         | typical |      253.8 |     251.6 |      −0.9% |      75.9 |     75.5 |      −0.6% |
| webpack         | full    |     1673.3 |    1480.5 | **−11.5%** |     449.2 |    404.6 |  **−9.9%** |
| rollup          | single  |      108.3 |      94.6 | **−12.6%** |      34.7 |     30.6 | **−11.8%** |
| rollup          | typical |      243.8 |     241.4 |      −1.0% |      74.6 |     73.9 |      −1.0% |
| rollup          | full    |     1547.7 |    1363.8 | **−11.9%** |     426.1 |    382.7 | **−10.2%** |
| vite (rolldown) | single  |      114.7 |     100.7 | **−12.2%** |      36.2 |     32.3 | **−10.8%** |
| vite (rolldown) | typical |      255.9 |     254.6 |      −0.5% |      77.5 |     77.3 |      −0.3% |
| vite (rolldown) | full    |     1684.2 |    1505.8 | **−10.6%** |     460.6 |    419.1 |  **−9.0%** |
| esbuild         | single  |      122.2 |     105.0 | **−14.1%** |      40.1 |     34.5 | **−14.1%** |
| esbuild         | typical |      271.4 |     265.4 |      −2.2% |      86.2 |     83.4 |      −3.2% |
| esbuild         | full    |     1767.4 |    1579.6 | **−10.6%** |     497.2 |    450.1 |  **−9.5%** |

### What changed

1. **`checkComponentEnabled` moved out of `settings.js`**
   (`src/global/js/utils/checkComponentEnabled.js`). Previously `settings.js` —
   imported by every component for `pkg` — attached `pkg.checkComponentEnabled`
   as a module-evaluation side effect, statically importing the `Canary`
   placeholder and through it Carbon's `CodeSnippet` → `Copy` → `Tooltip` →
   `Popover` → `@floating-ui/*`. Every application bundle paid for that chain
   even when it only used released components. Gated components now import the
   helper directly, so the chain is shaken away unless a feature-flagged
   component is actually used.
2. **`classnames`, `@carbon/icons-react` and `@carbon/colors` are now real
   `dependencies`** instead of devDependencies. They were being inlined into
   `es/`/`lib/` as CommonJS (with interop wrappers) and therefore duplicated
   with the copies `@carbon/react` already brings — including two whole
   icons-react "buckets" (~220 KB source). They are now externalized and
   deduplicated by the consumer's bundler.
3. **`sideEffects` narrowed to CSS/SCSS globs only.** The `props-helper.js`
   module is pure (it only exports functions) and no longer force-included in
   every bundle that loads the barrel `index.js`.

The remaining cost of the `single` entry (~95–105 KiB minified) is dominated by
`@carbon/react`'s own modal/dialog dependency graph, not by this library:
`@carbon/ibm-products` code accounts for roughly 10 KiB of it.
