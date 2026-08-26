#!/usr/bin/env bash
#
# The full quality gate. Run before declaring anything done.
#
# Deliberately not run on every edit: it includes a production build and the
# browser suite, which take minutes. The point of a gate is that it is trusted,
# and a gate people skip because it is slow is not a gate.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

# Single-instance lock.
#
# Two concurrent gates race for the Playwright port and the database, and the
# resulting failures look like product bugs — blank pages, navigation timeouts,
# tests that pass alone and fail together. That cost a debugging cycle here, so
# a second run now refuses instead of corrupting the first.
LOCK_DIR=".gate.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "A quality gate is already running (found $LOCK_DIR)." >&2
  echo "Wait for it to finish, or remove the directory if it is stale." >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

FAILED=()

step() {
  local name="$1"; shift
  echo ""
  echo "── $name ─────────────────────────────────────────"
  if "$@"; then
    echo "   PASS: $name"
  else
    echo "   FAIL: $name" >&2
    FAILED+=("$name")
  fi
}

step "format"     npx prettier --check "src/**/*.{ts,tsx,css}" "tests/**/*.ts"
step "lint"       npx eslint .
step "typecheck"  npx tsc --noEmit
step "unit + regression tests" npx vitest run tests/unit tests/regression
# Named separately so the Definition of Done checklist can be read straight off
# the output. These need a migrated database; they skip, loudly, without one.
step "integration tests" npx vitest run tests/integration
step "production build" npm run build

if [ "${SKIP_E2E:-0}" != "1" ]; then
  step "browser (E2E)" npx playwright test
else
  echo ""
  echo "── browser (E2E) ─── SKIPPED (SKIP_E2E=1)"
fi

echo ""
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "Quality gate: PASS"
  exit 0
fi

echo "Quality gate: FAIL (${#FAILED[@]})" >&2
printf '  - %s\n' "${FAILED[@]}" >&2
echo "" >&2
echo "Do not report this work as complete. Find the cause and fix it." >&2
exit 1
