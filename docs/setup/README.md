# Setup

Work through these in order. The system is usable after step 3; steps 4 and 5
add convenience and are not required.

| Step | Guide                                        | Required?                                          |
| ---- | -------------------------------------------- | -------------------------------------------------- |
| 1    | [Database](./database.md)                    | Yes                                                |
| 2    | Copy `.env.example` to `.env` and fill it in | Yes                                                |
| 3    | Enter sourced coefficients in 管理 → 係数    | **Yes — nothing can be quoted until this is done** |
| 4    | [Google Maps Platform](./google-maps.md)     | No — roof outlines can be entered as coordinates   |
| 5    | [AI Copilot](./ai-provider.md)               | No — everything else works without it              |

## Quick start

```bash
npm install
cp .env.example .env        # then edit it
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000> and sign in as `admin@example.com` with your
`SEED_ADMIN_PASSWORD`.

## What you will see first

管理 → システム状態 will report the calculation engine as **停止**, because every
seeded coefficient is an unverified placeholder. This is correct: the engines
refuse to produce a number from values nobody has sourced.

Go to 管理 → 係数 and, for each entry, record the value and where it came from —
a manufacturer datasheet, a published standard, an official dataset, or a
documented decision by your company. Do the same in 管理 → 電力単価 and
管理 → 日射量. The health page turns green when nothing is left unsourced, and
simulation becomes available at that moment.

The outstanding items and who has to decide them are listed in
`docs/open-issues.md`.

## Verifying an install

```bash
npm run gate    # format, lint, typecheck, unit + regression tests, build, E2E
```

- [`deployment.md`](deployment.md) — Vercel などへのデプロイ、環境変数、マイグレーション
