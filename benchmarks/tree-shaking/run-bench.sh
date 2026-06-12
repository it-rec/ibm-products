#!/bin/bash
# Usage: ./run-bench.sh <label>
set -e
LABEL=$1
mkdir -p results
for ENTRY_NAME in single typical full; do
  ENTRY=src/entry-$ENTRY_NAME.js
  # webpack
  OUT=dist/$LABEL/webpack/$ENTRY_NAME
  rm -rf $OUT && ENTRY=./$ENTRY OUTDIR=$OUT npx webpack -c webpack.config.cjs >/dev/null
  # rollup
  OUT=dist/$LABEL/rollup/$ENTRY_NAME
  rm -rf $OUT && ENTRY=$ENTRY OUTDIR=$OUT npx rollup -c rollup.config.mjs --silent >/dev/null
  # vite (rolldown)
  OUT=dist/$LABEL/vite/$ENTRY_NAME
  rm -rf $OUT && ENTRY=$ENTRY OUTDIR=$OUT npx vite build >/dev/null
  # esbuild
  OUT=dist/$LABEL/esbuild/$ENTRY_NAME
  rm -rf $OUT && mkdir -p $OUT
  npx esbuild $ENTRY --bundle --minify --format=esm --platform=browser \
    --define:process.env.NODE_ENV=\"production\" \
    --external:react --external:react-dom --external:react-is \
    --outfile=$OUT/bundle.js --log-level=error
done
node measure.mjs $LABEL | tee results/$LABEL.json
