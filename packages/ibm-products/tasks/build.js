/**
 * Copyright IBM Corp. 2025, 2025
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

const fs = require('fs-extra');
const path = require('path');
const ts = require('typescript');
const packageJson = require('../package.json');

const banner = `/**
 * Copyright IBM Corp. 2020, ${new Date().getFullYear()}
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */
`;

async function build() {
  const { build: tsdown } = await import('tsdown');

  const packageRoot = path.resolve(__dirname, '..');
  const tsconfigPath = path.resolve(__dirname, '..', 'tsconfig.json');
  const declarationTsconfigPath = path.resolve(
    __dirname,
    '..',
    'tsconfig.declarations.json'
  );
  const external = getExternalPatterns();

  const formats = [
    {
      type: 'esm',
      directory: 'es',
    },
    {
      type: 'cjs',
      directory: 'lib',
    },
  ];

  // Build @carbon/ibm-products outputs
  for (const format of formats) {
    await tsdown({
      banner,
      clean: false,
      dts: false,
      entry: ['./src/index.ts'],
      external,
      failOnWarn: false,
      format: format.type,
      logLevel: 'warn',
      loader: {
        '.js': 'jsx',
      },
      outDir: path.join(packageRoot, format.directory),
      unbundle: true,
      outputOptions(options) {
        return {
          ...options,
          chunkFileNames: '[name].js',
          entryFileNames: '[name].js',
        };
      },
      platform: 'browser',
      target: 'es2022',
      tsconfig: tsconfigPath,
    });
  }

  // Patch CJS default exports to fix tsdown interop issue
  console.log('Patching CJS default exports...');
  await patchCjsDefaultInterop(path.join(packageRoot, 'lib'));

  // Annotate top-level React factory calls with /*#__PURE__*/ so consumer
  // bundlers can drop unreferenced components and their displayName /
  // propTypes / defaultProps mutation chains.
  console.log('Annotating pure factory calls...');
  await annotatePureCalls(path.join(packageRoot, 'es'));
  await annotatePureCalls(path.join(packageRoot, 'lib'));

  // Wrap `Component.propTypes = { ... }` blocks in a NODE_ENV guard so a
  // production-mode consumer bundler (Vite, webpack, Rollup, esbuild with
  // `define`) strips them entirely. This is the same trick Carbon and
  // Material UI use; in dev builds the propTypes still execute and emit
  // warnings. PropTypes account for ~2-3 KB per non-trivial component.
  console.log('Guarding propTypes with NODE_ENV...');
  await guardPropTypes(path.join(packageRoot, 'es'));
  await guardPropTypes(path.join(packageRoot, 'lib'));

  // Generate declarations once to es/ directory
  console.log('Generating TypeScript declarations...');
  await emitDeclarations(declarationTsconfigPath, path.join(packageRoot, 'es'));

  // Copy declarations from es/ to lib/ for CJS parity
  console.log('Copying declarations to lib/...');
  await copyDeclarations(
    path.join(packageRoot, 'es'),
    path.join(packageRoot, 'lib')
  );

  console.log('✅ Build complete!');
}

async function patchCjsDefaultInterop(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await patchCjsDefaultInterop(fullPath);
      continue;
    }

    if (entry.name.endsWith('.js')) {
      let contents = await fs.readFile(fullPath, 'utf8');

      // Normalize to `default || module` so consumers receive the component value.
      // This fixes the issue where `export { default as name }` creates
      // `exports.name = require_module` which becomes `{ default: function }`
      // instead of the function itself when using namespace imports.
      const updated = contents.replace(
        /^(exports\.\w+ = )(require_[\w$]+);$/gm,
        '$1$2.default || $2;'
      );

      if (updated !== contents) {
        await fs.writeFile(fullPath, updated, 'utf8');
      }
    }
  }
}

// Walk the build output and prefix top-level invocations of React's
// factory functions (forwardRef / memo / createContext / lazy) with the
// `/*#__PURE__*/` annotation that bundlers honor. Without this hint,
// the bundler leaves the call sites unannotated and downstream
// tree-shakers retain the call (and the follow-up
// Component.displayName / .propTypes / .defaultProps mutation chain)
// for every component the consumer did not import.
const PURE_FACTORY_PATTERNS = [
  // bare named imports — e.g. `forwardRef(...)`, `memo(...)`
  /(^|[^/.\w$])(forwardRef|memo|createContext|lazy)\(/gm,
  // member-access — e.g. `React.forwardRef(...)`
  /(^|[^/.\w$])(React\.(?:forwardRef|memo|createContext|lazy))\(/gm,
];

async function annotatePureCalls(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await annotatePureCalls(fullPath);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    let contents = await fs.readFile(fullPath, 'utf8');
    let updated = contents;
    for (const re of PURE_FACTORY_PATTERNS) {
      updated = updated.replace(re, (match, lead, callee) => {
        // Skip if already annotated.
        const before = match.slice(0, match.length - callee.length - 1);
        if (
          before.endsWith('/*#__PURE__*/ ') ||
          before.endsWith('/*@__PURE__*/ ')
        ) {
          return match;
        }
        return `${lead}/*#__PURE__*/ ${callee}(`;
      });
    }
    if (updated !== contents) {
      await fs.writeFile(fullPath, updated, 'utf8');
    }
  }
}

// Wrap every `<Identifier>.propTypes = { ... };` statement (and its
// `<Identifier>.defaultProps = { ... };` sibling) in
// `if (process.env.NODE_ENV !== "production") { ... }`. The CJS lib/
// build (which uses `exports.X = ...`) is also handled.
//
// We intentionally do not wrap `propTypes` references that appear inside
// expressions (e.g. `Button.propTypes.kind`) — only top-level mutation
// statements.
async function guardPropTypes(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await guardPropTypes(fullPath);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const contents = await fs.readFile(fullPath, 'utf8');
    const updated = wrapDevOnlyAssignments(contents);
    if (updated !== contents) {
      await fs.writeFile(fullPath, updated, 'utf8');
    }
  }
}

const DEV_PROP_KEY_RE =
  /^(\s*)([A-Za-z_$][\w$]*(?:\$[\w$]*)?)\.(propTypes|defaultProps)\s*=\s*/;

function wrapDevOnlyAssignments(source) {
  const out = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(DEV_PROP_KEY_RE);
    if (!m) {
      out.push(line);
      continue;
    }
    // Already guarded? (Conservative — never re-wrap.)
    const prev = out[out.length - 1] ?? '';
    if (
      prev.includes('process.env.NODE_ENV') ||
      line.startsWith('if (process.env.NODE_ENV')
    ) {
      out.push(line);
      continue;
    }
    // Find the closing brace / semicolon for this statement.
    const start = i;
    let depth = 0;
    let inString = null;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    let end = -1;
    outer: for (let j = i; j < lines.length; j++) {
      const ln = lines[j];
      for (let k = 0; k < ln.length; k++) {
        const c = ln[k];
        const c2 = ln[k + 1];
        if (inLineComment) break;
        if (inBlockComment) {
          if (c === '*' && c2 === '/') {
            inBlockComment = false;
            k++;
          }
          continue;
        }
        if (inString) {
          if (c === '\\') {
            k++;
            continue;
          }
          if (c === inString) inString = null;
          continue;
        }
        if (inTemplate) {
          if (c === '\\') {
            k++;
            continue;
          }
          if (c === '`') inTemplate = false;
          continue;
        }
        if (c === '/' && c2 === '/') {
          inLineComment = true;
          break;
        }
        if (c === '/' && c2 === '*') {
          inBlockComment = true;
          k++;
          continue;
        }
        if (c === '"' || c === "'") {
          inString = c;
          continue;
        }
        if (c === '`') {
          inTemplate = true;
          continue;
        }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth--;
        else if (c === ';' && depth === 0) {
          end = j;
          break outer;
        }
      }
      inLineComment = false;
      // Implicit ASI on a line that closes the brace.
      if (depth === 0 && j > i && /^\}\s*;?\s*$/.test(ln.trimEnd())) {
        end = j;
        break outer;
      }
    }
    if (end === -1) {
      // Couldn't safely identify the statement boundary; leave it alone.
      out.push(line);
      continue;
    }
    const indent = m[1];
    out.push(`${indent}if (process.env.NODE_ENV !== "production") {`);
    for (let j = start; j <= end; j++) {
      out.push(lines[j]);
    }
    out.push(`${indent}}`);
    i = end;
  }
  return out.join('\n');
}

async function copyDeclarations(fromDir, toDir) {
  const entries = await fs.readdir(fromDir, { withFileTypes: true });

  for (const entry of entries) {
    const fromPath = path.join(fromDir, entry.name);
    const toPath = path.join(toDir, entry.name);

    if (entry.isDirectory()) {
      await fs.ensureDir(toPath);
      await copyDeclarations(fromPath, toPath);
      continue;
    }

    if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.ts.map')) {
      await fs.copy(fromPath, toPath);
    }
  }
}

async function emitDeclarations(tsconfigPath, outDir) {
  const sourceRoot = path.resolve(__dirname, '..', 'src');
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(formatDiagnostics([configFile.error]));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    {
      declaration: true,
      declarationMap: true,
      emitDeclarationOnly: true,
      noEmit: false,
      noEmitOnError: false,
      outDir,
      rootDir: sourceRoot,
      sourceMap: false,
    },
    tsconfigPath
  );

  const rootNames = parsed.fileNames;
  const program = ts.createProgram({
    options: parsed.options,
    rootNames,
  });
  const emitResult = program.emit();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

  if (emitResult.emitSkipped) {
    throw new Error(formatDiagnostics(diagnostics));
  }

  if (diagnostics.length > 0) {
    // Surface diagnostics as warnings without failing the build
    console.warn(formatDiagnostics(diagnostics));
  }
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName(filepath) {
      return filepath;
    },
    getCurrentDirectory() {
      return process.cwd();
    },
    getNewLine() {
      return '\n';
    },
  });
}

function getExternalPatterns() {
  const deps = [
    ...Object.keys(packageJson.peerDependencies || {}),
    ...Object.keys(packageJson.dependencies || {}),
  ];

  return deps.map((name) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escapedName}(/.*)?`);
  });
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
