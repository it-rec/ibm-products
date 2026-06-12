/**
 * Copyright IBM Corp. 2026, 2026
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';

export default {
  input: process.env.ENTRY,
  output: { file: `${process.env.OUTDIR}/bundle.js`, format: 'es' },
  external: ['react', 'react-dom', 'react-is', 'react-dom/client'],
  onwarn(warning, warn) {
    if (
      warning.code === 'CIRCULAR_DEPENDENCY' ||
      warning.code === 'THIS_IS_UNDEFINED'
    )
      return;
    warn(warning);
  },
  plugins: [
    replace({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    nodeResolve({ browser: true }),
    commonjs(),
    terser(),
  ],
};
