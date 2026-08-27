# 太陽光営業統合プラットフォーム

Solar sales platform: address → satellite map → roof tracing → panel layout →
generation simulation → economics → quotation, with CRM and an AI sales
copilot.

```
問い合わせ → 顧客登録 → 案件作成 → 住所検索 → 屋根作図 → パネル配置
          → 発電量計算 → 経済効果 → 見積 → 商談 → 契約
```

## Getting started

```bash
npm install
cp .env.example .env        # then edit it — see docs/setup/
npm run db:migrate
npm run db:seed
npm run dev
```

Sign in as `admin@example.com` with your `SEED_ADMIN_PASSWORD`.

`generated/` (the Prisma client) is not committed — `npm install` and
`npm run build` both regenerate it, so a clean clone builds with no extra step.
Neither generation nor the build needs a reachable database.

### すぐ動かしてみたい場合 / Try it immediately

```bash
npm run db:seed:demo
```

代表的なパネル10件・損失係数・電力単価・日射量観測点を投入し、フロー全体が通るように
なります。**すべて概算値で、出典はありません。** シミュレーションは動きますが、結果は
全画面で「参考値（デモ用データ）」と表示され、**見積の発行は拒否されます**。
実データへの差し替え手順は [`docs/setup/panel-catalogue.md`](docs/setup/panel-catalogue.md)。

**The first thing you will see is the calculation engine reporting itself
stopped.** That is correct. Every seeded coefficient is an unverified
placeholder, and the engines refuse to produce a customer-facing figure from
values nobody has sourced. Go to 管理 → 係数 and record each value with where it
came from. See [`docs/setup/README.md`](docs/setup/README.md).

## What makes this system what it is

**Nothing is calculated by a language model.** Generation, economics, panel
count and money all come from deterministic engines. The AI Copilot retrieves
those figures and quotes them; it never derives one.

**Every coefficient carries a source.** A coefficient is `Sourced<number>`, not
a number, and a calculation with an unverified input throws rather than
returning something plausible. Failing closed is the design.

**A satellite polygon is the roof's shadow, not the roof.** On a 30° roof the
real surface is 15.5% longer down-slope. Laying real-size panels on the traced
outline loses about one row in seven, invisibly. All layout happens on a
tilt-corrected roof plane.

**Panel count is proved, not estimated.** `roofArea / panelArea` is banned. The
engine places real rectangles and geometrically verifies each one fits, over an
exhaustive search of orientation × array angle × grid offset. Determinism is a
hard requirement: a quotation saved today reproduces byte-identically in five
years.

**Google is never a hard dependency.** With no Maps key, an operator can enter
coordinates and paste a roof outline, and the whole pipeline still runs. The
E2E suite proves it by running that way.

## Commands

|                                   |                                                            |
| --------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                     | Development server                                         |
| `npm run gate`                    | Everything: format, lint, typecheck, tests, build, browser |
| `npm run gate:fast`               | The same without the browser suite                         |
| `npm test`                        | Unit and regression tests                                  |
| `npm run test:integration`        | Server layer against a real database (skips without one)   |
| `npm run db:seed:demo`            | Demonstration data — runs, but can never be quoted         |
| `npm run test:geometry`           | Panel placement regression suite                           |
| `npm run test:solar`              | Solar calculation regression and golden suite              |
| `npm run test:e2e`                | Browser tests (builds first)                               |
| `npm run db:migrate`              | Create and apply a migration                               |
| `npm run db:seed`                 | Seed reference data                                        |
| `npx tsx scripts/bench-layout.ts` | Layout engine benchmark                                    |

## Layout

```
src/core/       Pure domain logic — no I/O, no env, no clock, no randomness
  geo/          Coordinate systems, polygons, planar region index
  layout/       Panel placement engine
  solar/        Generation engine + irradiance providers
  economics/    Financial model
  quotation/    Quotation arithmetic
  ai/           Provider interface, injection defences, tool contract
src/server/     Services, repositories, auth, RBAC — owns all I/O
src/app/        Next.js routes
prisma/         Schema, migrations, seed
tests/          unit · integration · regression · e2e · fixtures
docs/           adr · setup · specs · progress · open issues
```

## Documentation

|                                                                    |                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| [`CLAUDE.md`](CLAUDE.md)                                           | Project rules and conventions                    |
| [`docs/adr/`](docs/adr/)                                           | Architecture decisions, with what each gives up  |
| [`docs/solar-calculation-spec.md`](docs/solar-calculation-spec.md) | The generation model — and what it does _not_ do |
| [`docs/progress.md`](docs/progress.md)                             | Feature-by-feature state                         |
| [`docs/open-issues.md`](docs/open-issues.md)                       | What is waiting on a person                      |
| [`docs/security-review.md`](docs/security-review.md)               | Findings, and what was not covered               |
| [`docs/setup/`](docs/setup/)                                       | Database, Google Maps, AI provider               |

## Stack

Next.js 16 · React 19 · TypeScript 5.9 · PostgreSQL 16 · Prisma 7 ·
Tailwind 4 · JSTS · Terra Draw · Vitest · Playwright
