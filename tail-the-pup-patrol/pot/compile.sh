#!/usr/bin/env bash
# Compile the pot contract into contract/managed/tail-pot, where the kit (lib/midnight.mjs) loads it.
# Needs the Compact toolchain: compiler 0.36.0 (language 0.28), as the live pots were built with.
#   ./compile.sh            (run on the judge's machine; ~20 s with proving keys per contract)
# Compiles every pot contract: tail-pot (v1), v2, v3, v4 and v5 (the live pot from 2026-11-25, Season 4).
# Only one: ./compile.sh v5 (or v4)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
if [ "${1:-}" = v4 ]; then compact compile "$HERE/../contract/tail-pot-v4.compact" "$HERE/contract/managed/tail-pot-v4"; exit 0; fi
if [ "${1:-}" = v5 ]; then compact compile "$HERE/../contract/tail-pot-v5.compact" "$HERE/contract/managed/tail-pot-v5"; exit 0; fi
compact compile "$HERE/../contract/tail-pot.compact" "$HERE/contract/managed/tail-pot"
compact compile "$HERE/../contract/tail-pot-v2.compact" "$HERE/contract/managed/tail-pot-v2"
compact compile "$HERE/../contract/tail-pot-v3.compact" "$HERE/contract/managed/tail-pot-v3"
compact compile "$HERE/../contract/tail-pot-v4.compact" "$HERE/contract/managed/tail-pot-v4"
compact compile "$HERE/../contract/tail-pot-v5.compact" "$HERE/contract/managed/tail-pot-v5"
