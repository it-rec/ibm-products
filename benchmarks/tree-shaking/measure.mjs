/**
 * Copyright IBM Corp. 2026, 2026
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const label = process.argv[2];
const results = {};
for (const bundler of ['webpack', 'rollup', 'vite', 'esbuild']) {
  results[bundler] = {};
  for (const entry of ['single', 'typical', 'full']) {
    const dir = join('dist', label, bundler, entry);
    let raw = 0,
      gzip = 0;
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!f.endsWith('.js')) continue;
        const buf = readFileSync(p);
        raw += buf.length;
        gzip += gzipSync(buf, { level: 9 }).length;
      }
    };
    walk(dir);
    results[bundler][entry] = { raw, gzip };
  }
}
console.log(JSON.stringify(results, null, 2));
