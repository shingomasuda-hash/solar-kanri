#!/usr/bin/env bash
#
# Runs after any file edit. Fast checks only — this is on the critical path of
# every change, so anything slow belongs in the pre-commit gate instead.
#
# Exits non-zero on failure so the assistant is told, rather than discovering it
# three edits later.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

CHANGED="${CLAUDE_FILE_PATHS:-}"
[ -z "$CHANGED" ] && exit 0

# Only act on source files.
SOURCE=$(printf '%s\n' $CHANGED | grep -E '\.(ts|tsx|mts|css)$' || true)
[ -z "$SOURCE" ] && exit 0

STATUS=0

# 1. Format the touched files.
npx prettier --write $SOURCE >/dev/null 2>&1 || true

# 2. Lint the touched files.
if ! npx eslint $SOURCE 2>&1; then
  echo "ESLint failed on: $SOURCE" >&2
  STATUS=1
fi

# 3. Typecheck the project. TypeScript has no useful per-file mode with
#    project references off, and this is a few seconds.
if ! npx tsc --noEmit 2>&1; then
  echo "Typecheck failed." >&2
  STATUS=1
fi

# 4. Engine changes always run their regression suite. These are the modules
#    where a silent behaviour change is most expensive, so the cost of running
#    them on every edit is worth it.
if printf '%s\n' $SOURCE | grep -qE 'src/core/(geo|layout)/'; then
  echo "Geometry engine changed — running placement regression suite..."
  npm run test:geometry --silent 2>&1 || STATUS=1
fi

if printf '%s\n' $SOURCE | grep -qE 'src/core/(solar|economics)/'; then
  echo "Calculation engine changed — running solar regression suite..."
  npm run test:solar --silent 2>&1 || STATUS=1
fi

if printf '%s\n' $SOURCE | grep -qE 'src/core/quotation/'; then
  echo "Quotation engine changed — running quotation tests..."
  npx vitest run tests/unit/quotation --silent 2>&1 || STATUS=1
fi

if printf '%s\n' $SOURCE | grep -qE 'src/core/ai/|src/server/services/copilot'; then
  echo "AI surface changed — running copilot safety tests..."
  npx vitest run tests/unit/ai --silent 2>&1 || STATUS=1
fi

exit $STATUS
