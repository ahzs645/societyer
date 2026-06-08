#!/usr/bin/env bash
# Recompile index.scss and compare to the locked baseline.
set -e
npx sass --no-source-map --style=expanded src/styles/index.scss .css-baseline/current.css 2>/dev/null
BASE=$(shasum -a 256 .css-baseline/baseline.css | awk '{print $1}')
CUR=$(shasum -a 256 .css-baseline/current.css | awk '{print $1}')
if [ "$BASE" = "$CUR" ]; then
  echo "✅ BYTE-IDENTICAL ($CUR)"
else
  # Nesting changes only inter-rule blank lines; fall back to a semantic
  # (whitespace-insensitive) comparison, which is what production minification
  # collapses to anyway.
  if diff -q <(grep -v '^[[:space:]]*$' .css-baseline/baseline.css) \
             <(grep -v '^[[:space:]]*$' .css-baseline/current.css) >/dev/null; then
    echo "✅ SEMANTICALLY IDENTICAL (blank-line whitespace only — nesting)"
  else
    echo "❌ DIFFERS (semantic)"
    diff <(grep -v '^[[:space:]]*$' .css-baseline/baseline.css) \
         <(grep -v '^[[:space:]]*$' .css-baseline/current.css) | head -40
    exit 1
  fi
fi
