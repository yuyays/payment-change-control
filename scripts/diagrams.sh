#!/usr/bin/env bash
# Regenerate the README diagrams from their Graphviz sources.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v dot >/dev/null 2>&1; then
  echo "graphviz (dot) is required: apt install graphviz" >&2
  exit 1
fi
for file in docs/diagrams/*.dot; do
  out="docs/$(basename "$file" .dot).svg"
  dot -Tsvg "$file" -o "$out"
  echo "wrote $out"
done
