/**
 * Copyright IBM Corp. 2026, 2026
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

const path = require('path');
module.exports = {
  mode: 'production',
  entry: process.env.ENTRY,
  output: {
    path: path.resolve(process.env.OUTDIR),
    filename: 'bundle.js',
  },
  externals: {
    react: 'React',
    'react-dom': 'ReactDOM',
    'react-is': 'ReactIs',
  },
  performance: { hints: false },
  stats: 'errors-only',
};
