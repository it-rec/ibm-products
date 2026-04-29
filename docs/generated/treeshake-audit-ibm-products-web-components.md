# Tree-shake audit: `@carbon/ibm-products-web-components`

Web components are **side-effecting by design**: importing
`tearsheet.ts` causes `customElements.define('c4p-tearsheet', …)` to
register the element with the browser, and that registration is
exactly what the consumer wants. This audit therefore distinguishes
"bytes that *must* survive the bundle for the package to function"
from "bytes that should not be retained when the consumer didn't
ask for them".

Source of truth for the baseline numbers cited below:
[`scripts/treeshake-bench/baseline.json`](../../scripts/treeshake-bench/baseline.json).
The `wc-one` scenario (single named import of `CDSTearsheet` via the
documented deep path) compiles to **156,610 raw / 18,724 gzip**
bytes — the bulk of which is the tearsheet's own implementation plus
the SCSS styles it imports.

## 1. `package.json` shape

`packages/ibm-products-web-components/package.json:1-110`

| Field | Value | Verdict |
| --- | --- | --- |
| `main` | `es/index.js` | OK |
| `module` | `es/index.js` | OK |
| `type` | `module` | OK |
| `exports` | `./es/*`, `./es-custom/*`, `./lib/*`, `./dist/*`, `./scss/*`, `./custom-elements.json`, `./package.json`, `./telemetry.yml` | **Hazard**: no `"."` root entry |
| `sideEffects` | **(absent)** | **Hazard** — defaults to "every file is side-effecting" |
| `files` | `custom-elements.json, es/**/*, es-custom/**/*, lib/**/*, scss/**/*, telemetry.yml` | OK |

### 1a. No root `"."` entry in `"exports"`

The `"exports"` map has no `"."` key, so a bare `import 'X'` (where
`X` is `@carbon/ibm-products-web-components`) fails resolution under
strict ESM resolvers (Node, Vite/esbuild with `exports`-aware
resolution enabled). The `wc-one` baseline fixture had to be
adjusted to deep-import via
`@carbon/ibm-products-web-components/es/components/tearsheet/tearsheet.js`
instead — the more idiomatic
`import { CDSTearsheet } from '@carbon/ibm-products-web-components'`
is **not currently supported** for ESM consumers.

`main` and `module` both point at `es/index.js`, but per the Node
spec `"exports"` takes strict precedence over the legacy fields
once it is present.

### 1b. Missing `"sideEffects"` declaration

The package omits `sideEffects` entirely. Bundlers (Vite, webpack,
Rollup, esbuild) interpret this as **"every file in the package may
have side effects"**. For the WC components themselves this is
correct (`@customElement(...)` registers the element on import) but
it also pins down every helper module under `src/utilities/`,
`src/globals/internal/`, `src/components/**/defs.ts` and the
per-component `*.scss.js` style modules — none of which actually
need to be retained when their exports are unused.

The fix is an explicit allowlist that names *only* the modules that
register elements (every `src/components/**/<name>.ts` matches that
pattern) and the SCSS modules:

```jsonc
"sideEffects": [
  "**/components/**/*.js",
  "**/components/**/*.scss.js",
  "**/*.css",
  "**/*.scss",
  "!**/components/**/defs.js",
  "!**/components/**/*-helpers.js"
]
```

This lets the bundler safely drop helper modules that the consumer
imported but did not actually call, while keeping all element
registrations intact.

## 2. Module format of the build output

`tasks/build.js:35-126` configures `tsdown` (and its underlying
bundler) with
`format: 'esm'`, `target: 'es2022'`, `preserveModules: true`. Spot
checks of the output confirm:

- `packages/ibm-products-web-components/es/components/tearsheet/tearsheet.js`
  is real ESM (`import { LitElement, html } from 'lit';` etc., no
  `__esModule` shim, no `require()`).
- `__decorate` calls are emitted by `@oxc-project/runtime` (line 9 of
  the built `tearsheet.js`) — not pure-annotated. Same caveat as the
  React side: this prevents some otherwise-eligible drops, though for
  the WC components the decorators are intrinsic to registering the
  element.

`@property` / `@state` / `@query` decorators on `LitElement`
classes are likewise handled via `__decorate(...)` in the output.
These are call expressions inside the class declaration, so they are
considered side effects of the class — but the consumer wants the
class itself, so this is acceptable.

## 3. Source-level hazards

### 3a. `@customElement(...)` decorators (intentional)

Every `src/components/<name>/<name>.ts` ends with a
`@customElement(...)` (or `@carbonElement(...)`) decorator on the
class. This is **the** side effect that makes the package useful.
It must remain in the bundle when the consumer asks for that
element. No fix needed; the `sideEffects` allowlist above protects
it.

### 3b. Imports of `@carbon/web-components` for slot dependencies

Every component imports the side-effecting Carbon WC modules it
slots, e.g. `tearsheet.ts:24-27`:

```ts
import '@carbon/web-components/es/components/button/index.js';
import '@carbon/web-components/es/components/layer/index.js';
import '@carbon/web-components/es/components/button/button-set-base.js';
import '@carbon/web-components/es/components/modal/index.js';
```

These are bare side-effecting imports — exactly the right pattern.
The published Carbon WC packages handle their own registrations.
**No change needed.**

### 3c. No `export *` chains, no namespace imports

`src/index.ts` is a flat list of `export { default as CDS<X> } from
'./components/<name>/<name>'`. There are no `export *` re-exports.
A grep across `src/**/*.ts` for `import * as` and `export * from`
returned no production hits. **Good.**

### 3d. Top-level constants and `defs.ts`

Each component has a `defs.ts` with plain `export const FOO = '…'`
declarations. These have no side effects; they are exactly the
modules the `sideEffects` allowlist's negation should release.

### 3e. SCSS-as-JS modules

The build emits `tearsheet.scss.js` (and analogues) that wrap a
compiled CSS string into a `lit` `CSSResult` constant. Importing
this module from the component is the side effect that links styles
to the element. Listed via the SCSS glob in the proposed allowlist.

## 4. Cross-package leaks

Because the package consists of many small per-element modules and
the consumer imports a single one, there is no significant
cross-component leakage — confirmed by inspecting the `wc-one`
metafile inputs, which lists only:

- `tearsheet.js` (the element)
- `tearsheet.scss.js` (the styles)
- `__decorate` runtime helper
- `globals/settings.js` (prefix constants)
- `globals/internal/pconsole.js` (console wrapper)
- `defs.js` (enum-like constants)

## 5. Summary of actionable items

| # | Hazard | Fix | Expected impact |
| --- | --- | --- | --- |
| W1 | No root `"."` entry in `exports` | Add `".": { "import": "./es/index.js", "default": "./es/index.js" }` (and `types`) | Enables barrel imports without changing existing deep-import paths |
| W2 | No `sideEffects` declaration | Add allowlist that scopes side effects to component files and styles | Frees `defs.js`, `globals/internal/*`, `utilities/*` to be dropped when their exports go unused |

Items intentionally *not* changed:

- Bare side-effect imports of `@carbon/web-components/es/components/<x>/index.js`
  inside each component — these are the standard pattern for
  registering Lit-based dependencies and any change here would
  break rendering.
- `@customElement` and Lit decorator usage at module top — required
  for elements to function.
