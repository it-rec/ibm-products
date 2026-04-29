#!/usr/bin/env node
/**
 * Copyright IBM Corp. 2026, 2026
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Tree-shake benchmark.
 *
 * Builds a set of single-import "consumer" fixtures against the locally
 * built artifacts of:
 *   - @carbon/ibm-products
 *   - @carbon/ibm-products-styles
 *   - @carbon/ibm-products-web-components
 *
 * For JS scenarios, we use esbuild as a stand-in for a downstream
 * Vite/Rollup/webpack build: ESM, production, minified, tree-shaking on.
 * Every dependency that the monorepo would expect a real consumer to
 * provide (React, @carbon/react, lit, etc.) is marked external. This
 * keeps the measurement focused on the bytes contributed by this
 * monorepo's published packages.
 *
 * For the SCSS scenario we compile with `sass` in compressed mode and
 * record the resulting CSS byte count.
 *
 * Output is a JSON document (defaults to `baseline.json`) listing per
 * scenario: rawBytes, gzipBytes, moduleCount, top modules by size.
 *
 * Usage:
 *   node scripts/treeshake-bench/bench.mjs                # writes baseline.json
 *   node scripts/treeshake-bench/bench.mjs --out current.json
 *   node scripts/treeshake-bench/bench.mjs --label "after fixes"
 */

import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const sass = require('sass');

const args = parseArgs(process.argv.slice(2));
const outFile = path.resolve(here, args.out ?? 'baseline.json');
const label = args.label ?? 'baseline';

// --- Externals -------------------------------------------------------------
//
// Anything a real downstream consumer is expected to bring along itself
// (peers, the larger Carbon platform, generic ecosystem libs) is marked
// external so that we measure only the bytes contributed by this
// monorepo. Sub-paths are matched too because `@carbon/react/icons` etc.
// are common inside our component sources.

const externalPrefixes = [
  '@babel/runtime',
  '@carbon/colors',
  '@carbon/feature-flags',
  '@carbon/grid',
  '@carbon/icon-helpers',
  '@carbon/icons',
  '@carbon/icons-react',
  '@carbon/layout',
  '@carbon/motion',
  '@carbon/react',
  '@carbon/styles',
  '@carbon/themes',
  '@carbon/telemetry',
  '@carbon/type',
  '@carbon/utilities',
  '@carbon/utilities-react',
  '@carbon/web-components',
  '@carbon-labs/react-resizer',
  '@carbon-labs/wc-empty-state',
  '@dnd-kit/core',
  '@dnd-kit/modifiers',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@floating-ui/dom',
  '@ibm/telemetry-js',
  '@lit-labs/signals',
  '@lit/context',
  'classnames',
  'flat',
  'lit',
  'lit-html',
  'lit/decorators.js',
  'prop-types',
  'react',
  'react-dom',
  'react-is',
  'react-table',
  'react-window',
  'tslib',
];

function isExternal(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return false;
  return externalPrefixes.some(
    (p) => spec === p || spec.startsWith(`${p}/`)
  );
}

const monorepoPackageDirs = [
  'packages/ibm-products/',
  'packages/ibm-products-styles/',
  'packages/ibm-products-web-components/',
];

function isMonorepoModule(relPath) {
  return monorepoPackageDirs.some((p) => relPath.startsWith(p));
}

// --- JS scenarios ----------------------------------------------------------

const jsScenarios = [
  { name: 'barrel-one', entry: 'fixtures/barrel-one.js' },
  { name: 'barrel-many', entry: 'fixtures/barrel-many.js' },
  { name: 'deep-one', entry: 'fixtures/deep-one.js' },
  { name: 'wc-one', entry: 'fixtures/wc-one.js' },
];

async function buildJsScenario(scenario) {
  const entry = path.resolve(here, scenario.entry);
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    treeShaking: true,
    metafile: true,
    legalComments: 'none',
    logLevel: 'silent',
    absWorkingDir: repoRoot,
    mainFields: ['module', 'main'],
    conditions: ['module', 'import', 'browser', 'default'],
    plugins: [
      {
        name: 'externals',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (a) => {
            if (isExternal(a.path)) {
              return { path: a.path, external: true };
            }
            return null;
          });
        },
      },
    ],
  });

  const out = result.outputFiles[0];
  const raw = out.contents;
  const gz = gzipSync(raw, { level: 9 });

  const meta = result.metafile;
  const outputKey = Object.keys(meta.outputs)[0];
  const outputInfo = meta.outputs[outputKey];

  const modules = Object.entries(outputInfo.inputs)
    .map(([id, info]) => {
      // esbuild reports paths relative to the working directory.
      const rel = id.startsWith('/')
        ? path.relative(repoRoot, id)
        : id.replace(/\\/g, '/');
      return {
        id: rel,
        bytes: info.bytesInOutput,
        monorepo: isMonorepoModule(rel),
      };
    })
    .filter((m) => m.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  const monorepoModules = modules.filter((m) => m.monorepo);
  const monorepoBytes = monorepoModules.reduce((a, m) => a + m.bytes, 0);

  return {
    name: scenario.name,
    entry: scenario.entry,
    rawBytes: raw.length,
    gzipBytes: gz.length,
    moduleCount: modules.length,
    monorepoModuleCount: monorepoModules.length,
    monorepoBytes,
    topModules: modules.slice(0, 25),
  };
}

// --- SCSS scenario ---------------------------------------------------------

async function buildScssScenario() {
  const entry = path.resolve(here, 'fixtures/styles-one.scss');
  const result = sass.compile(entry, {
    loadPaths: [
      path.resolve(repoRoot, 'node_modules'),
      path.resolve(repoRoot, 'packages/ibm-products-styles/node_modules'),
    ],
    style: 'compressed',
    sourceMap: false,
  });
  const css = Buffer.from(result.css, 'utf8');
  const gz = gzipSync(css, { level: 9 });

  return {
    name: 'styles-one',
    entry: 'fixtures/styles-one.scss',
    rawBytes: css.length,
    gzipBytes: gz.length,
    moduleCount: 1,
    monorepoModuleCount: 1,
    monorepoBytes: css.length,
    topModules: [
      { id: 'packages/ibm-products-styles/scss/components/AboutModal', bytes: css.length, monorepo: true },
    ],
  };
}

// --- Main ------------------------------------------------------------------

async function main() {
  const builtArtifactsExist = await checkBuilds();
  if (!builtArtifactsExist) {
    console.error(
      'Built artifacts are missing. Run `yarn build:packages` before benching.'
    );
    process.exit(1);
  }

  const scenarios = [];
  for (const sc of jsScenarios) {
    process.stdout.write(`▶ ${sc.name} ... `);
    try {
      const out = await buildJsScenario(sc);
      scenarios.push(out);
      console.log(`${out.rawBytes} raw / ${out.gzipBytes} gz`);
    } catch (err) {
      console.error('FAILED');
      console.error(err.message);
      throw err;
    }
  }

  process.stdout.write('▶ styles-one ... ');
  const styles = await buildScssScenario();
  scenarios.push(styles);
  console.log(`${styles.rawBytes} raw / ${styles.gzipBytes} gz`);

  const result = {
    label,
    generatedAt: new Date().toISOString(),
    node: process.version,
    scenarios,
  };

  await fs.writeFile(outFile, JSON.stringify(result, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(repoRoot, outFile)}`);
  printTable(result);
}

async function checkBuilds() {
  const probes = [
    'packages/ibm-products/es/index.js',
    'packages/ibm-products-web-components/es/index.js',
    'packages/ibm-products-styles/scss/components/AboutModal/_index.scss',
  ];
  for (const p of probes) {
    try {
      await fs.access(path.resolve(repoRoot, p));
    } catch {
      return false;
    }
  }
  return true;
}

function printTable(result) {
  console.log(`\nLabel: ${result.label}`);
  const rows = result.scenarios.map((s) => ({
    scenario: s.name,
    raw: s.rawBytes,
    gzip: s.gzipBytes,
    modules: s.moduleCount,
    'monorepo modules': s.monorepoModuleCount,
    'monorepo bytes': s.monorepoBytes,
  }));
  console.table(rows);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') out.out = argv[++i];
    else if (a === '--label' || a === '-l') out.label = argv[++i];
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
