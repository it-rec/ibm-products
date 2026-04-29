# Tree-shake audit: `@carbon/ibm-products-styles`

`@carbon/ibm-products-styles` ships only `.scss` partials and
pre-compiled `.css` for the rolled-up indices. There is no JS
artefact, so JS-bundler tree-shaking does not apply directly. The
relevant question is: **when a consumer SCSS file does
`@use '@carbon/ibm-products-styles/scss/components/<Name>'`, does it
pull in only the styles for that component?**

Source of truth for the baseline numbers cited below:
[`scripts/treeshake-bench/baseline.json`](../../scripts/treeshake-bench/baseline.json).
The `styles-one` scenario (single-component `AboutModal` partial)
compiles to **2,507 raw / 675 gzip** bytes — a tight upper bound on
what a single component contributes.

## 1. `package.json` shape

`packages/ibm-products-styles/package.json:1-69`

| Field | Value | Verdict |
| --- | --- | --- |
| `main` / `module` / `type` | (absent) | OK — package has no JS |
| `exports` | **(absent)** | **Hazard** — see below |
| `sideEffects` | `["**/*.css", "**/*.scss"]` | OK — every JS bundler that touches a `.scss` import (e.g. via vite, webpack with `css-loader`) keeps it |
| `files` | `css, scss, index.scss, telemetry.yml` | OK |

### 1a. No `"exports"` map

The package relies on the bundler / sass-loader walking
`node_modules/@carbon/ibm-products-styles/scss/...`. Because `files`
includes `scss`, this works today — but the layout is implicit and
nothing prevents an internal restructure from breaking documented
import paths like
`@carbon/ibm-products-styles/scss/components/AboutModal`.

A small `"exports"` map makes the contract explicit:

```jsonc
"exports": {
  "./scss/*": "./scss/*",
  "./css/*": "./css/*",
  "./package.json": "./package.json"
}
```

This is a **non-functional cleanup** (no measurable byte impact —
sass already resolves the path; the map just makes it impossible to
reach private files) but is recommended for symmetry with
`@carbon/ibm-products-web-components` and to enable future
condition-based exports.

## 2. SCSS source structure

`packages/ibm-products-styles/src/components/<Name>/_index.scss` is a
thin wrapper around `_<name>.scss`:

```scss
@use './about-modal';
```

The roll-up index `src/components/_index.scss` does
`@use './AboutModal'; @use './APIKeyModal'; …` — explicit per-component
forwards, no `@forward '*'`. **Good**: a consumer who imports a
single component's partial does not transitively pull in the index.

## 3. Module-format / side-effect concerns: N/A

There is no JS, so `sideEffects` is only consulted by JS bundlers
when they encounter `import '@carbon/ibm-products-styles/css/...'`
in a CSS-in-JS path. The current allowlist correctly tells them to
keep the import.

## 4. Cross-package leaks

The `styles-one` baseline compiles `AboutModal` alone to **2,507
bytes**. For comparison, `scss/index-without-carbon.scss` compiles to
**hundreds of kilobytes** (full-package roll-up). The split between
"single component" and "everything" is clean — there is no leakage
of unrelated component CSS through the per-component partials.

## 5. Summary of actionable items

| # | Hazard | Fix | Expected impact |
| --- | --- | --- | --- |
| S1 | No `"exports"` map | Add a small `"exports"` map covering `./scss/*`, `./css/*`, `./package.json`, `./index.scss` | Locks the public surface; no byte impact |

Items intentionally *not* changed:

- The `_index.scss` indices, the per-component partials, and the
  Carbon import-once mechanism — the existing structure is already
  tree-shake-friendly at the SCSS level.
