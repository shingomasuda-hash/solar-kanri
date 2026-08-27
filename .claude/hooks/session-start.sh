#!/bin/bash
#
# Session start: make a fresh container able to run the quality gate.
#
# Claude Code on the web starts from a clean clone with no node_modules, no
# generated Prisma client and no database. Every one of those produces a
# failure that reads like a product bug — a build that cannot resolve
# `generated/prisma/client`, or a browser suite whose every test times out
# because Postgres is not listening. This script removes that class of
# confusion.
#
# Local machines are left alone: developers own their own environment.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

say() { echo "[session-start] $*"; }

# ---------------------------------------------------------------- environment
#
# A development-only .env. Never overwrite an existing one: it may hold real
# API keys the operator pasted in, and silently replacing those would be worse
# than any convenience this buys.
if [ ! -f .env ]; then
  say "creating a development .env"
  cp .env.example .env
  SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
  # Local-only credentials for a throwaway container. Production secrets come
  # from the environment and are never written to a file (deployment rule 3).
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=\"postgresql://solar:solar_dev@localhost:5432/solar_kanri?schema=public\"#" .env
  sed -i "s#^SESSION_SECRET=.*#SESSION_SECRET=\"${SECRET}\"#" .env
fi

# --------------------------------------------------------------- dependencies
#
# `install` rather than `ci`: the container image is cached after this hook, and
# install reuses what is already there. The postinstall script regenerates the
# Prisma client, which is deliberately not committed.
say "installing dependencies"
npm install --no-audit --no-fund

# ------------------------------------------------------------------- database
if ! pg_isready --quiet 2>/dev/null; then
  say "starting PostgreSQL"
  sudo service postgresql start >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    pg_isready --quiet 2>/dev/null && break
    sleep 1
  done
fi

if ! pg_isready --quiet 2>/dev/null; then
  say "PostgreSQL did not start; integration and browser tests will not run"
  exit 0
fi

# Role and database, both idempotent.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='solar'" | grep -q 1; then
  say "creating the solar role"
  sudo -u postgres psql -q -c "CREATE USER solar WITH PASSWORD 'solar_dev' CREATEDB;"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='solar_kanri'" | grep -q 1; then
  say "creating the solar_kanri database"
  sudo -u postgres psql -q -c "CREATE DATABASE solar_kanri OWNER solar;"
fi

# `migrate deploy`, never `migrate dev`: applies existing migrations and will
# not reset anything (deployment rule 2).
say "applying migrations"
npx prisma migrate deploy

# The seed is upsert-based, so re-running it is safe and keeps a container that
# was reclaimed mid-session usable.
say "seeding reference data"
npm run db:seed

say "ready"
